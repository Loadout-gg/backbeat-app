import { test, expect } from '@playwright/test'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, randomUUID } from 'node:crypto'

const APP = 'http://127.0.0.1:3101'
const API = 'http://127.0.0.1:55322'

async function withFixture(page, testInfo, run) {
  test.setTimeout(180_000)
  expect(process.env.BACKBEAT_TEST_URL).toBe(API)
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  expect(Boolean(anon && service && anon !== service)).toBe(true)
  const tag = `ui-ux-${randomUUID()}`
  const email = `${tag}@backbeat.test`
  const password = `${randomBytes(32).toString('base64url')}aA1!`
  let userId, jwt, workspaceId
  const measurements = [], layoutMeasurements = [], errors = [], cleanupFailures = [], blocked = new Set()
  const redact = text => [anon, service, password, jwt].filter(Boolean).reduce((s, value) => s.split(value).join('[REDACTED]'), String(text))
  async function response(path, { method = 'GET', body, admin = false, token = jwt || anon } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid fixed local path')
    if (admin && !/^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?$/.test(path)) throw new Error('Admin fixture lifecycle only')
    try {
      return await fetch(API + path, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { apikey: admin ? service : anon, Authorization: `Bearer ${admin ? service : token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    } catch { throw new Error('Local fixture transport failed; details redacted') }
  }
  async function request(path, options) {
    const r = await response(path, options)
    if (!r.ok) throw new Error(`Local fixture request failed: HTTP ${r.status}`)
    return r.status === 204 ? null : r.json()
  }
  async function guard() {
    expect(await request('/rest/v1/runtime_environment?select=id,environment,synthetic_only', { token: anon })).toEqual([
      { id: 'backbeat-dev', environment: 'development', synthetic_only: true },
    ])
  }
  async function mutate(path, options) { await guard(); return request(path, options) }

  await guard()
  try {
    const created = await mutate('/auth/v1/admin/users', { method: 'POST', admin: true,
      body: { email, password, email_confirm: true, app_metadata: { synthetic_fixture: tag }, user_metadata: { synthetic_fixture: tag } } })
    userId = created.id ?? created.user?.id
    expect(userId).toMatch(/^[0-9a-f-]{36}$/)
    let cookies = []
    const client = createServerClient(API, anon, { cookies: { getAll: () => cookies, setAll: values => {
      for (const value of values) { cookies = cookies.filter(c => c.name !== value.name); cookies.push(value) }
    } } })
    const login = await client.auth.signInWithPassword({ email, password })
    if (login.error || !login.data.session) throw new Error('Synthetic API session setup failed')
    jwt = login.data.session.access_token
    workspaceId = await mutate('/rest/v1/rpc/backbeat_bootstrap_workspace', { method: 'POST', body: { workspace_name: tag } })
    expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/)
    const [workspace] = await request(`/rest/v1/workspaces?id=eq.${workspaceId}`)
    expect(workspace.created_by).toBe(userId)
    expect(await request(`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}`)).toEqual([{ workspace_id: workspaceId, user_id: userId, role: 'master', status: 'active' }])
    expect(await request(`/rest/v1/onboarding_status?user_id=eq.${userId}&select=completed,workspace_id`)).toEqual([{ completed: true, workspace_id: workspaceId }])
    await mutate(`/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', body: { full_name: 'Currency Synthetic Operator', avatar_url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="black"/></svg>') } })
    await page.context().route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.protocol.startsWith('http') && ![APP, API].includes(url.origin)) { blocked.add(url.origin); await route.abort(); return }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) await guard()
      await route.continue()
    })
    page.on('pageerror', e => errors.push(redact(e.message)))
    await page.context().addCookies(cookies.map(c => ({ name: c.name, value: c.value, domain: '127.0.0.1', path: c.options.path ?? '/', secure: false, httpOnly: false, sameSite: 'Lax' })))
    await page.setViewportSize({ width: 1920, height: 1080 })

    const [artist] = await mutate('/rest/v1/artists', { method: 'POST', body: {
      workspace_id: workspaceId, name: 'Dana', surname: 'Test', stage_name: 'Blue Orbit',
      location: 'Test City', fee: 1200, currency: 'EUR',
    } })
    const [booking] = await mutate('/rest/v1/bookings', { method: 'POST', body: {
      workspace_id: workspaceId, artist_id: artist.id, date: '2030-01-18', start_time: '21:30', duration_minutes: 90,
      venue_name: 'North Hall', venue_address: '42 Harbour Road', contact_name_main: 'Alex Venue',
      contact_phone_main: '+39 0600000000', contact_email_main: 'alex@backbeat.test',
      notes: 'Preserve this booking note.', fee_amount_minor: 105000, fee_currency: 'EUR',
    } })
    await run({ artist, booking, request, mutate, measurements })
    expect(errors).toEqual([])
    expect([...blocked]).toEqual([])
  } finally {
    if (workspaceId && jwt) {
      try {
        const [owned] = await request(`/rest/v1/workspaces?id=eq.${workspaceId}&select=id,name,created_by`)
        expect(owned.name === tag && owned.created_by === userId).toBe(true)
        await mutate(`/rest/v1/workspaces?id=eq.${workspaceId}&name=eq.${tag}`, { method: 'DELETE' })
        expect(await request(`/rest/v1/workspaces?id=eq.${workspaceId}&select=id`)).toEqual([])
      } catch { cleanupFailures.push('Workspace cleanup failed') }
    }
    if (userId) {
      try {
        const user = await request(`/auth/v1/admin/users/${userId}`, { admin: true })
        const owned = user.user ?? user
        expect(owned.email === email && owned.app_metadata?.synthetic_fixture === tag).toBe(true)
        await mutate(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', admin: true })
        expect((await response(`/auth/v1/admin/users/${userId}`, { admin: true })).status).toBe(404)
      } catch { cleanupFailures.push('Auth cleanup failed') }
    }
    const diagnostic = redact(JSON.stringify({ tag, userId, workspaceId, measurements, layoutMeasurements, errors, blockedOrigins: [...blocked], cleanupFailures }, null, 2))
    await testInfo.attach('safe-ux-diagnostics', { body: diagnostic, contentType: 'application/json' }).catch(() => {})
    expect(cleanupFailures).toEqual([])
  }
}

