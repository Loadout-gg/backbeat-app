const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Package-floor regression for GHSA-mfr8-8qww-v76h, not an exploit test.
test('Next and its lint configuration resolve to the qualified security patch', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))
  for (const name of ['next', 'eslint-config-next']) {
    const declared = pkg.dependencies[name] ?? pkg.devDependencies[name]
    assert.equal(declared, '16.4.5')
    // Read the direct installed package even when its exports hide package.json.
    const metadata = path.resolve(__dirname, '../../node_modules', name, 'package.json')
    const installed = JSON.parse(fs.readFileSync(metadata, 'utf8'))
    assert.equal(installed.version, '16.4.5')
  }
})
