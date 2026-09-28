// Real HTTP regression contract. No migrations are applied by this runner.
// Run with credentials already exported (never put secrets in command arguments):
// BACKBEAT_TEST_URL=http://127.0.0.1:55322 node --test tests/integration/core.test.mjs
// Required: BACKBEAT_TEST_ANON_KEY, BACKBEAT_TEST_SERVICE_ROLE_KEY.
// Missing schema/marker is an intended read-only RED; fixtures never bypass it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const TARGET = 'http://127.0.0.1:55322';
const MARKER = { id: 'backbeat-dev', environment: 'development', synthetic_only: true };
const columns = {
  profiles: 'id,full_name,avatar_url,created_at',
  onboarding_status: 'user_id,completed,workspace_id',
  workspaces: 'id,name,created_by,created_at',
  workspace_members: 'workspace_id,user_id,role,status',
  artists: 'id,workspace_id,name,email,phone,notes,stage_name,surname,location,travel_fee,pricing_notes,overview,dj_equipment,sound_system,allergies,special_diet,special_needs,genres,fee,currency,social_links,documents,profile_image_url,created_at,updated_at',
  promoters: 'id,workspace_id,name,company_name,email,phone,notes,created_at',
  events: 'id,workspace_id,title,date,location,status,artist_id,promoter_id,public_token,created_at',
  bookings: 'id,workspace_id,artist_id,date,start_time,duration_minutes,notes,status,created_at,updated_at',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Errors contain only HTTP status and allowlisted PostgreSQL/PostgREST codes.
// Never hand response bodies, Auth objects, or fetch causes to node:test.
function summary(r) {
  const code = typeof r.body?.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(r.body.code)
    ? r.body.code : 'redacted';
  return `HTTP ${r.status}; code ${code}`;
}
function ok(r, label) {
  assert.ok(r.status >= 200 && r.status < 300, `${label}: ${summary(r)}`);
  return r.body;
}
function denied(r, label, code = '42501') {
  assert.ok([400, 401, 403, 409].includes(r.status), `${label}: expected rejection; ${summary(r)}`);
  assert.ok(r.body?.code === code, `${label}: expected ${code}; ${summary(r)}`);
}
function untouched(r, label) {
  if (r.status >= 200 && r.status < 300) assert.deepEqual(r.body, [], `${label}: no rows may change`);
  else denied(r, label);
}

// One sequential parent prevents fixture races. Individual subtests retain TAP evidence.
test('Backbeat M1: isolated development schema and user-JWT RLS', async (t) => {
  assert.ok(process.env.BACKBEAT_TEST_URL === TARGET, 'Refusing target: BACKBEAT_TEST_URL must exactly equal the approved local API');
  const anon = process.env.BACKBEAT_TEST_ANON_KEY;
  const service = process.env.BACKBEAT_TEST_SERVICE_ROLE_KEY;
  assert.ok(anon && service && anon !== service, 'Two distinct test credentials must be exported');
  const tag = `m1-${randomUUID()}`;
  t.diagnostic(`Synthetic fixture run: ${tag}; no raw HTTP errors or credentials are emitted`);
  const users = [];
  const workspaces = [];
  async function http(path, { method = 'GET', body, token = anon, admin = false } = {}) {
    assert.ok(path.startsWith('/') && !path.startsWith('//'), 'Only fixed-origin relative paths allowed');
    if (admin) assert.ok(/^\/auth\/v1\/admin\/users(?:\/[0-9a-f-]+)?$/.test(path), 'Service credential is restricted to fixture Auth lifecycle');
    let response;
    try {
      response = await fetch(TARGET + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { apikey: admin ? service : anon, Authorization: `Bearer ${admin ? service : token}`,
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('Local HTTP transport failed (details redacted)'); }
    let data;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, body: data };
  }
  async function guard() {
    const r = await http('/rest/v1/runtime_environment?select=id,environment,synthetic_only');
    const rows = ok(r, 'development marker must exist before any mutation');
    assert.ok(Array.isArray(rows) && rows.length === 1 && Object.entries(MARKER).every(([k, v]) => rows[0][k] === v), 'Refusing mutation: exact singleton development/synthetic-only marker required');
  }
  async function rest(actor, table, method = 'GET', body, query = '') {
    // Stronger than phase guarding: recheck marker before EACH application mutation.
    if (method !== 'GET') await guard();
    return http(`/rest/v1/${table}${query ? '?' + query : ''}`, { method, body, token: actor?.jwt });
  }
  async function rows(actor, table, query = '') {
    return ok(await rest(actor, table, 'GET', undefined, query), `read ${table}`);
  }
  async function insert(actor, table, body) {
    const data = ok(await rest(actor, table, 'POST', body), `insert ${table}`);
    assert.ok(Array.isArray(data) && data.length === 1, `insert ${table} returns one visible row`);
    return data[0];
  }
  async function createUser(label) {
    await guard();
    const email = `${tag}-${label}@backbeat.test`;
    const password = randomBytes(32).toString('base64url') + 'aA1!';
    const created = ok(await http('/auth/v1/admin/users', { method: 'POST', admin: true,
      body: { email, password, email_confirm: true, user_metadata: { synthetic_fixture: tag } } }), 'create synthetic Auth fixture');
    const id = created?.id ?? created?.user?.id;
    assert.ok(typeof id === 'string' && uuid.test(id), 'Auth fixture must return UUID');
    const actor = { id, email, jwt: null };
    users.push(actor); // Track before login so failed setup still cleans Auth fixtures.
    await guard();
    const login = ok(await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }), 'normal password login');
    assert.ok(typeof login?.access_token === 'string' && login.user?.id === id, 'normal login must yield matching user JWT');
    actor.jwt = login.access_token;
    return actor;
  }

  // No fixture writes can happen until this read-only prerequisite succeeds.
  await guard();
  t.after(async () => {
    // Never truncate/reset; only exact IDs generated/tracked by this invocation.
    // Keep failed-test TAP evidence; cleanup failures are reported, never swallowed.
    const failures = [];
    for (const { actor, id } of workspaces.toReversed()) {
      try {
        ok(await rest(actor, 'workspaces', 'DELETE', undefined, `id=eq.${id}&name=like.${tag}*`), 'cleanup fixture workspace');
        assert.deepEqual(await rows(actor, 'workspaces', `id=eq.${id}`), [], 'fixture workspace deleted');
      } catch { failures.push('workspace cleanup failed'); }
    }
    for (const actor of users.toReversed()) {
      try {
        await guard();
        const r = await http(`/auth/v1/admin/users/${actor.id}`, { admin: true });
        const user = ok(r, 'verify fixture ownership before deletion');
        const record = user?.user ?? user;
        assert.ok(record.email === actor.email && record.user_metadata?.synthetic_fixture === tag, 'cleanup requires exact synthetic fixture identity');
        await guard();
        ok(await http(`/auth/v1/admin/users/${actor.id}`, { method: 'DELETE', admin: true }), 'delete synthetic Auth fixture');
        const missing = await http(`/auth/v1/admin/users/${actor.id}`, { admin: true });
        assert.ok(missing.status === 404, 'deleted Auth fixture must be absent');
      } catch { failures.push('Auth cleanup failed'); }
    }
    assert.ok(failures.length === 0, `Cleanup incomplete for ${tag}: ${failures.join('; ')}`);
  });

  const a = await createUser('a');
  const b = await createUser('b');
  await t.test('all required tables and columns exist in the real REST schema', async () => {
    for (const [table, select] of Object.entries(columns)) {
      ok(await rest(a, table, 'GET', undefined, `select=${select}&limit=0`), `schema contract ${table}`);
    }
  });
  for (const [label, actor] of [['a', a], ['b', b]]) {
    await t.test(`${label}: signup triggers, own profile, create/select workspace before membership, onboarding`, async () => {
      const profile = await rows(actor, 'profiles', `id=eq.${actor.id}`);
      assert.equal(profile.length, 1, 'signup trigger creates profile');
      const onboarding = await rows(actor, 'onboarding_status', `user_id=eq.${actor.id}`);
      assert.equal(onboarding.length, 1, 'signup trigger creates onboarding');
      assert.equal(onboarding[0].completed, false);
      assert.equal(onboarding[0].workspace_id, null);
      ok(await rest(actor, 'profiles', 'PATCH', { full_name: `${tag}-${label}` }, `id=eq.${actor.id}`), 'own profile update');
      assert.equal((await rows(actor, 'profiles', `id=eq.${actor.id}`))[0].full_name, `${tag}-${label}`);
      // Match app contract: no created_by supplied; INSERT .select must work now.
      const workspace = await insert(actor, 'workspaces', { name: `${tag}-${label}` });
      actor.workspace = workspace.id;
      workspaces.push({ actor, id: workspace.id });
      assert.equal(workspace.created_by, actor.id);
      assert.equal((await rows(actor, 'workspaces', `id=eq.${workspace.id}`)).length, 1);
      for (const membership of [{ role: 'admin', status: 'inactive' }, { role: 'admin', status: 'pending' }, { role: 'member', status: 'active' }]) {
        denied(await rest(actor, 'workspace_members', 'POST', { workspace_id: workspace.id, user_id: actor.id, ...membership }), 'bootstrap allows only active admin');
      }
      await insert(actor, 'workspace_members', { workspace_id: workspace.id, user_id: actor.id, role: 'admin', status: 'active' });
      ok(await rest(actor, 'onboarding_status', 'PATCH', { completed: true, workspace_id: workspace.id }, `user_id=eq.${actor.id}`), 'complete onboarding');
      const done = await rows(actor, 'onboarding_status', `user_id=eq.${actor.id}&select=*,workspaces(*)`);
      assert.equal(done[0].completed, true);
      assert.equal(done[0].workspaces.id, workspace.id);
    });
  }
  assert.ok(a.workspace && b.workspace, 'Workspace setup must succeed before dependent assertions');
  for (const actor of [a, b]) {
    actor.artist = await insert(actor, 'artists', { workspace_id: actor.workspace, name: 'Synthetic Real', stage_name: 'Synthetic Stage', surname: 'Fixture', genres: ['test'], fee: 125, notes: tag });
    actor.promoter = await insert(actor, 'promoters', { workspace_id: actor.workspace, name: `${tag}-promoter` });
    actor.booking = await insert(actor, 'bookings', { workspace_id: actor.workspace, artist_id: actor.artist.id, date: '2030-01-02', start_time: '20:30', duration_minutes: 90, notes: tag });
    actor.event = await insert(actor, 'events', { workspace_id: actor.workspace, title: `${tag}-event`, date: '2030-01-02', public_token: `${tag}-${actor.id}`, artist_id: actor.artist.id, promoter_id: actor.promoter.id });
  }
  await t.test('artist real/stage names and booking CRUD persist with existing app joins', async () => {
    const artist = (await rows(a, 'artists', `id=eq.${a.artist.id}`))[0];
    assert.equal(artist.name, 'Synthetic Real');
    assert.equal(artist.stage_name, 'Synthetic Stage');
    assert.equal(artist.currency, 'USD');
    assert.deepEqual(artist.social_links, []);
    assert.deepEqual(artist.documents, []);
    assert.equal(artist.profile_image_url, null);
    const join = encodeURIComponent('*,artist:artists(id,stage_name,name,surname,location,fee,currency,profile_image_url)');
    const booking = (await rows(a, 'bookings', `id=eq.${a.booking.id}&select=${join}`))[0];
    assert.equal(booking.artist.id, a.artist.id);
    assert.equal(booking.status, 'in_progress');
    const patch = { status: 'confirmed', date: '2030-02-03', start_time: '21:15:00', duration_minutes: 60, notes: `${tag}-updated`, updated_at: new Date().toISOString() };
    ok(await rest(a, 'bookings', 'PATCH', patch, `id=eq.${a.booking.id}`), 'booking update');
    const persisted = (await rows(a, 'bookings', `id=eq.${a.booking.id}`))[0];
    for (const key of ['status', 'date', 'start_time', 'duration_minutes', 'notes']) assert.equal(persisted[key], patch[key]);
    const eventJoin = encodeURIComponent('*,artists:artist_id(id,name),promoters:promoter_id(id,name,company_name)');
    const event = (await rows(a, 'events', `id=eq.${a.event.id}&select=${eventJoin}`))[0];
    assert.equal(event.date, '2030-01-02');
    assert.equal(event.status, 'in_progress');
    assert.equal(event.public_token, `${tag}-${a.id}`);
    assert.equal(event.artists.id, a.artist.id);
    assert.equal(event.promoters.id, a.promoter.id);
  });
  await t.test('creator cannot be forged; foreign self-join and membership tampering fail', async () => {
    const forgedId = randomUUID();
    // Track even a forbidden insert, so a vulnerable implementation leaves no orphan.
    workspaces.push({ actor: a, id: forgedId }, { actor: b, id: forgedId });
    denied(await rest(b, 'workspaces', 'POST', { id: forgedId, name: `${tag}-forged`, created_by: a.id }), 'forged creator');
    untouched(await rest(b, 'workspace_members', 'PATCH', { role: 'admin' }, `workspace_id=eq.${a.workspace}&user_id=eq.${a.id}`), 'foreign membership escalation');
    denied(await rest(b, 'workspace_members', 'POST', { workspace_id: a.workspace, user_id: b.id, role: 'admin', status: 'active' }), 'foreign self-join');
    for (const patch of [{ role: 'member' }, { status: 'inactive' }, { workspace_id: a.workspace }, { user_id: a.id }]) {
      untouched(await rest(b, 'workspace_members', 'PATCH', patch, `workspace_id=eq.${b.workspace}&user_id=eq.${b.id}`), 'membership tampering');
    }
    untouched(await rest(b, 'workspace_members', 'DELETE', undefined, `workspace_id=eq.${b.workspace}&user_id=eq.${b.id}`), 'membership deletion');
    assert.deepEqual(await rows(b, 'workspace_members', `user_id=eq.${b.id}`), [{ workspace_id: b.workspace, user_id: b.id, role: 'admin', status: 'active' }]);
    denied(await rest(b, 'onboarding_status', 'PATCH', { workspace_id: a.workspace }, `user_id=eq.${b.id}`), 'foreign onboarding pointer');
    assert.equal((await rows(b, 'onboarding_status', `user_id=eq.${b.id}`))[0].workspace_id, b.workspace);
  });
  await t.test('foreign SELECT/UPDATE/DELETE cannot expose or change real target rows', async () => {
    const targets = [
      ['artists', 'id', a.artist.id, { notes: 'tampered' }],
      ['bookings', 'id', a.booking.id, { status: 'cancelled' }],
      ['promoters', 'id', a.promoter.id, { name: 'tampered' }],
      ['events', 'id', a.event.id, { title: 'tampered' }],
      ['workspaces', 'id', a.workspace, { name: 'tampered' }],
      ['profiles', 'id', a.id, { full_name: 'tampered' }],
      ['onboarding_status', 'user_id', a.id, { completed: false }],
      ['workspace_members', 'workspace_id', a.workspace, { role: 'member' }],
    ];
    for (const [table, key, id, patch] of targets) {
      const query = `${key}=eq.${id}`;
      const before = await rows(a, table, query);
      assert.equal(before.length, 1, `${table}: positive control exists`);
      assert.deepEqual(await rows(b, table, query), [], `${table}: foreign rows hidden`);
      untouched(await rest(b, table, 'PATCH', patch, query), `${table}: foreign update`);
      untouched(await rest(b, table, 'DELETE', undefined, query), `${table}: foreign delete`);
      assert.deepEqual(await rows(a, table, query), before, `${table}: owner verifies unchanged target`);
    }
  });
  await t.test('foreign inserts and moving artist/booking workspace are rejected', async () => {
    for (const [table, body] of [
      ['artists', { name: 'forbidden' }], ['promoters', { name: 'forbidden' }],
      ['events', { title: 'forbidden', date: '2030-01-01' }],
      ['bookings', { artist_id: a.artist.id, date: '2030-01-01', start_time: '12:00' }],
    ]) denied(await rest(b, table, 'POST', { ...body, workspace_id: a.workspace }), `${table}: foreign insert`);
    for (const [table, id] of [['artists', b.artist.id], ['bookings', b.booking.id]]) {
      denied(await rest(b, table, 'PATCH', { workspace_id: a.workspace }, `id=eq.${id}`), `${table}: foreign reassignment`);
      assert.equal((await rows(b, table, `id=eq.${id}`))[0].workspace_id, b.workspace);
    }
    denied(await rest(b, 'profiles', 'POST', { id: a.id }), 'foreign profile insert');
    denied(await rest(b, 'onboarding_status', 'POST', { user_id: a.id, completed: false }), 'foreign onboarding insert');
  });
  await t.test('composite FKs reject cross-workspace artist/promoter links with 23503', async () => {
    denied(await rest(b, 'bookings', 'POST', { workspace_id: b.workspace, artist_id: a.artist.id, date: '2030-01-01', start_time: '12:00' }), 'cross-workspace booking artist FK', '23503');
    denied(await rest(b, 'bookings', 'PATCH', { artist_id: a.artist.id }, `id=eq.${b.booking.id}`), 'cross-workspace booking update FK', '23503');
    for (const relation of [{ artist_id: a.artist.id }, { promoter_id: a.promoter.id }]) {
      denied(await rest(b, 'events', 'POST', { workspace_id: b.workspace, title: 'invalid relation', date: '2030-01-01', ...relation }), 'cross-workspace event FK', '23503');
    }
    assert.equal((await rows(b, 'bookings', `id=eq.${b.booking.id}`))[0].artist_id, b.artist.id);
  });
  await t.test('anonymous access denied on every application table; sentinel is read-only', async () => {
    for (const table of Object.keys(columns)) {
      denied(await rest(null, table), `${table}: anonymous read`);
    }
    denied(await rest(null, 'artists', 'POST', { workspace_id: a.workspace, name: 'anonymous' }), 'anonymous insert');
    denied(await rest(null, 'runtime_environment', 'PATCH', { synthetic_only: false }, 'id=eq.backbeat-dev'), 'anonymous marker tamper');
    denied(await rest(a, 'runtime_environment', 'PATCH', { synthetic_only: false }, 'id=eq.backbeat-dev'), 'authenticated marker tamper');
    await guard();
  });
  await t.test('booking required date/status constraints return PostgreSQL errors', async () => {
    const base = { workspace_id: b.workspace, artist_id: b.artist.id, date: '2030-01-01', start_time: '12:00' };
    denied(await rest(b, 'bookings', 'POST', { ...base, date: '' }), 'empty date', '22007');
    denied(await rest(b, 'bookings', 'POST', { ...base, date: null }), 'required date', '23502');
    denied(await rest(b, 'bookings', 'POST', { ...base, status: 'pending' }), 'unsupported booking status', '23514');
  });
  await t.test('artist delete cascades bookings and nulls only event artist; promoter delete preserves workspace', async () => {
    ok(await rest(b, 'artists', 'DELETE', undefined, `id=eq.${b.artist.id}`), 'own artist deletion');
    assert.deepEqual(await rows(b, 'artists', `id=eq.${b.artist.id}`), []);
    assert.deepEqual(await rows(b, 'bookings', `id=eq.${b.booking.id}`), []);
    let event = (await rows(b, 'events', `id=eq.${b.event.id}`))[0];
    assert.equal(event.artist_id, null);
    assert.equal(event.workspace_id, b.workspace);
    ok(await rest(b, 'promoters', 'DELETE', undefined, `id=eq.${b.promoter.id}`), 'own promoter deletion');
    assert.deepEqual(await rows(b, 'promoters', `id=eq.${b.promoter.id}`), []);
    event = (await rows(b, 'events', `id=eq.${b.event.id}`))[0];
    assert.equal(event.promoter_id, null);
    assert.equal(event.workspace_id, b.workspace);
    ok(await rest(a, 'bookings', 'DELETE', undefined, `id=eq.${a.booking.id}`), 'own booking deletion');
    assert.deepEqual(await rows(a, 'bookings', `id=eq.${a.booking.id}`), []);
  });
});
