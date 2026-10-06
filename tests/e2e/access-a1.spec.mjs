import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const APP = 'http://127.0.0.1:3101'
const API = 'http://127.0.0.1:55322'
const APP_CONTAINER = 'openship-backbeat-dev-supabase-development-backbeat'
const DB_CONTAINER = 'openship-backbeat-dev-supabase-development-db'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Password/code entry must never generate automatic screenshot or trace attachments.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

async function vmProcess(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('limactl', ['shell', 'backbeat-dev', 'sudo', '-n', 'docker', 'exec', '-i', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Scoped local helper timed out; output suppressed')) }, 25000)
    child.stdout.on('data', b => { output += b.toString() })
    child.stderr.on('data', () => { /* Never serialize provider/mail/SQL stderr. */ })
    child.on('error', () => { clearTimeout(timer); reject(new Error('Scoped local helper launch failed')) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('Scoped local helper failed; output suppressed')) })
    child.stdin.end(input)
  })
}

// Mailpit is private to the existing VM network. No new port, service, relay or email provider.
// Actual bodies and OTP values stay inside this helper -> test-process memory, never artifacts.
const MAIL_SCRIPT = String.raw`
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',async()=>{
  try {
    const q=JSON.parse(input);
    if(!/^ui-a1-[0-9a-f-]{36}@backbeat\.test$/.test(q.email))throw Error('scope');
    const base='http://mailpit:8025';
    const r=await fetch(base+'/api/v1/search?query='+encodeURIComponent('to:'+q.email)+'&limit=100',{redirect:'error'});
    if(!r.ok)throw Error('read');const found=await r.json();
    const messages=found.messages||[];
    if(!Number.isSafeInteger(found.messages_count)||found.messages_count!==messages.length)throw Error('incomplete');
    const ids=messages.map(m=>m.ID);
    if(q.op==='delete') {
      if(ids.length){const d=await fetch(base+'/api/v1/messages',{method:'DELETE',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({IDs:ids})});if(!d.ok)throw Error('delete');}
      process.stdout.write(JSON.stringify({deleted:ids.length}));return;
    }
    const selected=messages.find(m=>!(q.exclude||[]).includes(m.ID));
    if(!selected){process.stdout.write(JSON.stringify({ids,code:null}));return;}
    const detail=await fetch(base+'/api/v1/message/'+encodeURIComponent(selected.ID),{redirect:'error'});
    if(!detail.ok)throw Error('detail');const body=await detail.json();
    const recipients=body.To||selected.To||[];
    if(!recipients.some(v=>v.Address===q.email))throw Error('recipient');
    const match=(String(body.Text||'')+' '+String(body.HTML||'')).match(/\b\d{6}\b/);
    process.stdout.write(JSON.stringify({ids,id:selected.ID,code:match?match[0]:null}));
  }catch{process.stdout.write(JSON.stringify({failed:true}));process.exitCode=1;}
});`

const DISPLAY_MATRIX = [[1440, 960], [1920, 1080], [2560, 1440], [2560, 1600], [3840, 2160], [1024, 768], [390, 844], [320, 800]]

async function inspectEmptySurface(page, testInfo, receipt, surface) {
  const measure = async (width, height, dpr, screenshotSession) => {
    const result = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('input:not([type="hidden"]), button, [data-slot="confirmation-digit"], [role="dialog"]')]
        .filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height && !el.closest('[aria-hidden="true"]:not([data-slot])'))
        .map(el => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.id || el.tagName, left: r.left, right: r.right, width: r.width } })
      const digits = [...document.querySelectorAll('[data-slot="confirmation-digit"]')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width } })
      return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scroll: document.documentElement.scrollWidth, boxes, digits }
    })
    expect(result.width).toBe(width); expect(result.height).toBe(height); expect(result.dpr).toBe(dpr)
    expect(result.scroll).toBeLessThanOrEqual(width + 1)
    for (const box of [...result.boxes, ...result.digits]) { expect(box.left).toBeGreaterThanOrEqual(-1); expect(box.right).toBeLessThanOrEqual(width + 1) }
    if (surface === 'confirmation') {
      expect(result.digits).toHaveLength(6)
      expect(await page.getByLabel('Confirmation code', { exact: true }).inputValue()).toBe('')
      // The approved dialog overlays a freshly mounted signup form. Every
      // underlying password field must be empty before a safe screenshot.
      expect(await page.locator('input[type="password"]').evaluateAll(inputs => inputs.every(input => input.value === ''))).toBe(true)
    }
    const filename = `${surface}-${width}x${height}-dpr${dpr}.png`
    if (screenshotSession) {
      // Playwright's cached viewport would reset our explicit CDP DPR override.
      const capture = await screenshotSession.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
      const image = Buffer.from(capture.data, 'base64')
      expect(image.readUInt32BE(16)).toBe(width * dpr); expect(image.readUInt32BE(20)).toBe(height * dpr)
      await writeFile(testInfo.outputPath(filename), image)
    } else {
      await page.screenshot({ path: testInfo.outputPath(filename), fullPage: true, animations: 'disabled' })
    }
    receipt.viewports.push({ surface, width, height, dpr, horizontalOverflow: false, digitCount: result.digits.length, screenshot: filename })
  }
  for (const [width, height] of DISPLAY_MATRIX) { await page.setViewportSize({ width, height }); await measure(width, height, 1) }
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false })
    await measure(1920, 1080, 2, cdp)
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach()
    await page.setViewportSize({ width: 1440, height: 960 })
  }
}

