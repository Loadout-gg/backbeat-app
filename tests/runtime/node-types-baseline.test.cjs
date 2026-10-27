const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('Node declarations are pinned and resolve to the qualified version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))
  assert.equal(pkg.devDependencies['@types/node'], '26.6.5')
  const installed = JSON.parse(fs.readFileSync(require.resolve('@types/node/package.json'), 'utf8'))
  assert.equal(installed.version, '26.6.5')
})
