const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('CI runs every deterministic gate without deployment privileges', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  for (const text of [
    'pull_request:', 'workflow_dispatch:', 'contents: read',
    'name: Quality', "node-version: '22.23.2'", "version: '12.3.4'",
    'pnpm install --frozen-lockfile --ignore-scripts',
    'pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm test:runtime', 'pnpm build',
  ]) assert.ok(workflow.includes(text), `Missing CI contract: ${text}`)
  assert.equal(/pull_request_target|continue-on-error|secrets\.|vercel deploy|supabase db push/.test(workflow), false)
  const uses = [...workflow.matchAll(/uses:\s+[^\s@]+@([^\s]+)/g)].map(match => match[1])
  assert.equal(uses.length, 3)
  for (const revision of uses) assert.match(revision, /^[a-f0-9]{40}$/)
})