test('UX-01 artist profiles fit mobile and desktop with reachable actions and tabs', async ({ page }, info) => {
  await withFixture(page, info, async ({ artist, mutate, measurements }) => {
    for (const name of ['Blue Orbit', 'The Midnight Echo Collective With A Deliberately Long Stage Name']) {
      await mutate(`/rest/v1/artists?id=eq.${artist.id}`, { method: 'PATCH', body: { stage_name: name } })
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`${APP}/dashboard/artists/${artist.id}`)
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
        const tabs = page.getByRole('tab')
        const count = await tabs.count()
        expect(count).toBeGreaterThanOrEqual(4)
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i)
          await tab.click()
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }))
          measurements.push({ label: 'profile-layout', name, tab: await tab.innerText(), width, ...geometry })
          expect.soft(geometry.scroll, `${name} ${width} tab ${i}`).toBeLessThanOrEqual(width + 1)
        }
        await tabs.first().click()
        const booking = page.getByRole('button', { name: 'New Booking', exact: true })
        const box = await booking.boundingBox()
        expect.soft(box.x).toBeGreaterThanOrEqual(0)
        expect.soft(box.x + box.width).toBeLessThanOrEqual(width + 1)
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ animations: 'disabled', path: info.outputPath(`profile-${name === 'Blue Orbit' ? 'short' : 'long'}-${width}.png`), fullPage: true })
        await booking.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }
  })
})

async function january2030(page, artist) {
  await page.goto(`${APP}/dashboard/artists/${artist.id}?tab=calendar`)
  const panel = page.getByRole('tabpanel', { name: 'Calendar', exact: true })
  const calendar = panel.locator('[data-slot="calendar"]')
  await expect(calendar).toBeVisible()
  for (let i = 0; i < 60 && !((await calendar.innerText()).includes('January 2030')); i++) {
    await calendar.getByRole('button', { name: /next month/i }).click()
  }
  await expect(calendar).toContainText('January 2030')
  return { panel, calendar }
}

test('UX-02 occupied dates stay marked through empty and booked day clicks', async ({ page }, info) => {
  await withFixture(page, info, async ({ artist, booking, request, measurements }) => {
    const { panel, calendar } = await january2030(page, artist)
    const booked = calendar.getByText('18', { exact: true })
    const free = calendar.getByText('19', { exact: true })
    const occupied = day => day.evaluate(el => Boolean(el.closest('[data-booked="true"]')))
    const before = await request(`/rest/v1/bookings?id=eq.${booking.id}`)
    for (const [label, day] of [['initial', null], ['empty-click', free], ['booked-click', booked], ['booked-click-again', booked]]) {
      if (day) await day.click()
      const state = { label, booked: await occupied(booked), free: await occupied(free) }
      measurements.push(state)
      expect.soft(state.booked, label).toBe(true)
      expect.soft(state.free, label).toBe(false)
      await expect(panel.locator(`a[href="/dashboard/bookings/${booking.id}"]`)).toHaveCount(1)
      await calendar.scrollIntoViewIfNeeded()
      await page.screenshot({ animations: 'disabled', path: info.outputPath(`calendar-${label}.png`) })
    }
    expect(await request(`/rest/v1/bookings?id=eq.${booking.id}`)).toEqual(before)
  })
})

