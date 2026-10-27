const test = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

// Exercise the actual PostCSS consumer's loader, not an unrelated hoisted copy.
test('Tailwind loader avoids deprecated Node module registration', { timeout: 15000 }, () => {
  const postcssRequire = createRequire(require.resolve('@tailwindcss/postcss'))
  const loader = postcssRequire.resolve('@tailwindcss/node')
  const probe = `
    const warnings = [];
    process.on('warning', warning => warnings.push(warning.code || warning.name));
    require(process.argv[1]);
    setImmediate(() => process.stdout.write(JSON.stringify({ node: process.version, warnings })));
  `
  const result = spawnSync(process.execPath, [
    '--trace-deprecation', '--input-type=commonjs', '-e', probe, loader,
  ], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.signal, null)
  const observed = JSON.parse(result.stdout)
  assert.equal(observed.node, process.version)
  assert.ok(!observed.warnings.includes('DEP0205'), result.stderr)
  assert.doesNotMatch(result.stderr, /\[DEP0205\]/)
})
