// A1 real HTTP tracer. Local marked synthetic database only; no DDL here.
// Additional adversarial cases below use fixture-admin lifecycle/setup only;
// all bootstrap calls use real password-login JWTs, never service-role RPCs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const API = 'http://127.0.0.1:55322'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

test('A1 confirmed actor bootstraps one atomic Master workspace and retries idempotently', async () => {
  assert.equal(process.env.BACKBEAT_TEST_URL, API, 'Refuse non-Development API')
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  assert.ok(anon && service && anon !== service, 'Distinct in-process fixture credentials required')
  const tag = `a1-http-${randomUUID()}`
  const email = `${tag}@backbeat.test`
  const password = randomBytes(32).toString('base64url') + 'aA1!'
  let userId
  let jwt
  const trackedWorkspaces = new Set()
  async function request(path, { method = 'GET', body, admin = false, token = jwt || anon } = {}) {
    assert.ok(path.startsWith('/') && !path.startsWith('//'))
    if (admin) assert.match(path, /^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?$/)
    let response
    try {
      response = await fetch(API + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { apikey: admin ? service : anon, Authorization: `Bearer ${admin ? service : token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new Error('Local A1 transport failed; details suppressed') }
    let data = null
    try { data = await response.json() } catch { /* Successful DELETE may have no body. */ }
    return { status: response.status, data }
  }
  function ok(result, label) {
    assert.ok(result.status >= 200 && result.status < 300, `${label}: HTTP ${result.status}`)
    return result.data
  }
  async function guard() {
    const data = ok(await request('/rest/v1/runtime_environment?select=id,environment,synthetic_only', { token: anon }), 'marker')
    assert.deepEqual(data, [{ id: 'backbeat-dev', environment: 'development', synthetic_only: true }])
  }
  async function mutate(path, options) { await guard(); return request(path, options) }
  try {
    const created = ok(await mutate('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true, user_metadata: { synthetic_fixture: tag, first_name: 'Ada', last_name: 'Synthetic' } } }), 'provision fixture only')
    userId = created.id ?? created.user?.id
    assert.match(userId, UUID)
    const session = ok(await mutate('/auth/v1/token?grant_type=password', { method: 'POST', token: anon, body: { email, password } }), 'fixture password login')
    jwt = session.access_token
    assert.ok(typeof jwt === 'string', 'Expected user session without logging it')
    // Backward-compatible prerequisite on baseline; not a public-signup proof.
    ok(await mutate(`/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', body: { full_name: 'Ada Synthetic' } }), 'profile setup')
    const first = ok(await mutate('/rest/v1/rpc/backbeat_bootstrap_workspace', { method: 'POST', body: { workspace_name: tag } }), 'A1 atomic workspace RPC')
    assert.match(first, UUID, 'RPC returns a workspace UUID')
    trackedWorkspaces.add(first)
    const workspace = ok(await request(`/rest/v1/workspaces?id=eq.${first}&select=id,name,created_by`), 'workspace read')
    assert.equal(workspace.length, 1)
    assert.equal(workspace[0].created_by, userId)
    assert.equal(workspace[0].name, tag)
    const memberships = ok(await request(`/rest/v1/workspace_members?workspace_id=eq.${first}&select=user_id,role,status`), 'membership read')
    assert.deepEqual(memberships, [{ user_id: userId, role: 'master', status: 'active' }])
    const onboarding = ok(await request(`/rest/v1/onboarding_status?user_id=eq.${userId}&select=completed,workspace_id`), 'onboarding read')
    assert.deepEqual(onboarding, [{ completed: true, workspace_id: first }])
    const second = ok(await mutate('/rest/v1/rpc/backbeat_bootstrap_workspace', { method: 'POST', body: { workspace_name: `${tag}-retry` } }), 'idempotent retry')
    assert.equal(second, first, 'Retry returns original workspace rather than provisioning again')
    const owned = ok(await request(`/rest/v1/workspaces?created_by=eq.${userId}&select=id,name`), 'owned workspace count')
    assert.deepEqual(owned, [{ id: first, name: tag }], 'Retry neither duplicates nor renames workspace')
  } finally {
    if (jwt && userId) {
      const owned = ok(await request(`/rest/v1/workspaces?created_by=eq.${userId}&name=like.${tag}*&select=id,name`), 'cleanup inventory')
      for (const row of owned) {
        assert.ok(row.name.startsWith(tag) && UUID.test(row.id), 'Cleanup fixture scope')
        trackedWorkspaces.add(row.id)
      }
      for (const id of trackedWorkspaces) {
        ok(await mutate(`/rest/v1/workspaces?id=eq.${id}&name=like.${tag}*`, { method: 'DELETE' }), 'delete fixture workspace')
        assert.deepEqual(ok(await request(`/rest/v1/workspaces?id=eq.${id}&select=id`), 'verify workspace cleanup'), [])
      }
    }
    if (userId) {
      const user = ok(await request(`/auth/v1/admin/users/${userId}`, { admin: true }), 'cleanup ownership')
      const record = user.user ?? user
      assert.ok(record.email === email && record.user_metadata?.synthetic_fixture === tag, 'Exact Auth fixture identity required')
      ok(await mutate(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', admin: true }), 'delete fixture user')
      assert.equal((await request(`/auth/v1/admin/users/${userId}`, { admin: true })).status, 404)
    }
  }
})

// Admin-created/confirmed accounts are synthetic fixtures, NOT public-signup proof.
// No forged JWT or unconfirmed-session fault injection belongs in this HTTP suite.
test('A1 adversarial bootstrap: ordinary JWTs and isolated fixture state', async (t) => {
  assert.ok(process.env.BACKBEAT_TEST_URL === API, 'Refuse non-Development API')
  const anon = process.env.BACKBEAT_TEST_ANON_KEY
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY
  assert.ok(anon && service && anon !== service, 'Distinct in-process fixture credentials required')
  const tag = `a1-http-${randomUUID()}`
  const actors = new Map()
  const spaces = new Set()
  const marker = [{ id: 'backbeat-dev', environment: 'development', synthetic_only: true }]
  const projection = {
    workspaces: 'id,name,created_by', workspace_members: 'workspace_id,user_id,role,status',
    onboarding_status: 'user_id,completed,workspace_id', profiles: 'id,first_name,last_name,full_name',
  }
  function success(r, label) {
    assert.ok(r.status >= 200 && r.status < 300, `${label}: HTTP ${r.status}`)
    return r.data
  }
  function denied(r, code = '42501') {
    assert.ok([400, 401, 403, 409].includes(r.status), `Expected denial: HTTP ${r.status}`)
    assert.ok(r.data?.code === code, `Expected error code ${code}; HTTP ${r.status}`)
  }
  // All assertions on provider results are booleans/statuses; no raw bodies in TAP.
  function same(actual, expected, label) {
    assert.ok(isDeepStrictEqual(actual, expected), label)
  }
  async function http(path, { method = 'GET', body, actor, fixture = false } = {}) {
    assert.ok(path.startsWith('/') && !path.startsWith('//'), 'Fixed-origin path required')
    if (fixture) assert.ok(/^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?$/.test(path)
      || /^\/rest\/v1\/(?:workspaces|workspace_members|onboarding_status|profiles)\?/.test(path), 'Fixture API allowlist')
    if (method !== 'GET') await guard()
    let response
    try {
      response = await fetch(API + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { apikey: fixture ? service : anon, Authorization: `Bearer ${fixture ? service : actor?.jwt || anon}`,
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new Error('A1 local HTTP transport failed; details suppressed') }
    let data = null
    try { data = await response.json() } catch { /* DELETE may have no body. */ }
    return { status: response.status, data }
  }
  async function guard() {
    const rows = success(await http('/rest/v1/runtime_environment?select=id,environment,synthetic_only'), 'marker')
    same(rows, marker, 'Exact singleton synthetic Development marker required')
  }
  function trackedActor(actor) { assert.ok(actors.get(actor?.id) === actor, 'Run-owned actor required') }
  function trackedSpace(id) { assert.ok(spaces.has(id) && UUID.test(id), 'Run-owned workspace required') }
  async function read(actor, table, filter, fixture = false) {
    assert.ok(Object.hasOwn(projection, table), 'Read projection allowlist')
    const data = success(await http(`/rest/v1/${table}?${filter}&select=${projection[table]}`, { actor, fixture }), `read ${table}`)
    assert.ok(Array.isArray(data), 'Expected rows')
    return data
  }
  async function createActor(label, metadata = {}) {
    const email = `${tag}-${label}@backbeat.test`
    const password = randomBytes(32).toString('base64url') + 'aA1!'
    const data = success(await http('/auth/v1/admin/users', { method: 'POST', fixture: true,
      body: { email, password, email_confirm: true, user_metadata: { ...metadata, synthetic_fixture: tag } } }), 'create fixture')
    const id = data?.id ?? data?.user?.id
    assert.ok(typeof id === 'string' && UUID.test(id), 'Fixture actor UUID required')
    const actor = { id, email, jwt: null }
    actors.set(id, actor) // Track before login/assertions can fail.
    const session = success(await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }), 'password login')
    assert.ok(typeof session?.access_token === 'string' && session.user?.id === id, 'Matching ordinary Auth session required')
    actor.jwt = session.access_token
    return actor
  }
  async function rpc(actor, name = tag) {
    if (actor) trackedActor(actor)
    const r = await http('/rest/v1/rpc/backbeat_bootstrap_workspace', { method: 'POST', actor, body: { workspace_name: name } })
    // Track a returned ID only after checking it belongs to this run. On a bad
    // implementation, cleanup also inventories by exact tracked creator IDs.
    if (r.status >= 200 && r.status < 300 && typeof r.data === 'string' && UUID.test(r.data)) {
      const rows = await read(actor, 'workspaces', `id=eq.${r.data}`, true)
      assert.ok(rows.length === 1 && actors.has(rows[0].created_by) && rows[0].name.startsWith(tag), 'RPC workspace must belong to fixture run')
      spaces.add(r.data)
    }
    return r
  }
  async function bootstrap(actor, suffix) {
    const id = success(await rpc(actor, `${tag}-${suffix}`), 'ordinary JWT bootstrap')
    assert.ok(typeof id === 'string' && UUID.test(id), 'Bootstrap UUID required')
    return id
  }
  // Only these narrow wrappers may perform fixture-only state setup.
  async function membership(actor, workspace, role, status, method = 'POST') {
    trackedActor(actor); trackedSpace(workspace)
    assert.ok(['member', 'admin', 'master'].includes(role) && ['active', 'inactive', 'pending'].includes(status), 'Fixture membership values')
    assert.ok(['POST', 'DELETE'].includes(method), 'Fixture membership operation')
    success(await http(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${actor.id}`, {
      method, fixture: true, ...(method === 'POST' ? { body: { workspace_id: workspace, user_id: actor.id, role, status } } : {}),
    }), 'fixture membership setup')
    same(await read(actor, 'workspace_members', `workspace_id=eq.${workspace}&user_id=eq.${actor.id}`, true),
      method === 'DELETE' ? [] : [{ workspace_id: workspace, user_id: actor.id, role, status }], 'Fixture membership persisted')
  }
  async function selection(actor, workspace, completed = false) {
    trackedActor(actor)
    if (workspace !== null) trackedSpace(workspace)
    success(await http(`/rest/v1/onboarding_status?user_id=eq.${actor.id}`, {
      method: 'PATCH', fixture: true, body: { workspace_id: workspace, completed },
    }), 'fixture selection setup')
    same(await read(actor, 'onboarding_status', `user_id=eq.${actor.id}`, true),
      [{ user_id: actor.id, completed, workspace_id: workspace }], 'Fixture selection persisted')
  }
  async function state(actor) {
    trackedActor(actor)
    return {
      owned: await read(actor, 'workspaces', `created_by=eq.${actor.id}&order=id`, true),
      memberships: await read(actor, 'workspace_members', `user_id=eq.${actor.id}&order=workspace_id`, true),
      onboarding: await read(actor, 'onboarding_status', `user_id=eq.${actor.id}`, true),
    }
  }
  async function rejectedUnchanged(actor, name = tag, code = '42501') {
    const before = await state(actor)
    denied(await rpc(actor, name), code)
    same(await state(actor), before, 'Rejected bootstrap leaves fixture state unchanged')
  }
  await guard()
  t.after(async () => {
    const failures = []
    // Recover workspaces committed by failed/concurrent requests whose response
    // was lost; inventory is bounded to tracked Auth IDs, never baseline rows.
    for (const actor of actors.values()) {
      try {
        for (const row of await read(actor, 'workspaces', `created_by=eq.${actor.id}`, true)) {
          assert.ok(UUID.test(row.id) && row.created_by === actor.id && row.name.startsWith(tag), 'Cleanup inventory scope')
          spaces.add(row.id)
        }
      } catch { failures.push('fixture inventory failed') }
    }
    for (const id of spaces) {
      try {
        trackedSpace(id)
        const rows = await read(null, 'workspaces', `id=eq.${id}`, true)
        assert.ok(rows.every(row => actors.has(row.created_by) && row.name.startsWith(tag)), 'Workspace cleanup ownership')
        success(await http(`/rest/v1/workspaces?id=eq.${id}`, { method: 'DELETE', fixture: true }), 'workspace cleanup')
        same(await read(null, 'workspaces', `id=eq.${id}`, true), [], 'No workspace leftover')
        same(await read(null, 'workspace_members', `workspace_id=eq.${id}`, true), [], 'No workspace membership leftover')
      } catch { failures.push('workspace cleanup failed') }
    }
    for (const actor of actors.values()) {
      try {
        trackedActor(actor)
        const data = success(await http(`/auth/v1/admin/users/${actor.id}`, { fixture: true }), 'Auth cleanup ownership')
        const record = data?.user ?? data
        assert.ok(record?.id === actor.id && record.email === actor.email && record.user_metadata?.synthetic_fixture === tag, 'Exact fixture identity required')
        // Do not let deleting an Auth creator conceal an inventory failure.
        same(await read(actor, 'workspaces', `created_by=eq.${actor.id}`, true), [], 'Delete workspaces before Auth actor')
        success(await http(`/auth/v1/admin/users/${actor.id}`, { method: 'DELETE', fixture: true }), 'Auth cleanup')
        assert.ok((await http(`/auth/v1/admin/users/${actor.id}`, { fixture: true })).status === 404, 'No Auth leftover')
        for (const [table, key] of [['profiles', 'id'], ['onboarding_status', 'user_id'], ['workspace_members', 'user_id']]) {
          same(await read(null, table, `${key}=eq.${actor.id}`, true), [], 'No actor-dependent leftover')
        }
      } catch { failures.push('actor cleanup failed') }
    }
    assert.ok(failures.length === 0, `Cleanup incomplete: ${failures.join('; ')}`)
  })

  await t.test('anonymous bootstrap is denied', async () => { denied(await rpc(null)) })

  await t.test('six simultaneous normal-JWT requests create exactly one Master workspace', async () => {
    const actor = await createActor('race')
    // All requests settle before any assertion/cleanup (no Promise.all early exit).
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => rpc(actor, `  ${tag}-race  `)))
    assert.ok(results.every(r => r.status === 'fulfilled'), 'Concurrent HTTP requests must settle successfully')
    const ids = results.map(r => success(r.value, 'concurrent bootstrap'))
    assert.ok(ids.every(id => UUID.test(id)) && new Set(ids).size === 1, 'Concurrent results share one UUID')
    const id = ids[0]
    const snapshot = await state(actor)
    same(snapshot.owned, [{ id, name: `${tag}-race`, created_by: actor.id }], 'Exactly one normalized workspace')
    same(snapshot.memberships, [{ workspace_id: id, user_id: actor.id, role: 'master', status: 'active' }], 'Exactly one active Master membership')
    same(snapshot.onboarding, [{ user_id: actor.id, completed: true, workspace_id: id }], 'Atomic onboarding completion')
    assert.ok(success(await rpc(actor, `${tag}-no-rename`), 'retry') === id, 'Retry reuses ID')
    same(await state(actor), snapshot, 'Retry neither duplicates nor renames')
  })

  await t.test('invalid names reject without partial state; 200-character boundary succeeds', async () => {
    const actor = await createActor('bounds')
    for (const name of [null, '', '   ', 'x'.repeat(201), `${tag}\n`, `${tag}\tbad`]) {
      await rejectedUnchanged(actor, name, '22023')
    }
    const name = tag + 'x'.repeat(200 - tag.length)
    const id = success(await rpc(actor, name), 'maximum length name')
    same(await read(actor, 'workspaces', `id=eq.${id}`), [{ id, name, created_by: actor.id }], 'Boundary name persisted')
  })

  const ownerA = await createActor('owner-a')
  const ownerB = await createActor('owner-b')
  const a = await bootstrap(ownerA, 'tenant-a')
  const b = await bootstrap(ownerB, 'tenant-b')

  await t.test('direct workspace/member INSERT and onboarding UPDATE stay denied after bootstrap', async () => {
    const before = await state(ownerA)
    const id = randomUUID()
    spaces.add(id) // Track attempted INSERT even if the implementation is vulnerable.
    denied(await http('/rest/v1/workspaces', { method: 'POST', actor: ownerA, body: { id, name: `${tag}-bypass`, created_by: ownerA.id } }))
    for (const role of ['master', 'admin', 'member']) {
      denied(await http('/rest/v1/workspace_members', { method: 'POST', actor: ownerA,
        body: { workspace_id: b, user_id: ownerA.id, role, status: 'active' } }))
    }
    for (const body of [{ completed: false }, { workspace_id: b }, { completed: true, workspace_id: b }]) {
      denied(await http(`/rest/v1/onboarding_status?user_id=eq.${ownerA.id}`, { method: 'PATCH', actor: ownerA, body }))
    }
    same(await state(ownerA), before, 'Denied direct writes leave state unchanged')
  })

  for (const role of ['member', 'admin']) {
    await t.test(`selected active ${role} reused among multiple memberships without escalation`, async () => {
      const actor = await createActor(`selected-${role}`)
      await membership(actor, a, role, 'active')
      await membership(actor, b, 'member', 'active')
      await selection(actor, a)
      const before = await state(actor)
      assert.ok(await bootstrap(actor, 'ignored-selected') === a, 'Selected membership reused')
      const after = await state(actor)
      same(after.owned, [], 'Member does not become workspace creator')
      same(after.memberships, before.memberships, 'Roles/statuses remain unchanged')
      same(after.onboarding, [{ user_id: actor.id, completed: true, workspace_id: a }], 'Selection completed')
    })
  }
  for (const selected of [null, 'invalid']) {
    await t.test(selected === null ? 'sole active member reused with no selection, never promoted to Master' : 'invalid nonnull selection fails closed despite another sole active membership', async () => {
      const actor = await createActor(`sole-${selected ?? 'none'}`)
      await membership(actor, a, 'member', 'active')
      await selection(actor, selected === null ? null : b)
      if (selected !== null) {
        // A revoked/stale selected tenant is not permission to switch tenants.
        await rejectedUnchanged(actor)
        return
      }
      assert.ok(await bootstrap(actor, 'ignored-sole') === a, 'Sole active membership must be reused')
      const after = await state(actor)
      same(after.owned, [], 'No additional workspace')
      same(after.memberships, [{ workspace_id: a, user_id: actor.id, role: 'member', status: 'active' }], 'No Master escalation')
      same(after.onboarding, [{ user_id: actor.id, completed: true, workspace_id: a }], 'Previously absent selection set to sole active membership')
    })
  }
  for (const status of ['inactive', 'pending']) {
    await t.test(`${status}-only membership rejects without reactivation or provisioning`, async () => {
      const actor = await createActor(status)
      await membership(actor, a, 'member', status)
      await rejectedUnchanged(actor)
    })
  }
  for (const selected of [null, 'invalid']) {
    await t.test(`multiple active memberships with ${selected === null ? 'no' : 'invalid'} selection reject ambiguity`, async () => {
      const actor = await createActor(`ambiguous-${selected ?? 'none'}`)
      await membership(actor, a, 'member', 'active')
      await membership(actor, b, 'admin', 'active')
      if (selected !== null) {
        const owner = await createActor('third-owner')
        await selection(actor, await bootstrap(owner, 'third'))
      }
      await rejectedUnchanged(actor)
    })
  }
  await t.test('orphan-created workspace rejects instead of regranting Master', async () => {
    const actor = await createActor('orphan')
    const id = await bootstrap(actor, 'orphan')
    await membership(actor, id, 'master', 'active', 'DELETE')
    await selection(actor, null)
    same((await state(actor)).memberships, [], 'Orphan fixture has no membership')
    await rejectedUnchanged(actor)
  })
  await t.test('nonmember cannot see or provision into another tenant through selection', async () => {
    const actor = await createActor('nonmember')
    const targetBefore = await state(ownerA)
    same(await read(actor, 'workspaces', `id=eq.${a}`), [], 'Foreign workspace hidden')
    same(await read(actor, 'workspace_members', `workspace_id=eq.${a}`), [], 'Foreign memberships hidden')
    denied(await http('/rest/v1/workspace_members', { method: 'POST', actor,
      body: { workspace_id: a, user_id: actor.id, role: 'master', status: 'active' } }))
    denied(await http(`/rest/v1/onboarding_status?user_id=eq.${actor.id}`, { method: 'PATCH', actor, body: { completed: true, workspace_id: a } }))
    // Fixture-only stale pointer probes the actual one-argument RPC contract.
    // Never invent workspace_id/user_id RPC parameters or forge a token.
    await selection(actor, a)
    await rejectedUnchanged(actor)
    same(await state(ownerA), targetBefore, 'Target tenant unchanged')
    same(await read(actor, 'workspaces', `id=eq.${a}`), [], 'Rejected bootstrap does not grant visibility')
  })

  await t.test('real Auth INSERT hook normalizes names and retains legacy full_name without splitting', async () => {
    const cases = [
      ['names', { first_name: '  Ada  ', last_name: '  Synthetic  ', full_name: 'Ignored Legacy' }, 'Ada', 'Synthetic', 'Ada Synthetic'],
      ['legacy', { full_name: '  Legacy Unsplit Display Name  ' }, null, null, 'Legacy Unsplit Display Name'],
      ['typed', { first_name: 42, last_name: ['Synthetic'], full_name: 'Legacy Fallback' }, null, null, 'Legacy Fallback'],
      ['invalid', { first_name: 'x'.repeat(101), last_name: 'bad\nname', full_name: 'Safe Fallback' }, null, null, 'Safe Fallback'],
      ['partial', { first_name: '  Ada  ', full_name: 'Legacy Partial' }, 'Ada', null, 'Legacy Partial'],
      ['empty', { first_name: ' ', last_name: '', full_name: '  ' }, null, null, null],
    ]
    for (const [label, metadata, first_name, last_name, full_name] of cases) {
      const actor = await createActor(`identity-${label}`, metadata)
      same(await read(actor, 'profiles', `id=eq.${actor.id}`), [{ id: actor.id, first_name, last_name, full_name }], 'Auth insert identity normalization')
      same((await state(actor)).owned, [], 'Identity hook does not provision workspace')
      if (label === 'legacy') {
        await bootstrap(actor, 'legacy-profile')
        same(await read(actor, 'profiles', `id=eq.${actor.id}`), [{ id: actor.id, first_name, last_name, full_name }], 'Bootstrap retains legacy fullname')
      }
    }
  })
  await t.test('legacy creator rename/delete and own profile edit remain authorized', async () => {
    const actor = await createActor('legacy-crud')
    const id = await bootstrap(actor, 'legacy-crud')
    success(await http(`/rest/v1/profiles?id=eq.${actor.id}`, { method: 'PATCH', actor, body: { full_name: 'Synthetic Updated' } }), 'own profile update')
    assert.ok((await read(actor, 'profiles', `id=eq.${actor.id}`))[0]?.full_name === 'Synthetic Updated', 'Own profile edit persists')
    const name = `${tag}-renamed`
    success(await http(`/rest/v1/workspaces?id=eq.${id}`, { method: 'PATCH', actor, body: { name } }), 'creator rename')
    same(await read(actor, 'workspaces', `id=eq.${id}`), [{ id, name, created_by: actor.id }], 'Creator rename persists')
    success(await http(`/rest/v1/workspaces?id=eq.${id}`, { method: 'DELETE', actor }), 'creator delete')
    same(await read(actor, 'workspaces', `id=eq.${id}`, true), [], 'Creator delete really removed workspace')
  })
})
