import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'

const APP = 'http://127.0.0.1:3101'
const API = 'http://127.0.0.1:55322'
const ROSTER_SIZE = 205
const DISPLAY_CASES = [
  { width: 1440, height: 960 }, { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }, { width: 2560, height: 1600 },
  { width: 3840, height: 2160 }, { width: 1024, height: 768 },
  { width: 390, height: 844 }, { width: 320, height: 800 },
]

test('Artists directory finds every workspace artist with truthful controls and accessible paging', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000)
  expect(process.env.BACKBEAT_TEST_URL).toBe(API)
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  expect(Boolean(anon && service && anon !== service)).toBe(true)
  const tag = `ui-m5-${randomUUID()}`
  const users = []
  const workspaces = []
  const measurements = []
  const errors = []
  const blocked = new Set()
  const cleanupFailures = []

  async function response(path, { method = 'GET', body, admin = false, token = anon } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid fixed local path')
    if (admin && !/^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?$/.test(path)) throw new Error('Admin scope violation')
    try {
      return await fetch(API + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { apikey: admin ? service : anon, Authorization: `Bearer ${admin ? service : token}`,
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new Error('Local fixture transport failed; details redacted') }
  }
  async function request(path, options) {
    const result = await response(path, options)
    if (!result.ok) throw new Error(`Local fixture request failed: HTTP ${result.status}`)
    if (result.status === 204) return null
    try { return await result.json() }
    catch { throw new Error('Local fixture response was not JSON; details redacted') }
  }
  async function guard() {
    expect(await request('/rest/v1/runtime_environment?select=id,environment,synthetic_only')).toEqual([
      { id: 'backbeat-dev', environment: 'development', synthetic_only: true },
    ])
  }
  async function mutate(path, options) { await guard(); return request(path, options) }
  async function createUser(label) {
    const actor = { email: `${tag}-${label}@backbeat.test`, password: `${randomBytes(32).toString('base64url')}aA1!` }
    const created = await mutate('/auth/v1/admin/users', { method: 'POST', admin: true,
      body: { email: actor.email, password: actor.password, email_confirm: true, user_metadata: { synthetic_fixture: tag } } })
    actor.id = created.id ?? created.user?.id
    expect(actor.id).toMatch(/^[0-9a-f-]{36}$/)
    users.push(actor)
    const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: actor.email, password: actor.password } })
    expect(typeof session.access_token).toBe('string')
    actor.jwt = session.access_token
    return actor
  }
  async function contain(context) {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.protocol.startsWith('http') && ![APP, API].includes(url.origin)) {
        blocked.add(url.origin); await route.abort(); return
      }
      if (route.request().method() === 'POST') await guard()
      await route.continue()
    })
  }
  async function directoryReady(target) {
    await expect(target.getByRole('main').getByRole('heading', { name: 'Artists', level: 1, exact: true })).toHaveCount(1)
    await expect(target.getByRole('button', { name: 'Account menu for M5 Synthetic Operator', exact: true }).locator('img')).toBeVisible()
  }
  async function layout(target, label) {
    const result = await target.evaluate(() => {
      const region = document.querySelector('main [role="region"][aria-label="Artists table"]')
      const box = region?.getBoundingClientRect()
      const main = document.querySelector('main').getBoundingClientRect()
      return {
        width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        pageWidth: document.documentElement.scrollWidth,
        main: { left: main.left, right: main.right },
        region: box ? { left: box.left, right: box.right, clientWidth: region.clientWidth, scrollWidth: region.scrollWidth } : null,
        visibleRowCount: document.querySelectorAll('main tbody tr').length,
        enabledControls: [...document.querySelectorAll('main input:not(:disabled), main button:not(:disabled)')]
          .filter(el => !el.closest('table')).map(el => {
            const r = el.getBoundingClientRect()
            return { name: el.getAttribute('aria-label') || el.textContent.trim(), left: r.left, right: r.right, fontSize: parseFloat(getComputedStyle(el).fontSize) }
          }),
        tableFontSizes: [...document.querySelectorAll('main th, main td')].map(el => parseFloat(getComputedStyle(el).fontSize)),
      }
    })
    measurements.push({ label, ...result })
    return result
  }
  function assertLayout(result) {
    expect(result.pageWidth, `page overflow at ${result.width}`).toBeLessThanOrEqual(result.width + 1)
    expect(result.region, 'explicit table scroll region').not.toBeNull()
    expect(result.region.left).toBeGreaterThanOrEqual(0)
    expect(result.region.right).toBeLessThanOrEqual(result.width + 1)
    if (result.width >= 1920) expect(result.region.right - result.region.left, 'desktop table keeps identity and actions within a readable span').toBeLessThanOrEqual(1600)
    expect(result.visibleRowCount).toBe(20)
    for (const control of result.enabledControls) {
      expect(control.left, control.name).toBeGreaterThanOrEqual(0)
      expect(control.right, control.name).toBeLessThanOrEqual(result.width + 1)
      expect(control.fontSize, control.name).toBeGreaterThanOrEqual(14)
    }
    for (const size of result.tableFontSizes) expect(size).toBeGreaterThanOrEqual(14)
  }

  await guard()
  try {
    const primary = await createUser('a')
    const secondary = await createUser('b')
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 400)))
    await contain(page.context())
    await page.goto(`${APP}/auth/login`)
    await page.getByLabel('Email', { exact: true }).fill(primary.email)
    try { await page.getByLabel('Password', { exact: true }).fill(primary.password) }
    catch { throw new Error('Synthetic password interaction failed; details redacted') }
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page).toHaveURL(`${APP}/onboarding`)
    await page.getByLabel('Full Name', { exact: true }).fill('M5 Synthetic Operator')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Workspace Name', { exact: true }).fill(`${tag}-a`)
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(page).toHaveURL(`${APP}/dashboard`)
    const [workspace] = await request(`/rest/v1/workspaces?name=eq.${tag}-a`, { token: primary.jwt })
    expect(workspace?.created_by).toBe(primary.id)
    workspaces.push({ id: workspace.id, name: workspace.name, actor: primary })
    const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="black"/></svg>')
    await mutate(`/rest/v1/profiles?id=eq.${primary.id}`, { method: 'PATCH', token: primary.jwt, body: { avatar_url: avatar } })
    const otherId = await mutate('/rest/v1/rpc/backbeat_bootstrap_workspace', { method: 'POST', token: secondary.jwt, body: { workspace_name: `${tag}-b` } })
    expect(otherId).toMatch(/^[0-9a-f-]{36}$/)
    workspaces.push({ id: otherId, name: `${tag}-b`, actor: secondary })
    const [other] = await request(`/rest/v1/workspaces?id=eq.${otherId}`, { token: secondary.jwt })
    expect(other.created_by).toBe(secondary.id)
    expect(await request(`/rest/v1/workspace_members?workspace_id=eq.${otherId}`, { token: secondary.jwt })).toEqual([{ workspace_id: otherId, user_id: secondary.id, role: 'master', status: 'active' }])
    await mutate('/rest/v1/artists', { method: 'POST', token: secondary.jwt,
      body: { workspace_id: other.id, name: 'Other Workspace', stage_name: 'Tenant-only forbidden directory artist' } })
    await page.goto(`${APP}/dashboard/artists`)
    await directoryReady(page)
    await expect(page.getByRole('main').getByText('No artists yet. Add your first artist to get started.', { exact: true })).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)

    const roster = Array.from({ length: ROSTER_SIZE }, (_, i) => ({
      id: randomUUID(), workspace_id: workspace.id, stage_name: `Artist ${String(i).padStart(3, '0')}`,
      name: `Given ${String(i).padStart(3, '0')}`, surname: 'Performer', genres: [i % 2 ? 'Jazz' : 'House'],
      location: i % 3 ? 'London' : 'Rome', fee: 250, currency: 'EUR',
      notes: `PRIVATE-NOTE-${tag}`, allergies: `PRIVATE-HEALTH-${tag}`,
    })).sort((a, b) => a.id.localeCompare(b.id))
    const longName = 'Aardvark Synthetic Artist With A Deliberately Long Stage Name For Directory Layout Verification'
    const lead = roster[0]
    Object.assign(lead, { stage_name: longName, name: 'Long', surname: 'Performer',
      genres: ['House', 'Jazz', 'Ambient', 'Hidden fourth genre'],
      location: 'San Valentino In Abruzzo Citeriore, PE (ITA)', fee: 0 })
    Object.assign(roster[1], { stage_name: 'Abacus Artist With Missing Fee', fee: null })
    const tail = roster.at(-1)
    Object.assign(tail, { stage_name: 'Zzz Last Batch Directory Needle', name: 'Last Batch', surname: 'Performer', location: 'Remote Synthetic Harbour' })
    await mutate('/rest/v1/artists', { method: 'POST', token: primary.jwt, body: roster })
    const actual = await request(`/rest/v1/artists?workspace_id=eq.${workspace.id}&select=id`, { token: primary.jwt })
    expect(new Set(actual.map(row => row.id)).size).toBe(ROSTER_SIZE)
    expect(await request(`/rest/v1/artists?workspace_id=eq.${other.id}&select=id`, { token: primary.jwt })).toEqual([])
    await page.reload()
    await directoryReady(page)
    await page.screenshot({ path: testInfo.outputPath('directory-initial-1440x960-viewport.png') })
    measurements.push({ label: 'initial', rowCount: await page.locator('main tbody tr').count(), expectedRoster: ROSTER_SIZE })

    await test.step('a last-batch match removes nonmatching rows instead of filtering a truncated roster', async () => {
      // This selector exists in the baseline, so the RED is behavioral, not a missing-label failure.
      await page.getByPlaceholder('Search by name, genre or location', { exact: true }).fill('  lAsT bAtCh dIrEcToRy  ')
      await expect(page.locator('main tbody tr')).toHaveCount(1)
      await expect(page.locator('main tbody tr').getByRole('link').filter({ hasText: tail.stage_name })).toHaveAttribute('href', `/dashboard/artists/${tail.id}`)
      await expect(page.getByRole('main').getByText('Showing 1-1 of 1 artists', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Clear search', exact: true }).click()
      await expect(page.getByRole('searchbox', { name: 'Search artists', exact: true })).toBeFocused()
    })

    await test.step('all UI pages enumerate the exact workspace roster once in name order', async () => {
      const seen = []
      const next = page.getByRole('button', { name: 'Next', exact: true })
      let start = 1
      for (let guardIndex = 0; guardIndex <= Math.ceil(ROSTER_SIZE / 20); guardIndex++) {
        const ids = await page.locator('main tbody tr').evaluateAll(rows => rows.map(row => {
          const href = row.querySelector('a[href^="/dashboard/artists/"]').getAttribute('href')
          return href.split('/').at(-1)
        }))
        expect(ids.length).toBeGreaterThan(0)
        expect(ids.length).toBeLessThanOrEqual(20)
        await expect(page.getByRole('main').getByText(`Showing ${start}-${start + ids.length - 1} of ${ROSTER_SIZE} artists`, { exact: true })).toBeVisible()
        seen.push(...ids)
        if (await next.isDisabled()) {
          await next.focus()
          await page.keyboard.press('Enter')
          await expect(page.getByRole('main').getByText(`Showing ${start}-${start + ids.length - 1} of ${ROSTER_SIZE} artists`, { exact: true })).toBeVisible()
          await expect(next).toBeFocused()
          break
        }
        await next.focus()
        await page.keyboard.press('Enter')
        start += ids.length
        await expect(page.getByRole('main').getByText(`Showing ${start}-${Math.min(start + 19, ROSTER_SIZE)} of ${ROSTER_SIZE} artists`, { exact: true })).toBeVisible()
        const focusInPagination = await page.evaluate(() => Boolean(document.activeElement?.closest('nav[aria-label="Artists pagination"]')))
        measurements.push({ label: 'pagination-keyboard-focus', start, retained: focusInPagination })
        expect(focusInPagination, 'keyboard paging must not lose focus to the document').toBe(true)
      }
      expect(seen).toHaveLength(ROSTER_SIZE)
      expect(new Set(seen).size).toBe(ROSTER_SIZE)
      const collator = new Intl.Collator('en', { sensitivity: 'base' })
      expect(seen).toEqual([...roster].sort((a, b) => collator.compare(a.stage_name, b.stage_name) || a.stage_name.localeCompare(b.stage_name, 'en') || a.id.localeCompare(b.id, 'en')).map(row => row.id))
      measurements.push({ label: 'roster-enumeration', actualCount: seen.length, uniqueCount: new Set(seen).size, lastBatchIdFound: seen.includes(tail.id) })
      await page.getByRole('searchbox', { name: 'Search artists', exact: true }).fill('hidden fourth genre')
      await expect(page.locator('main tbody tr')).toHaveCount(1)
      await expect(page.getByRole('main').getByText('Showing 1-1 of 1 artists', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
      await page.getByRole('button', { name: 'Clear search', exact: true }).click()
      await expect(page.locator('main tbody tr')).toHaveCount(20)
      await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    })

    await test.step('real name, genre, location and no-results search remain distinct from empty roster', async () => {
      const search = page.getByRole('searchbox', { name: 'Search artists', exact: true })
      for (const query of ['Long Performer', 'hidden fourth genre', 'Citeriore']) {
        await search.fill(query)
        await expect(page.locator('main tbody tr')).toHaveCount(1)
        await expect(page.locator('main tbody tr')).toContainText(longName)
      }
      await search.fill('Tenant-only forbidden directory artist')
      await expect(page.locator('main tbody tr')).toHaveCount(0)
      await expect(page.getByRole('main').getByText('No artists yet. Add your first artist to get started.', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('main')).toContainText(/no .*match|no .*found|no results/i)
      await page.getByRole('button', { name: 'Clear search', exact: true }).click()
      await expect(search).toBeFocused()
      const html = await page.content()
      expect(html.includes(`PRIVATE-NOTE-${tag}`) || html.includes(`PRIVATE-HEALTH-${tag}`)).toBe(false)
    })

    await test.step('nine display cases contain the table and keep control typography readable', async () => {
      const layouts = []
      for (const viewport of DISPLAY_CASES) {
        await page.setViewportSize(viewport)
        await page.evaluate(() => window.scrollTo(0, 0))
        const label = `directory-${viewport.width}x${viewport.height}`
        const measured = await layout(page, label)
        layouts.push(measured)
        await page.screenshot({ path: testInfo.outputPath(`${label}-viewport.png`) })
        await page.screenshot({ path: testInfo.outputPath(`${label}.png`), fullPage: true })
      }
      expect(new Set(layouts.map(row => `${row.width}x${row.height}`)).size).toBe(DISPLAY_CASES.length)
      for (const measured of layouts) { expect(measured.dpr).toBe(1); assertLayout(measured) }
      const context = await browser.newContext({ storageState: await page.context().storageState(),
        viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'Europe/Rome' })
      try {
        await contain(context)
        const hi = await context.newPage()
        hi.on('pageerror', error => errors.push(String(error.message).slice(0, 400)))
        await hi.goto(`${APP}/dashboard/artists`)
        await directoryReady(hi)
        const measured = await layout(hi, 'directory-1920x1080-dpr2')
        expect(measured.dpr).toBe(2)
        assertLayout(measured)
        await hi.screenshot({ path: testInfo.outputPath('directory-1920x1080-dpr2-viewport.png') })
      } finally { await context.close() }
      const region = page.getByRole('region', { name: 'Artists table', exact: true })
      await region.focus()
      await expect(region).toBeFocused()
      const scroll = await region.evaluate(el => ({ left: el.scrollLeft, required: el.scrollWidth > el.clientWidth }))
      if (scroll.required) {
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(scroll.left)
      }
      measurements.push({ label: 'narrow-keyboard-table-scroll', required: scroll.required, passed: true })
    })

    await test.step('supported directory text and placeholder contrast stays readable', async () => {
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
        const elements = new Set()
        const walk = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT)
        let textNode
        while ((textNode = walk.nextNode())) {
          const el = textNode.parentElement
          if (textNode.textContent.trim() && el && !el.closest('script,style,[aria-hidden="true"],.sr-only,button:disabled,[aria-disabled="true"]') && el.getBoundingClientRect().width > 0) elements.add(el)
        }
        const nodes = [...elements].map(el => ({ el, text: el.textContent.trim(), pseudo: null }))
        for (const el of document.querySelectorAll('main input[placeholder]:not(:disabled)')) nodes.push({ el, text: 'search placeholder', pseudo: '::placeholder' })
        return nodes.map(({ el, text, pseudo }) => {
          const layers = []; let node = el; let opacity = 1
          while (node) {
            const style = getComputedStyle(node)
            layers.unshift(rgba(style.backgroundColor)); opacity *= Number(style.opacity); node = node.parentElement
          }
          const bg = layers.reduce((color, layer) => blend(layer, color), [255, 255, 255])
          const style = getComputedStyle(el, pseudo)
          const color = rgba(style.color)
          color[3] *= opacity * (pseudo ? Number(style.opacity) : 1)
          const fg = blend(color, bg)
          const a = luminance(fg); const b = luminance(bg)
          return { text: text.slice(0, 100), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
        })
      })
      expect(samples.length).toBeGreaterThan(30)
      measurements.push({ label: 'supported-text-contrast', samples })
      for (const sample of samples) expect(sample.ratio, sample.text).toBeGreaterThanOrEqual(4.5)
    })

    await test.step('menu is keyboard-operable, unavailable actions stay disabled and Edit persists', async () => {
      await page.setViewportSize({ width: 1440, height: 960 })
      await page.getByRole('searchbox', { name: 'Search artists', exact: true }).fill(longName)
      const row = page.locator('main tbody tr')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(/€\s?0|EUR\s?0/)
      const headers = await page.locator('main thead th').allTextContents()
      const eventsColumn = headers.findIndex(text => /^Events\b/i.test(text.trim()))
      expect(eventsColumn).toBeGreaterThanOrEqual(0)
      await expect(row.locator('td,th').nth(eventsColumn)).toContainText(/unavailable|not available|[—–]|N\/A/i)
      await expect(page.getByRole('button', { name: /Download CSV/i })).toBeDisabled()
      const menu = row.getByRole('button', { name: `Actions for ${longName}`, exact: true })
      await menu.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute('aria-disabled', 'true')
      await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toHaveAttribute('href', `/dashboard/artists/${lead.id}/edit`)
      await page.keyboard.press('Escape')
      await expect(menu).toBeFocused()
      await menu.click()
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard/artists/${lead.id}/edit`)
      await expect(page.getByLabel('Stage name', { exact: true })).toHaveValue(longName)
      const renamed = 'Aardvark Updated Synthetic Directory Artist'
      await page.getByLabel('Stage name', { exact: true }).fill(renamed)
      for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('button', { name: 'Save and Complete', exact: true }).click()
      await expect.poll(async () => (await request(`/rest/v1/artists?id=eq.${lead.id}&select=stage_name`, { token: primary.jwt }))[0]?.stage_name).toBe(renamed)
      await page.goto(`${APP}/dashboard/artists`)
      await directoryReady(page)
      await page.getByRole('searchbox', { name: 'Search artists', exact: true }).fill(renamed)
      await expect(page.locator('main tbody tr')).toHaveCount(1)
      await page.locator('main tbody tr').getByRole('link').filter({ hasText: renamed }).click()
      await expect(page).toHaveURL(`${APP}/dashboard/artists/${lead.id}`)
      await expect(page.getByRole('main').getByRole('heading', { level: 1, name: renamed, exact: true })).toBeVisible()
      measurements.push({ label: 'directory-edit-reload-profile', passed: true })
    })
    expect(errors).toEqual([])
    expect([...blocked]).toEqual([])
  } finally {
    // Continue ownership-guarded cleanup across independent fixtures without bypassing a failed marker.
    for (const actor of users.toReversed()) {
      try {
        if (!actor.jwt) continue
        const owned = await request(`/rest/v1/workspaces?name=like.${tag}*&select=id,name,created_by`, { token: actor.jwt })
        for (const workspace of owned) {
          expect(workspace.created_by === actor.id && workspace.name.startsWith(tag)).toBe(true)
          await mutate(`/rest/v1/workspaces?id=eq.${workspace.id}&name=eq.${workspace.name}`, { method: 'DELETE', token: actor.jwt })
          expect(await request(`/rest/v1/workspaces?id=eq.${workspace.id}&select=id`, { token: actor.jwt })).toEqual([])
        }
      } catch { cleanupFailures.push('Workspace cleanup failed') }
    }
    for (const actor of users.toReversed()) {
      try {
        await guard()
        const actual = await request(`/auth/v1/admin/users/${actor.id}`, { admin: true })
        const record = actual.user ?? actual
        expect(record.email === actor.email && record.user_metadata?.synthetic_fixture === tag).toBe(true)
        await mutate(`/auth/v1/admin/users/${actor.id}`, { method: 'DELETE', admin: true })
        expect((await response(`/auth/v1/admin/users/${actor.id}`, { admin: true })).status).toBe(404)
      } catch { cleanupFailures.push('Auth cleanup failed') }
    }
    const secrets = [anon, service, ...users.flatMap(actor => [actor.password, actor.jwt])].filter(Boolean)
    const diagnostic = JSON.stringify({ measurements, errors, blockedOrigins: [...blocked], cleanupFailures,
      fixtureUsers: users.length, fixtureWorkspaces: workspaces.length }, null, 2)
    const safe = secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), diagnostic)
    await testInfo.attach('safe-m5-diagnostics', { body: safe, contentType: 'application/json' }).catch(() => {})
    expect(cleanupFailures).toEqual([])
  }
})
