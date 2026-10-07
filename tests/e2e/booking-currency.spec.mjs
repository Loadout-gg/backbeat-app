import { test, expect, chromium } from '@playwright/test'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, randomUUID } from 'node:crypto'

const APP = 'http://127.0.0.1:3101'
const API = 'http://127.0.0.1:55322'

test('artist base-rate denomination survives profile, booking creation and saved booking without changing financial data', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  expect(process.env.BACKBEAT_TEST_URL).toBe(API)
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  expect(Boolean(anon && service && anon !== service)).toBe(true)
  const tag = `ui-currency-${randomUUID()}`
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
  const readArtists = () => request(`/rest/v1/artists?workspace_id=eq.${workspaceId}&order=id`)

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

    let uiArtist
    await test.step('ordinary UI-created GBP artist keeps its denomination in New Booking', async () => {
      await page.goto(`${APP}/dashboard/artists/new`)
      await page.getByLabel('Stage name', { exact: true }).fill('Currency UI Artist')
      await page.getByLabel('Name', { exact: true }).fill('Alex')
      await page.getByLabel('Surname', { exact: true }).fill('Synthetic')
      await page.getByLabel('Base rate', { exact: true }).fill('400')
      await page.getByRole('combobox').filter({ hasText: '$' }).click()
      await page.getByRole('option', { name: '£', exact: true }).click()
      for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('button', { name: 'Save and Complete', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Artist successfully added.' })).toBeVisible()
      await page.getByRole('button', { name: 'Ok', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard/artists`)
      ;[uiArtist] = await readArtists()
      expect(uiArtist).toMatchObject({ fee: 400, currency: '£' })
      await page.getByRole('link', { name: /Currency UI Artist/ }).click()
      await expect(page.getByText('£400/event', { exact: true })).toBeVisible()
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('01-ui-profile-gbp.png') })
      await page.getByRole('button', { name: 'New Booking', exact: true }).click()
      await expect(page.getByRole('dialog').getByText('£400', { exact: true })).toBeVisible()
      await expect(page.getByRole('dialog').getByText('$400', { exact: true })).toHaveCount(0)
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('02-ui-modal-gbp.png') })
      const modal = page.getByRole('dialog')
      const originalViewport = page.viewportSize()
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 800 }]) {
        await page.setViewportSize(viewport)
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel('Select date', { exact: true }).fill('2030-01-02')
        // Resize can precede completion of native dialog layout/animations.
        // Finish the finite transitions before measuring the settled surface.
        await dialog.evaluate(async () => {
          await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})))
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        })
        for (const [label, value] of [['Start time', '21:30'], ['Duration', '01:30']]) {
          const control = dialog.getByLabel(label, { exact: true })
          await control.fill(value)
          await expect(control).toHaveValue(value)
          await control.scrollIntoViewIfNeeded()
          const geometry = await control.evaluate(el => {
            const r = el.getBoundingClientRect()
            return { left: r.left, right: r.right, width: r.width, client: el.clientWidth, scroll: el.scrollWidth }
          })
          expect(geometry.left).toBeGreaterThanOrEqual(0)
          expect(geometry.right).toBeLessThanOrEqual(viewport.width)
          expect(geometry.width).toBeGreaterThanOrEqual(170)
          expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
        }
        await dialog.getByRole('button', { name: 'Save on calendar', exact: true }).scrollIntoViewIfNeeded()
        await expect(dialog.getByRole('button', { name: 'Save on calendar', exact: true })).toBeVisible()
        await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`time-modal-${viewport.width}x${viewport.height}.png`) })
        await dialog.getByLabel('Start time', { exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`time-controls-${viewport.width}x${viewport.height}.png`) })
        layoutMeasurements.push({ label: 'time-modal', ...viewport, start: '21:30', duration: '01:30', saveReachable: true })
      }
      await test.step('native Chrome 200 percent zoom retains readable time controls', async () => {
        // Empty userDataDir creates a disposable profile. Only trusted settings
        // use that profile; the synthetic session stays in memory/incognito.
        const owner = await chromium.launchPersistentContext('', { channel: 'chrome', headless: true })
        let zoomContext
        try {
          const settings = await owner.newPage()
          await settings.goto('chrome://settings/appearance')
          await settings.evaluate(() => new Promise(resolve => chrome.settingsPrivate.setDefaultZoom(2, resolve)))
          const zoom = await settings.evaluate(() => new Promise(resolve => chrome.settingsPrivate.getDefaultZoom(resolve)))
          expect(zoom).toBe(2)
          zoomContext = await owner.browser().newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'Europe/Rome' })
          await zoomContext.route('**/*', async route => {
            const url = new URL(route.request().url())
            if (url.protocol.startsWith('http') && ![APP, API].includes(url.origin)) { blocked.add(url.origin); await route.abort(); return }
            if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) await guard()
            await route.continue()
          })
          const zoomPage = await zoomContext.newPage()
          zoomPage.on('pageerror', e => errors.push(redact(e.message)))
          await zoomPage.goto(`${APP}/dashboard/artists/${uiArtist.id}`)
          await zoomPage.getByRole('button', { name: 'New Booking', exact: true }).click()
          const dialog = zoomPage.getByRole('dialog')
          await dialog.getByLabel('Select date', { exact: true }).fill('2030-01-02')
          const display = await zoomPage.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
          expect(display).toEqual({ width: 720, height: 450, dpr: 2 })
          for (const [label, value] of [['Start time', '21:30'], ['Duration', '01:30']]) {
            const control = dialog.getByLabel(label, { exact: true })
            await control.fill(value)
            await expect(control).toHaveValue(value)
            await control.scrollIntoViewIfNeeded()
            await zoomPage.screenshot({ animations: 'disabled', path: testInfo.outputPath(`time-zoom200-${label.replaceAll(' ', '-')}.png`) })
          }
          await dialog.getByRole('button', { name: 'Save on calendar', exact: true }).scrollIntoViewIfNeeded()
          await expect(dialog.getByRole('button', { name: 'Save on calendar', exact: true })).toBeVisible()
          await zoomPage.screenshot({ animations: 'disabled', path: testInfo.outputPath('time-zoom200-save.png') })
          layoutMeasurements.push({ label: 'time-native-chrome-zoom', zoom, ...display, saveReachable: true })
        } finally {
          if (zoomContext) await zoomContext.close()
          await owner.close()
        }
      })
      if (originalViewport) await page.setViewportSize(originalViewport)
      await modal.locator('input[type=date]').fill('2030-01-02')
      await modal.locator('input[type=time]').nth(0).fill('20:30')
      await modal.locator('input[type=time]').nth(1).fill('01:30')
      await modal.getByRole('button', { name: 'Save on calendar', exact: true }).click()
      await expect(modal.getByRole('heading', { name: /Booking successfully added/ })).toBeVisible()
      await modal.getByRole('button', { name: 'Start event setup', exact: true }).click()
      await expect(page).toHaveURL(/\/dashboard\/bookings\/[0-9a-f-]+$/)
      await page.reload()
      await expect(page.getByRole('main').getByText('£400', { exact: true })).toBeVisible()
      await page.getByRole('tab', { name: 'Financial', exact: true }).click()
      const financial = page.getByRole('tabpanel', { name: 'Financial', exact: true })
      await expect(financial.getByLabel('Booking fee amount', { exact: true })).toHaveValue('')
      await expect(financial.getByLabel('Booking fee currency', { exact: true })).toHaveValue('')
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('03-ui-saved-booking-gbp.png') })
      expect(await readArtists()).toEqual([uiArtist])
      measurements.push({ label: 'ui-created-GBP', currencyStored: uiArtist.currency, fee: uiArtist.fee, profile: true, modal: true, savedBooking: true, artistUnchanged: true, bookingFeeInitiallyUnset: true })
    })

    const cases = [
      { label: 'gbp-code', currency: 'GBP', fee: 700, display: '£700' },
      { label: 'eur-symbol', currency: '€', fee: 250, display: '€250' },
      { label: 'eur-code', currency: 'EUR', fee: 0, display: '€0' },
      { label: 'usd-code', currency: 'USD', fee: 1200.5, display: '$1,200.5' },
      { label: 'usd-symbol', currency: '$', fee: 80, display: '$80' },
      { label: 'other-code', currency: 'CHF', fee: 300, display: 'CHF 300' },
      { label: 'missing-currency', currency: null, fee: 250, display: '250 (currency unavailable)' },
      { label: 'blank-currency', currency: '   ', fee: 0, display: '0 (currency unavailable)' },
      { label: 'missing-rate', currency: 'GBP', fee: null, display: 'N/A' },
    ]
    const rows = cases.map(c => ({ workspace_id: workspaceId, stage_name: `Currency ${c.label}`, name: 'Synthetic', fee: c.fee, currency: c.currency }))
    const artists = await mutate('/rest/v1/artists', { method: 'POST', body: rows })
    for (const c of cases) {
      await test.step(`stored denomination case: ${c.label}`, async () => {
        const a = artists.find(row => row.stage_name === `Currency ${c.label}`)
        const [b] = await mutate('/rest/v1/bookings', { method: 'POST', body: { workspace_id: workspaceId, artist_id: a.id, date: '2030-01-03', start_time: '20:30', duration_minutes: 90, status: 'in_progress' } })
        await page.goto(`${APP}/dashboard/artists/${a.id}`)
        await expect(page.getByRole('heading', { name: a.stage_name, exact: true })).toBeVisible()
        const profileRate = page.getByText('Base rate', { exact: true }).locator('..')
        await expect(profileRate).toContainText(c.fee === null ? 'Not specified' : `${c.display}/event`)
        await page.getByRole('button', { name: 'New Booking', exact: true }).click()
        await expect(page.getByRole('dialog').getByText(c.display, { exact: true })).toBeVisible()
        await page.goto(`${APP}/dashboard/bookings/${b.id}`)
        await expect(page.getByRole('main').getByText(c.display, { exact: true })).toBeVisible()
        if (c.label === 'missing-currency') {
          for (const viewport of [
            { width: 1440, height: 960 }, { width: 1920, height: 1080 },
            { width: 2560, height: 1440 }, { width: 2560, height: 1600 },
            { width: 3840, height: 2160 }, { width: 1024, height: 768 },
            { width: 390, height: 844 }, { width: 320, height: 800 },
          ]) {
            await page.setViewportSize(viewport)
            const labelLines = await page.getByText('Location', { exact: true }).evaluate(el => {
              const range = document.createRange()
              range.selectNodeContents(el)
              return range.getClientRects().length
            })
            expect(labelLines, `unavailable currency must not crush Location at ${viewport.width}`).toBe(1)
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)
            await expect(page.getByRole('main').getByText(c.display, { exact: true })).toBeVisible()
            if (viewport.width === 320) await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('missing-currency-320.png') })
          }
          await page.setViewportSize({ width: 1920, height: 1080 })
        }
        const [savedArtist] = await request(`/rest/v1/artists?id=eq.${a.id}`)
        const [savedBooking] = await request(`/rest/v1/bookings?id=eq.${b.id}`)
        expect(savedArtist).toEqual(a)
        expect(savedBooking).toEqual(b)
        measurements.push({ label: c.label, expected: c.display, storedCurrency: savedArtist.currency, storedFee: savedArtist.fee, profile: true, modal: true, booking: true, recordsUnchanged: true })
        if (['eur-code', 'missing-currency', 'missing-rate'].includes(c.label)) await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${c.label}.png`) })
      })
    }
    expect(measurements).toHaveLength(cases.length + 1)
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
    await testInfo.attach('safe-currency-diagnostics', { body: diagnostic, contentType: 'application/json' }).catch(() => {})
    expect(cleanupFailures).toEqual([])
  }
})