test('UX-03 keyboard save retains focus and announces saved state', async ({ page }, info) => {
  await withFixture(page, info, async ({ booking, artist, request, measurements }) => {
    await page.goto(`${APP}/dashboard/bookings/${booking.id}`)
    const financial = page.getByRole('tab', { name: 'Financial', exact: true })
    await financial.click()
    const amount = page.getByLabel('Booking fee amount', { exact: true })
    await amount.focus()
    await page.keyboard.press('Meta+A')
    await page.keyboard.type('1051')
    const save = page.getByRole('button', { name: 'Update booking', exact: true })
    for (let i = 0; i < 10 && !(await save.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(save).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await request(`/rest/v1/bookings?id=eq.${booking.id}`))[0].fee_amount_minor).toBe(105100)
    await expect.soft(save).toBeFocused()
    await expect.soft(page.getByRole('main').getByRole('status')).toContainText(/saved/i)
    measurements.push({ label: 'saved-focus', focus: await page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent })) })
    await save.scrollIntoViewIfNeeded()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('save-keyboard-focus.png') })
    await page.keyboard.press('Shift+Tab')
    expect.soft(await page.evaluate(() => document.activeElement.textContent.trim())).toBe('Delete')
    await page.reload()
    await financial.click()
    await expect(amount).toHaveValue('1051.00')
    const [savedArtist] = await request(`/rest/v1/artists?id=eq.${artist.id}`)
    expect(savedArtist.fee).toBe(1200)
    expect(savedArtist.currency).toBe('EUR')
  })
})

test('UX-04 negative fee explains the cause and focuses its associated invalid input', async ({ page }, info) => {
  await withFixture(page, info, async ({ booking, request, measurements }) => {
    await page.goto(`${APP}/dashboard/bookings/${booking.id}`)
    await page.getByRole('tab', { name: 'Financial', exact: true }).click()
    const amount = page.getByLabel('Booking fee amount', { exact: true })
    const save = page.getByRole('button', { name: 'Update booking', exact: true })
    await amount.fill('-10')
    await save.click()
    await expect.soft(page.getByRole('main')).toContainText(/cannot be negative|zero or greater|non-negative|at least 0/i)
    await expect.soft(amount).toHaveAttribute('aria-invalid', 'true')
    await expect.soft(amount).toBeFocused()
    const association = await amount.evaluate(el => ({ ids: el.getAttribute('aria-describedby'), description: (el.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ') }))
    measurements.push({ label: 'negative-fee', ...association })
    expect.soft(association.description).toMatch(/cannot be negative|zero or greater|non-negative|at least 0/i)
    expect((await request(`/rest/v1/bookings?id=eq.${booking.id}`))[0].fee_amount_minor).toBe(105000)
    await amount.scrollIntoViewIfNeeded()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('negative-fee-associated-error.png') })
    await amount.fill('1052')
    await save.click()
    await expect.poll(async () => (await request(`/rest/v1/bookings?id=eq.${booking.id}`))[0].fee_amount_minor).toBe(105200)
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')
    const saved = (await request(`/rest/v1/bookings?id=eq.${booking.id}`))[0]
    expect(saved).toMatchObject({ date: '2030-01-18', start_time: '21:30:00', fee_currency: 'EUR', notes: 'Preserve this booking note.' })
  })
})

test('UX-05 footer does not expose unimplemented routes', async ({ page }, info) => {
  await withFixture(page, info, async ({ artist }) => {
    await page.goto(`${APP}/dashboard/artists/${artist.id}`)
    const footer = page.locator('footer')
    await expect(footer).toBeVisible()
    for (const label of ['Help', 'Terms', 'Privacy', 'Contact']) {
      await expect.soft(footer.getByRole('link', { name: label, exact: true })).toHaveCount(0)
      await expect(footer).toContainText(label)
      await expect(footer).toContainText('currently unavailable')
    }
    await footer.scrollIntoViewIfNeeded()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('footer-unavailable.png') })
  })
})

test('UX-06 calendar exposes one month heading and one named navigation pair', async ({ page }, info) => {
  await withFixture(page, info, async ({ artist }) => {
    const { panel, calendar } = await january2030(page, artist)
    await expect.soft(panel.getByText('January 2030', { exact: true })).toHaveCount(1)
    const unnamed = await panel.locator('button').evaluateAll(buttons => buttons.filter(button => !button.textContent.trim() && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby')).length)
    expect.soft(unnamed).toBe(0)
    await expect(panel.getByRole('button', { name: /next month/i })).toHaveCount(1)
    await expect(panel.getByRole('button', { name: /previous month/i })).toHaveCount(1)
    const next = calendar.getByRole('button', { name: /next month/i })
    await next.click()
    await expect(calendar).toContainText('February 2030')
    await expect(next).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(calendar).toContainText('March 2030')
    const previous = calendar.getByRole('button', { name: /previous month/i })
    await previous.click()
    await expect(previous).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(calendar).toContainText('January 2030')
    await calendar.scrollIntoViewIfNeeded()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('calendar-single-navigation.png') })
  })
})
