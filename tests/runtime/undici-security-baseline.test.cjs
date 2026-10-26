const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')

// Resolve the dependency actually used by each test-environment consumer.
// This is a package-floor regression, not an exploit or hosted-runtime test.
for (const consumer of ['project', 'vitest']) {
  test(`${consumer} jsdom uses the patched Undici 8 security baseline`, () => {
    const resolveFrom = consumer === 'project'
      ? require
      : createRequire(require.resolve('vitest/package.json'))
    const jsdomRequire = createRequire(resolveFrom.resolve('jsdom/package.json'))
    const metadataPath = jsdomRequire.resolve('undici/package.json')
    const { version } = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    assert.match(version, /^\d+\.\d+\.\d+$/)
    const [major, minor, patch] = version.split('.').map(Number)
    assert.equal(major, 8, 'A major migration needs a separate compatibility decision')
    assert.ok(minor > 12 || (minor === 12 && patch >= 2), `Undici ${version} is below 8.12.2`)
  })
}
