const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const spec = readFileSync(path.join(__dirname, '../e2e/access-a1.spec.mjs'), 'utf8')
const script = spec.match(/const MAIL_SCRIPT = String.raw`([\s\S]*?)`/)[1]

function searchFixture(result) {
  const prelude = `globalThis.fetch = async () => ({ok: true, json: async () => (${JSON.stringify(result)})});\n`
  const child = spawnSync(process.execPath, ['-e', prelude + script], {
    input: JSON.stringify({ op: 'read', email: 'ui-a1-00000000-0000-0000-0000-000000000000@backbeat.test' }),
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(child.error, undefined)
  return { status: child.status, body: JSON.parse(child.stdout) }
}

test('Mailpit search ignores unrelated mailbox totals when the filtered result is complete', () => {
  assert.deepEqual(searchFixture({ total: 12, count: 0, messages_count: 0, messages: [] }), {
    status: 0,
    body: { ids: [], code: null },
  })
})

test('Mailpit search refuses an incomplete filtered result', () => {
  assert.deepEqual(searchFixture({ total: 12, count: 0, messages_count: 1, messages: [] }), {
    status: 1,
    body: { failed: true },
  })
})

test('Mailpit search refuses absent filtered-count metadata', () => {
  assert.deepEqual(searchFixture({ total: 0, count: 0, messages: [] }), {
    status: 1,
    body: { failed: true },
  })
})
