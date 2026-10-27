const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('reproducible Node 26 baselines pin the qualified security patch', () => {
  assert.equal(read('.node-version').trim(), '26.12.1')
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26.12.1 <27')
  assert.match(read('ops/local/Dockerfile'), /^FROM node:26\.12\.1-bookworm-slim$/m)
  assert.match(read('.github/workflows/ci.yml'), /node-version: '26\.12\.1'/)
})

test('the executing runtime is the exact locally qualified Node version', () => {
  assert.equal(process.versions.node, read('.node-version').trim())
})
