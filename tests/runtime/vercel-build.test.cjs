const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '../..')

test('Vercel uses the pinned pnpm version and frozen lockfile, not dashboard install defaults', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const config = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'))
  const runner = `npm exec --yes --package=${pkg.packageManager} -- pnpm`
  assert.equal(config.installCommand, `node --version && ${runner} install --frozen-lockfile --ignore-scripts --config.engine-strict=true`)
  assert.equal(config.buildCommand, `${runner} run build`)
})
