const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('CI runs every deterministic gate without deployment privileges', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  for (const text of [
    'pull_request:', 'workflow_dispatch:', 'contents: read',
    'name: Quality', "node-version: '26.12.1'", "version: '12.3.4'",
    'pnpm install --frozen-lockfile --ignore-scripts',
    'pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm test:runtime', 'pnpm build',
  ]) assert.ok(workflow.includes(text), `Missing CI contract: ${text}`)
  assert.equal(/pull_request_target|continue-on-error|secrets\.|vercel deploy|supabase db push/.test(workflow), false)
  const uses = [...workflow.matchAll(/uses:\s+[^\s@]+@([^\s]+)/g)].map(match => match[1])
  assert.equal(uses.length, 3)
  for (const revision of uses) assert.match(revision, /^[a-f0-9]{40}$/)
})

test('CI evaluates production and full dependency security without blanket ignores', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  assert.match(workflow, /^        run: pnpm audit --prod --audit-level=low$/m)
  assert.match(workflow, /^        run: pnpm audit --audit-level=low$/m)
  assert.doesNotMatch(workflow, /--ignore-unfixable|--ignore-registry-errors|audit --fix/)
})

test('CI qualifies the local container without a backend or Docker privilege escalation', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  assert.ok(workflow.includes('docker build -f ops/local/Dockerfile --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-build-placeholder-not-a-secret'))
  assert.ok(workflow.includes('docker run --rm --network none --entrypoint node'))
  assert.ok(workflow.includes('--test tests/runtime/*.test.cjs tests/smoke/next-start.test.cjs'))
  assert.ok(workflow.includes('- run: node --test tests/smoke/next-start.test.cjs'))
  assert.doesNotMatch(workflow, /--privileged|--network[ =]host/)
})
