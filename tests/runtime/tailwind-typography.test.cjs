const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const postcss = require('postcss')

// Keep the pre-upgrade typography contract independent of Tailwind's defaults.
test('Tailwind upgrade preserves the existing application sans font stack', async () => {
  const consumerRequire = createRequire(require.resolve('@tailwindcss/postcss'))
  const { compile } = consumerRequire('@tailwindcss/node')
  const stylesheet = path.resolve(__dirname, '../../app/globals.css')
  const compiler = await compile(fs.readFileSync(stylesheet, 'utf8'), {
    base: path.dirname(stylesheet),
    onDependency() {},
  })
  const root = postcss.parse(compiler.build(['font-sans']))
  const stacks = []
  root.walkDecls('--font-sans', declaration => stacks.push(declaration.value))
  assert.ok(stacks.length > 0, 'The compiled stylesheet must define the sans font stack')
  assert.deepEqual(stacks.at(-1).split(/\s*,\s*/), [
    'ui-sans-serif', 'system-ui', 'sans-serif', '"Apple Color Emoji"',
    '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"',
  ])
  let usesThemeFont = false
  root.walkRules('.font-sans', rule => {
    rule.walkDecls('font-family', declaration => {
      if (declaration.value === 'var(--font-sans)') usesThemeFont = true
    })
  })
  assert.ok(usesThemeFont, 'The body font-sans utility must keep using the theme variable')
})

// The serif token stays valid without loading a web font (V2, #18).
test('The serif theme token resolves to a system serif stack', async () => {
  const consumerRequire = createRequire(require.resolve('@tailwindcss/postcss'))
  const { compile } = consumerRequire('@tailwindcss/node')
  const stylesheet = path.resolve(__dirname, '../../app/globals.css')
  const compiler = await compile(fs.readFileSync(stylesheet, 'utf8'), {
    base: path.dirname(stylesheet),
    onDependency() {},
  })
  const root = postcss.parse(compiler.build(['font-serif']))
  const stacks = []
  root.walkRules('.font-serif', rule => {
    rule.walkDecls('font-family', declaration => stacks.push(declaration.value))
  })
  assert.ok(stacks.length > 0, 'The font-serif utility must resolve the serif theme token')
  assert.deepEqual(stacks.at(-1).split(/\s*,\s*/), [
    'ui-serif', 'Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif',
  ])
})
