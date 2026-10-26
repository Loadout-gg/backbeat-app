const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const projectRequire = createRequire(path.resolve(__dirname, '../../package.json'))
const nextRequire = createRequire(projectRequire.resolve('eslint-config-next'))
const hooksRequire = createRequire(nextRequire.resolve('eslint-plugin-react-hooks'))
const validationRequire = createRequire(hooksRequire.resolve('zod-validation-error'))

function packageMetadata(consumer, name) {
  let directory = path.dirname(fs.realpathSync(consumer.resolve(name)))
  while (true) {
    const candidate = path.join(directory, 'package.json')
    if (fs.existsSync(candidate)) {
      const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (metadata.name === name) return metadata
    }
    const parent = path.dirname(directory)
    assert.notEqual(parent, directory, `Missing package metadata: ${name}`)
    directory = parent
  }
}

for (const [label, consumer] of [
  ['application', projectRequire],
  ['React Hooks ESLint plugin', hooksRequire],
  ['Zod validation-error adapter', validationRequire],
]) {
  test(`${label} resolves patched Zod 4, not a legacy implementation`, () => {
    const metadata = packageMetadata(consumer, 'zod')
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(metadata.version)
    assert.ok(match, `Unexpected Zod version: ${metadata.version}`)
    const [major, minor, patch] = match.slice(1).map(Number)
    assert.ok(major === 4 && (minor > 6 || (minor === 6 && patch >= 6)), metadata.version)
    assert.ok(consumer('zod').object({})._zod, 'Root import must execute Zod 4')
  })
}

// Tiny synthetic inputs exercise the upstream early-bound behavior, not an OOM attack.
test('a constrained array is rejected before traversing its elements', () => {
  const { z } = projectRequire('zod')
  let traversed = 0
  const schema = z.array(z.string().superRefine(() => { traversed += 1 })).max(2)
  const result = schema.safeParse(['a', 'b', 'c'])
  assert.equal(result.success, false)
  assert.equal(traversed, 0)
  assert.equal(result.error.issues.length, 1)
  assert.equal(result.error.issues[0].code, 'too_big')
})

test('unconstrained arrays do not acquire an invented collection limit', () => {
  const { z } = projectRequire('zod')
  const result = z.array(z.string()).safeParse([1, 2, 3])
  assert.equal(result.success, false)
  assert.equal(result.error.issues.length, 3)
})

test('the installed form resolver returns structured validation errors', async () => {
  const { z } = projectRequire('zod')
  const { zodResolver } = projectRequire('@hookform/resolvers/zod')
  const resolver = zodResolver(z.object({ amount: z.number().min(0, 'Nonnegative amount required') }))
  const options = { fields: {}, shouldUseNativeValidation: false, criteriaMode: 'all' }
  const invalid = await resolver({ amount: -1 }, undefined, options)
  assert.deepEqual(invalid.values, {})
  assert.equal(invalid.errors.amount.message, 'Nonnegative amount required')
  const valid = await resolver({ amount: 0 }, undefined, options)
  assert.deepEqual(valid, { values: { amount: 0 }, errors: {} })
})
