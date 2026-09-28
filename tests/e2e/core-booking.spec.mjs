import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'

const APP = 'http://127.0.0.1:3101'
const API = 'http://127.0.0.1:55322'

test('local operator completes onboarding, artist and booking persistence, and recovers from save failure', async ({ page }, testInfo) => {
  expect(process.env.BACKBEAT_TEST_URL).toBe(API)
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  expect(Boolean(anon && service && anon !== service)).toBe(true)
  const tag = `ui-m1-${randomUUID()}`
  const email = `${tag}@backbeat.test`
  const password = `${randomBytes(32).toString('base64url')}aA1!`
  let userId
  let jwt
  let workspaceId
  const blockedOrigins = new Set()
  const pageErrors = []
  const network = []
  const redact = value => [password, anon, service, jwt].filter(Boolean).reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(value))
  page.on('response', response => {
    const url = new URL(response.url())
    if ([APP, API].includes(url.origin) && !url.pathname.startsWith('/_next/')) network.push({ origin: url.origin, path: url.pathname, status: response.status() })
  })

  async function request(path, { method = 'GET', body, admin = false, token = jwt } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid local path')
    if (admin && !/^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?$/.test(path)) throw new Error('Admin credential scope violation')
    const response = await fetch(API + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { apikey: admin ? service : anon, Authorization: `Bearer ${admin ? service : token || anon}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`Local fixture request failed: HTTP ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  async function guard() {
    const rows = await request('/rest/v1/runtime_environment?select=id,environment,synthetic_only', { token: anon })
    expect(rows).toEqual([{ id: 'backbeat-dev', environment: 'development', synthetic_only: true }])
  }

  await guard()
  const fixture = await request('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true, user_metadata: { synthetic_fixture: tag } } })
  userId = fixture.id ?? fixture.user?.id
  expect(userId).toMatch(/^[0-9a-f-]{36}$/)
  try {
    await guard()
    const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, token: anon })
    jwt = session.access_token
    page.on('pageerror', error => pageErrors.push(redact(error.message)))
    await page.context().route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.protocol.startsWith('http') && ![APP, API].includes(url.origin)) {
        blockedOrigins.add(url.origin)
        await route.abort()
        return
      }
      if (route.request().method() === 'POST') await guard()
      await route.continue()
    })

    await test.step('real UI login and workspace onboarding', async () => {
      await page.goto(`${APP}/auth/login`)
      await page.getByLabel('Email', { exact: true }).fill(email)
      try { await page.getByLabel('Password', { exact: true }).fill(password) }
      catch { throw new Error('Synthetic password field interaction failed (details redacted)') }
      await page.getByRole('button', { name: 'Login', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/onboarding`)
      await page.getByLabel('Full Name', { exact: true }).fill('Backbeat Synthetic Operator')
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByLabel('Workspace Name', { exact: true }).fill(tag)
      await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard`)
      const workspaces = await request(`/rest/v1/workspaces?name=eq.${tag}`)
      expect(workspaces).toHaveLength(1)
      workspaceId = workspaces[0].id
      await page.screenshot({ path: testInfo.outputPath('01-dashboard.png'), fullPage: true })
    })

    const stageName = `Test Stage ${tag.slice(-8)}`
    const revisedStageName = `${stageName} Revised`
    await test.step('artist create, reload, edit and independent persistence read', async () => {
      await page.getByRole('link', { name: 'Artists', exact: true }).click()
      await page.getByRole('link', { name: 'Add artist', exact: true }).first().click()
      await page.getByLabel('Stage name', { exact: true }).fill(stageName)
      await page.getByLabel('Name', { exact: true }).fill('Luna')
      await page.getByLabel('Surname', { exact: true }).fill('Synthetic')
      for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('button', { name: 'Save and Complete', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Artist successfully added.' })).toBeVisible()
      await page.getByRole('button', { name: 'Ok', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard/artists`)
      await page.reload()
      const artists = await request(`/rest/v1/artists?workspace_id=eq.${workspaceId}`)
      expect(artists).toHaveLength(1)
      expect(artists[0].name).toBe('Luna')
      expect(artists[0].stage_name).toBe(stageName)
      await page.getByRole('link', { name: new RegExp(stageName) }).click()
      await page.getByRole('link', { name: 'Edit', exact: true }).click()
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Luna')
      await page.getByLabel('Stage name', { exact: true }).fill(revisedStageName)
      for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('button', { name: 'Save and Complete', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Artist successfully updated.' })).toBeVisible()
      await page.getByRole('button', { name: 'Ok', exact: true }).click()
      await expect(page).toHaveURL(url => url.pathname === `/dashboard/artists/${artists[0].id}`)
      await page.reload()
      const saved = await request(`/rest/v1/artists?id=eq.${artists[0].id}`)
      expect(saved[0].stage_name).toBe(revisedStageName)
      expect(saved[0].name).toBe('Luna')
      await page.screenshot({ path: testInfo.outputPath('02-artist.png'), fullPage: true })
    })

    await test.step('booking creation, update after reload and visible failed-save recovery', async () => {
      await page.getByRole('button', { name: 'New Booking', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('input[type=date]').fill('2030-01-02')
      await dialog.locator('input[type=time]').nth(0).fill('10:30')
      await dialog.locator('input[type=time]').nth(1).fill('01:30')
      await dialog.getByPlaceholder('Type your message here.').fill(`${tag} initial note`)
      await dialog.getByRole('button', { name: 'Save on calendar', exact: true }).click()
      await expect(dialog.getByRole('heading', { name: /Booking successfully added/ })).toBeVisible()
      await dialog.getByRole('button', { name: 'Start event setup', exact: true }).click()
      await expect(page).toHaveURL(/\/dashboard\/bookings\/[0-9a-f-]+$/)
      const bookingId = new URL(page.url()).pathname.split('/').at(-1)
      await page.reload()
      const notes = page.getByPlaceholder('Type your note here.')
      const startTimeInput = page.locator('input[type=time]').nth(0)
      // Native Chrome time controls plus the leading icon must remain readable.
      expect((await startTimeInput.boundingBox()).width).toBeGreaterThanOrEqual(128)
      await expect(notes).toHaveValue(`${tag} initial note`)
      await notes.fill(`${tag} persisted update`)
      await page.getByRole('button', { name: 'Update booking', exact: true }).click()
      await expect.poll(async () => (await request(`/rest/v1/bookings?id=eq.${bookingId}`))[0].notes).toBe(`${tag} persisted update`)
      await page.reload()
      await expect(notes).toHaveValue(`${tag} persisted update`)
      await page.screenshot({ path: testInfo.outputPath('03-booking-persisted.png'), fullPage: true })

      let failed = false
      await page.route('**/dashboard/bookings/**', async route => {
        if (!failed && route.request().method() === 'POST' && route.request().headers()['next-action']) {
          failed = true
          await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic local test failure' })
        } else await route.fallback()
      })
      await notes.fill(`${tag} should not persist`)
      await page.getByRole('button', { name: 'Update booking', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Unable to save booking. Please try again.' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Update booking', exact: true })).toBeEnabled()
      expect(failed).toBe(true)
      expect((await request(`/rest/v1/bookings?id=eq.${bookingId}`))[0].notes).toBe(`${tag} persisted update`)
      await page.screenshot({ path: testInfo.outputPath('04-save-error.png'), fullPage: true })
      await page.unroute('**/dashboard/bookings/**')
      await notes.fill(`${tag} recovered update`)
      await page.getByRole('button', { name: 'Update booking', exact: true }).click()
      await expect.poll(async () => (await request(`/rest/v1/bookings?id=eq.${bookingId}`))[0].notes).toBe(`${tag} recovered update`)
      await page.reload()
      await expect(notes).toHaveValue(`${tag} recovered update`)
      await expect(page.getByPlaceholder('Venue name', { exact: true })).toBeDisabled()
      await expect(page.getByText(/Not available yet.*fields are not saved/)).toBeVisible()
      for (const time of ['21:15', '09:45']) {
        await page.locator('input[type=time]').nth(0).fill(time)
        await page.locator('input[type=time]').nth(1).fill('01:45')
        await page.getByRole('button', { name: 'Update booking', exact: true }).click()
        await expect.poll(async () => {
          const [saved] = await request(`/rest/v1/bookings?id=eq.${bookingId}`)
          return { time: saved.start_time, duration: saved.duration_minutes }
        }).toEqual({ time: `${time}:00`, duration: 60 + 45 })
        await page.reload()
        await expect(page.locator('input[type=time]').nth(0)).toHaveValue(time)
        await expect(page.locator('input[type=time]').nth(1)).toHaveValue('01:45')
      }
      await page.screenshot({ path: testInfo.outputPath('05-booking-final.png'), fullPage: true })
      expect(pageErrors).toEqual([])
      expect([...blockedOrigins]).toEqual([])
    })
  } finally {
    const cookieNames = await page.context().cookies().then(cookies => cookies.map(cookie => cookie.name)).catch(() => [])
    await testInfo.attach('safe-browser-diagnostics', { body: JSON.stringify({ network, pageErrors, blockedOrigins: [...blockedOrigins], cookieNames }, null, 2), contentType: 'application/json' })
    // Only this invocation's synthetic fixture may be removed.
    await guard()
    if (jwt) {
      const owned = await request(`/rest/v1/workspaces?name=eq.${tag}`)
      for (const workspace of owned) {
        await guard()
        await request(`/rest/v1/workspaces?id=eq.${workspace.id}&name=eq.${tag}`, { method: 'DELETE' })
      }
      expect(await request(`/rest/v1/workspaces?name=eq.${tag}`)).toEqual([])
    }
    const actual = await request(`/auth/v1/admin/users/${userId}`, { admin: true })
    const user = actual.user ?? actual
    expect(user.email === email && user.user_metadata?.synthetic_fixture === tag).toBe(true)
    await guard()
    await request(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', admin: true })
  }
})