test('A1 public signup confirms real caught email and creates exactly one Master workspace', async ({ page }, testInfo) => {
  test.setTimeout(300000)
  expect(process.env.BACKBEAT_TEST_URL).toBe(API)
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  expect(Boolean(anon && service && anon !== service)).toBe(true)
  const tag = `ui-a1-${randomUUID()}`
  const email = `${tag}@backbeat.test`
  const password = randomBytes(32).toString('base64url') + 'aA1!'
  const secretValues = new Set([anon, service, password])
  let userId
  let jwt
  let workspaceId
  let signupAttempted = false
  const errors = []
  const receipt = { tag, publicSignup: false, adminConfirmed: false, wrongCodeRejected: false, expiredCodeRejected: false, resendDelivered: false, profilePersisted: false, master: false, reload: false, cleanup: false, viewports: [] }
  function redact(value) { let out = String(value); for (const secret of secretValues) if (secret) out = out.split(secret).join('[REDACTED]'); return out.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]').replace(/\b\d{6}\b/g, '[REDACTED_CODE]') }
  async function request(path, { method = 'GET', body, admin = false, token = jwt || anon } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('A1 fixed-origin violation')
    if (admin && !/^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?(?:\?.*)?$/.test(path)) throw new Error('Admin fixture lifecycle scope violation')
    let r
    try { r = await fetch(API + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { apikey: admin ? service : anon, Authorization: `Bearer ${admin ? service : token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
    catch { throw new Error('Local A1 HTTP failure; transport details suppressed') }
    let data = null; try { data = await r.json() } catch { /* Empty DELETE response is valid. */ }
    if (!r.ok) throw new Error(`Local A1 HTTP ${r.status}; payload suppressed`)
    return data
  }
  async function guard() { expect(await request('/rest/v1/runtime_environment?select=id,environment,synthetic_only', { token: anon })).toEqual([{ id: 'backbeat-dev', environment: 'development', synthetic_only: true }]) }
  async function secretFill(locator, value) { try { await locator.fill(value) } catch { throw new Error('Sensitive input interaction failed; value suppressed') } }
  async function mail(op = 'read', exclude = []) { return JSON.parse(await vmProcess([APP_CONTAINER, 'node', '-e', MAIL_SCRIPT], JSON.stringify({ op, email, exclude }))) }
  async function waitMail(exclude = []) {
    let result
    await expect.poll(async () => { result = await mail('read', exclude); return Boolean(result.code) }, { timeout: 30000, intervals: [250, 500, 1000] }).toBe(true)
    secretValues.add(result.code)
    return result
  }
  async function inventoryOwnUser() {
    for (let pageNumber = 1; pageNumber <= 20; pageNumber++) {
      const result = await request(`/auth/v1/admin/users?page=${pageNumber}&per_page=100`, { admin: true })
      const user = result.users.find(u => u.email === email)
      if (user) return user
      if (result.users.length < 100) return null
    }
    throw new Error('Bounded fixture lookup exhausted; cleanup not certified')
  }
  async function codeRequest(value) {
    const response = page.waitForResponse(r => new URL(r.url()).origin === API && new URL(r.url()).pathname === '/auth/v1/verify' && r.request().method() === 'POST')
    await secretFill(page.getByLabel('Confirmation code', { exact: true }), value)
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    return response
  }
  await guard()
  page.on('pageerror', error => errors.push(redact(error.message)))
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.protocol.startsWith('http') && ![APP, API].includes(url.origin)) { await route.abort(); return }
    if (route.request().method() === 'POST') await guard()
    await route.continue()
  })
  try {
    await test.step('the actual signup UI collects separate identity fields', async () => {
      await page.goto(`${APP}/auth/signup`)
      await page.screenshot({ path: testInfo.outputPath('01-signup-empty.png'), fullPage: true, animations: 'disabled' })
      await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Surname', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /^(Create account|Sign up)$/i })).toBeEnabled()
      await inspectEmptySurface(page, testInfo, receipt, 'signup')
      const settings = await request('/auth/v1/settings', { token: anon })
      expect(settings.mailer_autoconfirm).toBe(false)
      await guard()
      signupAttempted = true
      const shortPassword = randomBytes(3).toString('base64url') + 'aA1'
      secretValues.add(shortPassword)
      const weak = await fetch(API + '/auth/v1/signup', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: shortPassword }) })
      expect([400, 422].includes(weak.status)).toBe(true)
      // Unversioned GoTrue responses use numeric `code`; the provider's
      // dedicated error header identifies the actual password-policy refusal.
      expect(weak.headers.get('x-sb-error-code')).toBe('weak_password')
      expect(await inventoryOwnUser()).toBe(null)
      receipt.serverPasswordPolicy = true
      await page.getByLabel('Name', { exact: true }).fill('Ada')
      await page.getByLabel('Surname', { exact: true }).fill('Synthetic')
      await page.getByLabel('Email', { exact: true }).fill(email)
      await secretFill(page.getByLabel('Password', { exact: true }), password)
      await secretFill(page.getByLabel('Confirm Password', { exact: true }), password)
      const submitted = page.waitForResponse(r => new URL(r.url()).origin === API && new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST')
      signupAttempted = true
      await page.getByRole('button', { name: /^(Create account|Sign up)$/i }).click()
      const response = await submitted
      expect(response.ok()).toBe(true)
      const result = await response.json()
      userId = result.id ?? result.user?.id
      expect(typeof result.access_token).not.toBe('string')
      expect(userId).toMatch(UUID)
      receipt.publicSignup = true
      await expect(page.getByLabel('Confirmation code', { exact: true })).toBeVisible()
    })
    const first = await waitMail()
    await test.step('confirmation fits desktop/mobile, supports keyboard and dismiss/resume', async () => {
      await inspectEmptySurface(page, testInfo, receipt, 'confirmation')
      const input = page.getByLabel('Confirmation code', { exact: true })
      await input.focus()
      await page.keyboard.type('12x34')
      expect(await input.inputValue()).toBe('1234')
      await input.press('Enter')
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      await secretFill(input, '')
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Tab')
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
      }
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Shift+Tab')
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
      }
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(`${APP}/auth/signup`)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: 'Continue confirmation', exact: true }).click()
      await expect(input).toBeVisible()
      expect(await input.inputValue()).toBe('')
      receipt.keyboard = true; receipt.dismissResume = true
    })
    await test.step('a real transport failure leaves resend recoverable', async () => {
      const endpoint = API + '/auth/v1/resend'
      const offline = route => route.abort('failed')
      await page.route(endpoint, offline)
      try {
        await page.getByRole('button', { name: 'Resend code', exact: true }).click()
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible({ timeout: 30000 })
        await expect(page.getByRole('button', { name: 'Resend code', exact: true })).toBeEnabled()
        expect((await mail()).ids.length).toBe(first.ids.length)
      } finally { await page.unroute(endpoint, offline) }
      receipt.transportFailureRecoverable = true
    })
    await test.step('wrong and actually expired email codes are rejected without activation', async () => {
      const wrong = first.code === '000000' ? '000001' : '000000'
      const invalid = await codeRequest(wrong)
      expect(invalid.ok()).toBe(false)
      const pending = await request(`/auth/v1/admin/users/${userId}`, { admin: true })
      expect(Boolean((pending.user ?? pending).email_confirmed_at)).toBe(false)
      receipt.wrongCodeRejected = true
      await guard()
      expect(userId).toMatch(UUID)
      // Fixture-only time travel: change no token or account confirmation flags.
      const sql = `BEGIN; SET LOCAL statement_timeout='5s'; DO $$ DECLARE n integer; BEGIN IF (SELECT count(*) FROM public.runtime_environment WHERE id='backbeat-dev' AND environment='development' AND synthetic_only) <> 1 OR (SELECT count(*) FROM public.runtime_environment) <> 1 THEN RAISE EXCEPTION 'marker'; END IF; UPDATE auth.users SET confirmation_sent_at='2000-01-01 00:00:00+00' WHERE id='${userId}' AND email='${email}' AND email_confirmed_at IS NULL; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'fixture scope'; END IF; END $$; COMMIT;`
      await vmProcess([DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], sql)
      const expired = await codeRequest(first.code)
      expect(expired.ok()).toBe(false)
      const stillPending = await request(`/auth/v1/admin/users/${userId}`, { admin: true })
      expect(Boolean((stillPending.user ?? stillPending).email_confirmed_at)).toBe(false)
      receipt.expiredCodeRejected = true
      await secretFill(page.getByLabel('Confirmation code', { exact: true }), '')
    })
    let refreshed
    await test.step('resend delivers a fresh message through the existing private Mailpit', async () => {
      const button = page.getByRole('button', { name: /resend code/i })
      await expect(button).toBeEnabled({ timeout: 75000 })
      const sent = page.waitForResponse(r => new URL(r.url()).origin === API && new URL(r.url()).pathname === '/auth/v1/resend' && r.request().method() === 'POST')
      await button.click()
      expect((await sent).ok()).toBe(true)
      refreshed = await waitMail(first.ids)
      receipt.resendDelivered = true
      await page.reload()
      await expect(page.getByLabel('Confirmation code', { exact: true })).toBeVisible()
    })
    await test.step('six-digit confirmation establishes the ordinary user session', async () => {
      const verified = await codeRequest(refreshed.code)
      expect(verified.ok()).toBe(true)
      const result = await verified.json()
      jwt = result.access_token
      secretValues.add(jwt)
      secretValues.add(result.refresh_token)
      expect(typeof jwt).toBe('string')
      expect(result.user.id).toBe(userId)
      expect(Boolean(result.user.email_confirmed_at)).toBe(true)
      await expect(page).toHaveURL(`${APP}/onboarding`)
      await expect(page.getByLabel('Workspace Name', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Full Name', { exact: true })).toHaveCount(0)
      await inspectEmptySurface(page, testInfo, receipt, 'workspace')
      const profile = await request(`/rest/v1/profiles?id=eq.${userId}&select=first_name,last_name,full_name`)
      expect(profile).toEqual([{ first_name: 'Ada', last_name: 'Synthetic', full_name: 'Ada Synthetic' }])
      receipt.profilePersisted = true
    })
    await test.step('workspace creation is persisted, Master-owned and reload-safe', async () => {
      await page.getByLabel('Workspace Name', { exact: true }).fill(tag)
      await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
      await expect(page).toHaveURL(`${APP}/dashboard`)
      const owned = await request(`/rest/v1/workspaces?created_by=eq.${userId}&select=id,name`)
      expect(owned).toHaveLength(1)
      workspaceId = owned[0].id
      const membership = await request(`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&select=user_id,role,status`)
      expect(membership).toEqual([{ user_id: userId, role: 'master', status: 'active' }])
      receipt.master = true
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Welcome back, Ada', exact: true })).toBeVisible()
      receipt.reload = true
      await page.screenshot({ path: testInfo.outputPath('03-master-dashboard.png'), fullPage: true, animations: 'disabled' })
    })
    expect(errors).toEqual([])
  } finally {
    // Recover IDs only for the exact random email if UI failure interrupted the normal readback.
    if (signupAttempted && !userId) userId = (await inventoryOwnUser())?.id
    if (userId) {
      const found = await request(`/auth/v1/admin/users/${userId}`, { admin: true })
      const user = found.user ?? found
      expect(user.email === email && UUID.test(userId)).toBe(true)
      if (!jwt && user.email_confirmed_at) {
        const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', token: anon, body: { email, password } })
        jwt = session.access_token; secretValues.add(jwt)
      }
      if (jwt) {
        const own = await request(`/rest/v1/workspaces?created_by=eq.${userId}&name=like.${tag}*&select=id,name`)
        for (const row of own) {
          expect(row.name.startsWith(tag) && UUID.test(row.id)).toBe(true)
          await guard()
          await request(`/rest/v1/workspaces?id=eq.${row.id}&name=like.${tag}*`, { method: 'DELETE' })
          expect(await request(`/rest/v1/workspaces?id=eq.${row.id}&select=id`)).toEqual([])
        }
      }
      await guard()
      await request(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', admin: true })
      expect(await inventoryOwnUser()).toBe(null)
    }
    await guard()
    await mail('delete')
    expect((await mail()).ids).toHaveLength(0)
    receipt.cleanup = true
    await writeFile(testInfo.outputPath('a1-safe-diagnostics.json'), JSON.stringify(receipt, null, 2))
  }
})
