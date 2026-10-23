const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('all reproducible Node 22 baselines include the October security release', () => {
  assert.equal(read('.node-version').trim(), '22.23.4')
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=22.23.4 <23')
  assert.match(read('ops/local/Dockerfile'), /^FROM node:22\.23\.4-bookworm-slim$/m)
  assert.match(read('.github/workflows/ci.yml'), /node-version: '22\.23\.4'/)
})
