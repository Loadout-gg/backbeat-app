import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'

const APP = 'http://127.0.0.1:3101'
const API = 'http://127.0.0.1:55322'

test('Agent dashboard preserves truthful data and works across desktop and mobile navigation', async ({ page }, testInfo) => {
  expect(process.env.BACKBEAT_TEST_URL).toBe(API)
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  expect(Boolean(anon && service && anon !== service)).toBe(true)
  const tag = `ui-m3-${randomUUID()}`
  const email = `${tag}@backbeat.test`
  const password = `${randomBytes(32).toString('base64url')}aA1!`
  let userId
  let jwt
  let workspaceId
  const errors = []
  const blocked = new Set()
  const measurements = []

  async function request(path, { method = 'GET', body, admin = false, token = jwt } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid fixed local path')
    if (admin && !/^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?$/.test(path)) throw new Error('Admin scope violation')
    const response = await fetch(API + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { apikey: admin ? service : anon, Authorization: `Bearer ${admin ? service : token || anon}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`Local fixture request failed: HTTP ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  async function guard() {
    expect(await request('/rest/v1/runtime_environment?select=id,environment,synthetic_only', { token: anon })).toEqual([
      { id: 'backbeat-dev', environment: 'development', synthetic_only: true },
    ])
  }
  async function mutate(path, options) {
    await guard()
    return request(path, options)
  }
  async function noOverflow(label) {
    const result = await page.evaluate(() => ({
      viewport: window.innerWidth, width: document.documentElement.scrollWidth,
      viewportHeight: window.innerHeight, height: document.documentElement.scrollHeight,
      footerBottom: document.querySelector('footer')?.getBoundingClientRect().bottom ?? 0,
    }))
    measurements.push({ label, ...result })
    expect(result.width, `${label}: no page-level horizontal overflow`).toBeLessThanOrEqual(result.viewport + 1)
    if (label === 'desktop-empty') {
      expect(result.height, 'empty desktop shell fits the viewport').toBeLessThanOrEqual(result.viewportHeight + 1)
      expect(result.footerBottom, 'empty desktop footer anchors the content area').toBeGreaterThanOrEqual(result.viewportHeight - 40)
    }
  }

  await guard()
  try {
    const fixture = await mutate('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true, user_metadata: { synthetic_fixture: tag } } })
    userId = fixture.id ?? fixture.user?.id
    expect(userId).toMatch(/^[0-9a-f-]{36}$/)
    const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, token: anon })
    jwt = session.access_token
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 400)))
    await page.context().route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.protocol.startsWith('http') && ![APP, API].includes(url.origin)) {
        blocked.add(url.origin)
        await route.abort()
        return
      }
      if (route.request().method() === 'POST') await guard()
      await route.continue()
    })
    await page.goto(`${APP}/auth/login`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    try { await page.getByLabel('Password', { exact: true }).fill(password) }
    catch { throw new Error('Synthetic password interaction failed; details redacted') }
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page).toHaveURL(`${APP}/onboarding`)
    await page.getByLabel('Full Name', { exact: true }).fill('Backbeat Synthetic Operator With A Long Account Name')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Workspace Name', { exact: true }).fill(tag)
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(page).toHaveURL(`${APP}/dashboard`)
    const owned = await request(`/rest/v1/workspaces?name=eq.${tag}`)
    expect(owned).toHaveLength(1)
    workspaceId = owned[0].id

    await test.step('empty dashboard has real metrics and creation affordances', async () => {
      await expect(page.getByText('Performance in progress', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'New Booking', exact: true }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Add artist', exact: true }).first()).toBeVisible()
      await noOverflow('desktop-empty')
      await page.screenshot({ path: testInfo.outputPath('01-dashboard-empty.png'), fullPage: true })
    })

    const artistName = 'Synthetic Artist With A Deliberately Long Stage Name For Responsive Layout Verification'
    const [artist] = await mutate('/rest/v1/artists', { method: 'POST', body: { workspace_id: workspaceId, name: 'Synthetic Artist', stage_name: artistName } })
    const date = '2027-01-18'
    const venue = 'Synthetic North Harbour Performance Hall'
    const address = 'Synthetic address 42, Harbour district, Test City'
    const [booking] = await mutate('/rest/v1/bookings', { method: 'POST', body: { workspace_id: workspaceId, artist_id: artist.id, date, start_time: '21:15', duration_minutes: 90, venue_name: venue, venue_address: address } })
    await mutate('/rest/v1/events', { method: 'POST', body: { workspace_id: workspaceId, artist_id: artist.id, title: 'Synthetic Performance', date, location: 'Synthetic Harbour', status: 'in_progress' } })
    await mutate(`/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', body: { avatar_url: `${APP}/placeholder-user.jpg` } })
    await page.reload()

    await test.step('populated dashboard uses saved venue and does not invent an event time range', async () => {
      const contrast = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const rgba = css => {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1)
          return Array.from(ctx.getImageData(0, 0, 1, 1).data)
        }
        const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255))
        const luminance = color => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
        return [...document.querySelectorAll('[class*="text-muted-foreground"]')].filter(el => el.getBoundingClientRect().width > 0 && el.textContent.trim()).map(el => {
          const layers = []; let node = el
          while (node) { layers.unshift(rgba(getComputedStyle(node).backgroundColor)); node = node.parentElement }
          const bg = layers.reduce((color, layer) => blend(layer, color), [255, 255, 255])
          const fg = blend(rgba(getComputedStyle(el).color), bg)
          const a = luminance(fg); const b = luminance(bg)
          return { text: el.textContent.trim().slice(0, 70), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: getComputedStyle(el).color, background: bg }
        })
      })
      measurements.push({ label: 'muted-text-contrast', contrast })
      expect(contrast.length).toBeGreaterThan(0)
      for (const sample of contrast) expect(sample.ratio, sample.text).toBeGreaterThanOrEqual(4.5)
      measurements.push({ label: 'rendered-typography', ...(await page.evaluate(() => ({
        fontFamily: getComputedStyle(document.body).fontFamily,
        headingSize: getComputedStyle(document.querySelector('main h1')).fontSize,
      }))) })
      const accountImage = page.getByRole('button', { name: /^Account menu for/ }).locator('img')
      await expect(accountImage).toBeVisible()
      await expect.poll(() => accountImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
      await expect(page.getByText(venue, { exact: false }).first()).toBeVisible()
      await expect(page.getByText(address, { exact: false }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Continue setup', exact: true })).toHaveAttribute('href', `/dashboard/bookings/${booking.id}`)
      await expect(page.getByText(/12:00 AM\s*-\s*2:00 AM/)).toHaveCount(0)
      await noOverflow('desktop-populated')
      await page.screenshot({ path: testInfo.outputPath('02-dashboard-desktop.png'), fullPage: true })
    })

    await test.step('tablet and mobile retain readable content and keyboard-operable navigation', async () => {
      for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 800 }, { width: 320, height: 800 }]) {
        await page.setViewportSize(viewport)
        await noOverflow(`dashboard-${viewport.width}`)
        await expect(page.getByRole('link', { name: 'Continue setup', exact: true })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`03-dashboard-${viewport.width}.png`), fullPage: true })
      }
      const trigger = page.getByRole('button', { name: 'Open navigation', exact: true })
      await trigger.click()
      const navigation = page.getByRole('dialog', { name: 'Navigation', exact: true })
      await expect(navigation).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(navigation).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.click()
      await navigation.getByRole('link', { name: 'Artists', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard/artists`)
      await expect(navigation).toBeHidden()
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await page.getByRole('dialog', { name: 'Navigation', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard`)
      await noOverflow('mobile-after-navigation')
    })

    await test.step('existing creation dialog and booking editor remain reachable', async () => {
      await page.setViewportSize({ width: 1440, height: 960 })
      await page.getByRole('button', { name: 'New Booking', exact: true }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await page.getByRole('link', { name: 'Continue setup', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard/bookings/${booking.id}`)
      await expect(page.getByPlaceholder('Venue name', { exact: true })).toHaveValue(venue)
      expect((await request(`/rest/v1/bookings?id=eq.${booking.id}`))[0].venue_address).toBe(address)
      expect(errors).toEqual([])
      expect([...blocked]).toEqual([])
    })
    await test.step('account settings and sign out retain real navigation', async () => {
      await page.getByRole('button', { name: /^Account menu for/ }).click()
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard/settings`)
      // Settings uses a document navigation: verify hydration via the loaded
      // Radix avatar before sending a keyboard event to its new account menu.
      await expect(page.getByRole('button', { name: /^Account menu for/ }).locator('img')).toBeVisible()
      await page.getByRole('button', { name: /^Account menu for/ }).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/auth/login`)
      expect(errors).toEqual([])
      expect([...blocked]).toEqual([])
    })
  } finally {
    const secrets = [password, anon, service, jwt].filter(Boolean)
    const safe = secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), JSON.stringify({ measurements, errors, blockedOrigins: [...blocked] }, null, 2))
    await testInfo.attach('safe-m3-diagnostics', { body: safe, contentType: 'application/json' }).catch(() => {})
    await guard()
    if (jwt) {
      for (const workspace of await request(`/rest/v1/workspaces?name=eq.${tag}`)) {
        await mutate(`/rest/v1/workspaces?id=eq.${workspace.id}&name=eq.${tag}`, { method: 'DELETE' })
      }
      expect(await request(`/rest/v1/workspaces?name=eq.${tag}`)).toEqual([])
    }
    if (userId) {
      const actual = await request(`/auth/v1/admin/users/${userId}`, { admin: true })
      const user = actual.user ?? actual
      expect(user.email === email && user.user_metadata?.synthetic_fixture === tag).toBe(true)
      await mutate(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', admin: true })
    }
  }
})
