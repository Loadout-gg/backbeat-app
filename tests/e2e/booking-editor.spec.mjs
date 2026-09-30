import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'

const APP = 'http://127.0.0.1:3101'
const API = 'http://127.0.0.1:55322'
const EDITOR_VIEWPORTS = [
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 2560, height: 1600 },
  { width: 3840, height: 2160 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 800 },
]

test('Booking editor preserves saved data, accessible tabs and usable narrow layouts', async ({ page, browser }, testInfo) => {
  expect(process.env.BACKBEAT_TEST_URL).toBe(API)
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  expect(Boolean(anon && service && anon !== service)).toBe(true)
  const tag = `ui-m4-${randomUUID()}`
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

    const artistName = 'Synthetic Artist With A Deliberately Long Stage Name For Booking Layout Verification'
    const [artist] = await mutate('/rest/v1/artists', { method: 'POST', body: {
      workspace_id: workspaceId, name: 'Synthetic', surname: 'Performer', stage_name: artistName,
      location: 'Synthetic North Harbour District, Test City', fee: 0, currency: 'EUR',
    } })
    const fields = [
      ['venue_name', 'Venue name', 'Synthetic Harbour Performance Hall'],
      ['venue_address', 'Venue Address', '42 Synthetic Harbour Road, Test City'],
      ['contact_name_main', 'Contact name (main)', 'Synthetic Contact'],
      ['contact_phone_main', 'Phone number', '+39 0600000000'],
      ['contact_email_main', 'Email', 'layout.contact@backbeat.test'],
    ]
    const [booking] = await mutate('/rest/v1/bookings', { method: 'POST', body: {
      workspace_id: workspaceId, artist_id: artist.id, date: '2027-01-18', start_time: '21:15', duration_minutes: 90,
      ...Object.fromEntries(fields.map(([key,,value]) => [key, value])), notes: 'Synthetic saved booking note',
    } })
    await page.reload()
    await page.getByRole('link', { name: 'Continue setup', exact: true }).click()
    await expect(page).toHaveURL(`${APP}/dashboard/bookings/${booking.id}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Event Booking', exact: true })).toBeVisible()
    for (const [,label,value] of fields) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value)

    await test.step('all supported inputs fit the editor at the fixed viewport matrix', async () => {
      const layouts = []
      for (const viewport of EDITOR_VIEWPORTS) {
        await page.setViewportSize(viewport)
        await page.evaluate(() => window.scrollTo(0, 0))
        const layout = await page.evaluate(() => ({
          viewport: innerWidth,
          width: document.documentElement.scrollWidth,
          controls: [...document.querySelectorAll('main input:not(:disabled), main textarea:not(:disabled)')].map(el => {
            const r = el.getBoundingClientRect()
            return { label: el.id || el.type, left: r.left, right: r.right, width: r.width }
          }),
          endTime: (() => {
            const label = [...document.querySelectorAll('main label')].find(el => el.textContent.trim() === 'End time')
            const r = label?.parentElement?.getBoundingClientRect()
            return r ? { left: r.left, right: r.right, width: r.width } : null
          })(),
          save: (() => {
            const button = [...document.querySelectorAll('main button')].find(el => el.textContent.trim() === 'Update booking')
            const r = button?.getBoundingClientRect()
            return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null
          })(),
          viewportHeight: innerHeight,
          dpr: devicePixelRatio,
          formWidth: (() => {
            const boxes = [...document.querySelectorAll('main input:not(:disabled), main textarea:not(:disabled)')].map(el => el.getBoundingClientRect())
            return boxes.length ? Math.max(...boxes.map(r => r.right)) - Math.min(...boxes.map(r => r.left)) : 0
          })(),
          inputFontSizes: [...document.querySelectorAll('main input:not(:disabled), main textarea:not(:disabled)')].map(el => parseFloat(getComputedStyle(el).fontSize)),
        }))
        layouts.push(layout)
        measurements.push({ label: `editor-${viewport.width}x${viewport.height}`, ...layout })
        if (viewport.width >= 1024) await page.screenshot({ path: testInfo.outputPath(`editor-${viewport.width}x${viewport.height}-viewport.png`) })
        await page.screenshot({ path: testInfo.outputPath(`editor-${viewport.width}x${viewport.height}.png`), fullPage: true })
      }
      expect(layouts).toHaveLength(EDITOR_VIEWPORTS.length)
      expect(new Set(layouts.map(layout => `${layout.viewport}x${layout.viewportHeight}`)).size).toBe(EDITOR_VIEWPORTS.length)
      for (const layout of layouts) {
        expect(layout.width, `page overflow at ${layout.viewport}`).toBeLessThanOrEqual(layout.viewport + 1)
        expect(layout.controls.length).toBeGreaterThanOrEqual(8)
        expect(layout.dpr).toBe(1)
        for (const size of layout.inputFontSizes) expect(size, 'fields retain normal CSS type size on large desktops').toBeGreaterThanOrEqual(14)
        if (layout.viewport >= 1920) expect(layout.formWidth, 'editor remains bounded on wide desktops').toBeLessThanOrEqual(1280)
        for (const control of layout.controls) {
          expect(control.left, `${control.label} left at ${layout.viewport}`).toBeGreaterThanOrEqual(0)
          expect(control.right, `${control.label} right at ${layout.viewport}`).toBeLessThanOrEqual(layout.viewport + 1)
          expect(control.width, `${control.label} width at ${layout.viewport}`).toBeGreaterThanOrEqual(80)
        }
        expect(layout.endTime, 'labelled End time remains present').not.toBeNull()
        expect(layout.endTime.right, `end-time clipping at ${layout.viewport}`).toBeLessThanOrEqual(layout.viewport + 1)
        if (layout.viewport >= 1024) {
          expect(layout.save, 'desktop save action remains present').not.toBeNull()
          expect(layout.save.top, 'desktop save action is in the viewport').toBeGreaterThanOrEqual(0)
          expect(layout.save.bottom, 'desktop action bar is reachable without scrolling').toBeLessThanOrEqual(layout.viewportHeight)
        }
      }
    })

    await test.step('HiDPI desktop retains the logical layout and readable controls', async () => {
      // Reuse only this disposable synthetic session in memory; never persist
      // storage state or cookies and never access a personal browser profile.
      const context = await browser.newContext({
        storageState: await page.context().storageState(),
        viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2,
        locale: 'en-US', timezoneId: 'Europe/Rome',
      })
      try {
        await context.route('**/*', async route => {
          const url = new URL(route.request().url())
          if (url.protocol.startsWith('http') && ![APP, API].includes(url.origin)) {
            blocked.add(url.origin); await route.abort(); return
          }
          if (route.request().method() === 'POST') await guard()
          await route.continue()
        })
        const highDpiPage = await context.newPage()
        highDpiPage.on('pageerror', error => errors.push(String(error.message).slice(0, 400)))
        await highDpiPage.goto(`${APP}/dashboard/bookings/${booking.id}`)
        await expect(highDpiPage.getByRole('heading', { level: 1, name: 'Event Booking', exact: true })).toBeVisible()
        await expect(highDpiPage.getByLabel('Venue name', { exact: true })).toHaveValue('Synthetic Harbour Performance Hall')
        const display = await highDpiPage.evaluate(() => ({
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          pageWidth: document.documentElement.scrollWidth,
          physicalWidth: innerWidth * devicePixelRatio,
          physicalHeight: innerHeight * devicePixelRatio,
          controls: [...document.querySelectorAll('main input:not(:disabled), main textarea:not(:disabled)')].map(el => {
            const r = el.getBoundingClientRect()
            return { left: r.left, right: r.right, width: r.width, fontSize: parseFloat(getComputedStyle(el).fontSize) }
          }),
        }))
        measurements.push({ label: 'editor-1920x1080-dpr2', ...display })
        expect(display.dpr).toBe(2)
        expect([display.physicalWidth, display.physicalHeight]).toEqual([3840, 2160])
        expect(display.pageWidth).toBeLessThanOrEqual(display.width + 1)
        expect(display.controls.length).toBeGreaterThanOrEqual(8)
        for (const control of display.controls) {
          expect(control.left).toBeGreaterThanOrEqual(0)
          expect(control.right).toBeLessThanOrEqual(display.width + 1)
          expect(control.width).toBeGreaterThanOrEqual(80)
          expect(control.fontSize).toBeGreaterThanOrEqual(14)
        }
        const action = await highDpiPage.getByRole('button', { name: 'Update booking', exact: true }).boundingBox()
        expect(action.y).toBeGreaterThanOrEqual(0)
        expect(action.y + action.height).toBeLessThanOrEqual(display.height)
        await highDpiPage.screenshot({ path: testInfo.outputPath('editor-1920x1080-dpr2-viewport.png') })
      } finally {
        await context.close()
      }
    })

    await test.step('desktop keyboard focus is never obscured by the sticky action bar', async () => {
      const expected = ['booking-start-time', 'booking-duration', 'venue-name', 'venue-address', 'contact-name-main', 'contact-phone-main', 'contact-email-main', 'booking-note']
      const seen = new Set()
      await page.setViewportSize({ width: 1440, height: 960 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.getByLabel('Start time', { exact: true }).focus()
      for (let step = 0; step < 48 && seen.size < expected.length; step++) {
        const focused = await page.evaluate(() => {
          const el = document.activeElement
          if (!el?.matches('main input:not(:disabled), main textarea:not(:disabled)')) return null
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { id: el.id, top: r.top, bottom: r.bottom, unobscured: hit === el || el.contains(hit), viewportHeight: innerHeight }
        })
        if (focused && expected.includes(focused.id)) {
          measurements.push({ label: 'desktop-keyboard-focus', ...focused })
          expect(focused.top, focused.id).toBeGreaterThanOrEqual(0)
          expect(focused.bottom, focused.id).toBeLessThanOrEqual(focused.viewportHeight)
          expect(focused.unobscured, `${focused.id} is not covered by sticky controls`).toBe(true)
          seen.add(focused.id)
        }
        if (seen.size < expected.length) await page.keyboard.press('Tab')
      }
      expect([...seen].sort()).toEqual([...expected].sort())
      await page.setViewportSize({ width: 320, height: 800 })
    })

    await test.step('supported text and placeholders retain readable contrast', async () => {
      await page.setViewportSize({ width: 1440, height: 960 })
      const samples = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const rgba = css => {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1)
          return Array.from(ctx.getImageData(0, 0, 1, 1).data)
        }
        const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255))
        const luminance = color => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
        const nodes = [...document.querySelectorAll('main h1, main h2, main h3, main label, main p, main [role=tab]')]
          .filter(el => el.textContent.trim() && el.getBoundingClientRect().width > 0 && !el.closest('fieldset[disabled]'))
          .map(el => ({ el, text: el.textContent.trim(), pseudo: null }))
        for (const el of document.querySelectorAll('main input[placeholder]:not(:disabled), main textarea[placeholder]:not(:disabled)')) {
          if (el.getBoundingClientRect().width > 0) nodes.push({ el, text: `placeholder:${el.id}`, pseudo: '::placeholder' })
        }
        return nodes.map(({ el, text, pseudo }) => {
          const layers = []; let node = el; let opacity = 1
          while (node) {
            const css = getComputedStyle(node)
            layers.unshift(rgba(css.backgroundColor)); opacity *= Number(css.opacity); node = node.parentElement
          }
          const bg = layers.reduce((color, layer) => blend(layer, color), [255, 255, 255])
          const style = getComputedStyle(el, pseudo)
          const color = rgba(style.color)
          color[3] *= opacity * (pseudo ? Number(style.opacity) : 1)
          const fg = blend(color, bg)
          const a = luminance(fg); const b = luminance(bg)
          return { text: text.slice(0, 80), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
        })
      })
      measurements.push({ label: 'supported-text-contrast', samples })
      expect(samples.length).toBeGreaterThan(10)
      for (const sample of samples) expect(sample.ratio, sample.text).toBeGreaterThanOrEqual(4.5)
      await page.setViewportSize({ width: 320, height: 800 })
    })

    await test.step('real page headings, zero fee and supported labels stay available', async () => {
      await expect(page.getByText('€0', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('21:15')
      await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('01:30')
      await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Synthetic saved booking note')
      await expect(page.getByRole('button', { name: 'Complete and create event', exact: true })).toBeDisabled()
      await expect(page.getByPlaceholder('Driver name', { exact: true })).toBeDisabled()
      await expect(page.getByPlaceholder('Contact name', { exact: true }).nth(1)).toBeDisabled()
    })

    await test.step('keyboard tabs preserve the draft and disclose unsupported sections', async () => {
      await page.getByLabel('Venue name', { exact: true }).fill('Synthetic unsaved layout draft')
      const tablist = page.getByRole('tablist', { name: 'Booking sections', exact: true })
      await expect(tablist.getByRole('tab')).toHaveCount(6)
      const performance = tablist.getByRole('tab', { name: 'Performance', exact: true })
      await performance.focus()
      await page.keyboard.press('ArrowRight')
      await expect(tablist.getByRole('tab', { name: 'Financial', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('tabpanel', { name: 'Financial', exact: true })).toContainText('This section is coming soon.')
      await page.keyboard.press('End')
      await expect(tablist.getByRole('tab', { name: 'Artist contacts', exact: true })).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Home')
      await expect(performance).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByLabel('Venue name', { exact: true })).toHaveValue('Synthetic unsaved layout draft')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321)
    })

    await test.step('narrow save, reload and explicit clears retain the existing data contract', async () => {
      const save = page.getByRole('button', { name: 'Update booking', exact: true })
      await page.getByLabel('Email', { exact: true }).fill('not-an-email')
      await save.click()
      await expect(page.getByRole('main').getByRole('alert')).toContainText(/email/i)
      expect((await request(`/rest/v1/bookings?id=eq.${booking.id}`))[0].venue_name).toBe('Synthetic Harbour Performance Hall')
      await expect(page.getByLabel('Venue name', { exact: true })).toHaveValue('Synthetic unsaved layout draft')
      await expect(page.getByLabel('Email', { exact: true })).toHaveValue('not-an-email')
      await page.getByLabel('Email', { exact: true }).fill('layout.contact@backbeat.test')
      await save.scrollIntoViewIfNeeded()
      const rect = await save.boundingBox()
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(321)
      await save.click()
      await expect.poll(async () => (await request(`/rest/v1/bookings?id=eq.${booking.id}`))[0].venue_name).toBe('Synthetic unsaved layout draft')
      await expect(save).toBeEnabled()
      await page.reload()
      await expect(page.getByLabel('Venue name', { exact: true })).toHaveValue('Synthetic unsaved layout draft')
      for (const [,label] of fields) await page.getByLabel(label, { exact: true }).fill('')
      await page.getByRole('button', { name: 'Update booking', exact: true }).click()
      await expect.poll(async () => {
        const [saved] = await request(`/rest/v1/bookings?id=eq.${booking.id}`)
        return fields.map(([key]) => saved[key])
      }).toEqual(fields.map(() => null))
      await expect(page.getByRole('button', { name: 'Update booking', exact: true })).toBeEnabled()
      await page.reload()
      for (const [,label] of fields) await expect(page.getByLabel(label, { exact: true })).toHaveValue('')
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Yes, delete', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(await request(`/rest/v1/bookings?id=eq.${booking.id}`)).toHaveLength(1)
    })

    await test.step('heading correction is present on actual Artists and Settings routes', async () => {
      await page.setViewportSize({ width: 1440, height: 960 })
      await page.goto(`${APP}/dashboard/artists`)
      await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Artists', exact: true })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await page.goto(`${APP}/dashboard/settings`)
      await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      expect(errors).toEqual([])
      expect([...blocked]).toEqual([])
    })
  } finally {
    const secrets = [password, anon, service, jwt].filter(Boolean)
    const safe = secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), JSON.stringify({ measurements, errors, blockedOrigins: [...blocked] }, null, 2))
    await testInfo.attach('safe-m4-diagnostics', { body: safe, contentType: 'application/json' }).catch(() => {})
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
