const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// WCAG 2.x contrast for the theme tokens in app/globals.css (OKLCH -> linear sRGB).
const css = fs.readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8')

function block(selector) {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `missing ${selector} block`)
  return css.slice(start, css.indexOf('}', start))
}

function token(selector, name, seen = new Set()) {
  assert.ok(!seen.has(name), `circular --${name} in ${selector}`)
  seen.add(name)
  const match = block(selector).match(new RegExp(`--${name}:\\s*([^;]+);`))
  assert.ok(match, `missing --${name} in ${selector}`)
  const alias = match[1].trim().match(/^var\(--([a-z-]+)\)$/)
  if (alias) return token(selector, alias[1], seen)
  const color = match[1].trim().match(/^oklch\(([^)]+)\)$/)
  assert.ok(color, `--${name} in ${selector} is not an oklch() colour`)
  const [l, c, h] = color[1].trim().split(/\s+/).map(Number)
  return { l, c, h }
}

function luminance({ l, c, h }) {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = v => Math.min(1, Math.max(0, v))
  const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)
  const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)
  const bl = clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

function contrast(selector, fg, bg) {
  const [hi, lo] = [luminance(token(selector, fg)), luminance(token(selector, bg))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

for (const selector of [':root', '.dark']) {
  test(`${selector} focus ring reaches 3:1 against the page background`, () => {
    const ratio = contrast(selector, 'ring', 'background')
    assert.ok(ratio >= 3, `ring on background is ${ratio.toFixed(2)}:1`)
  })

  test(`${selector} sidebar focus ring follows --ring and reaches 3:1 on the sidebar`, () => {
    assert.match(block(selector), /--sidebar-ring:\s*var\(--ring\);/)
    const ratio = contrast(selector, 'sidebar-ring', 'sidebar')
    assert.ok(ratio >= 3, `sidebar-ring on sidebar is ${ratio.toFixed(2)}:1`)
  })

  test(`${selector} muted text reaches 4.5:1 on a solid muted surface`, () => {
    const ratio = contrast(selector, 'muted-foreground', 'muted')
    assert.ok(ratio >= 4.5, `muted-foreground on muted is ${ratio.toFixed(2)}:1`)
  })
}

// The ratios above hold only when the ring renders at full opacity.
test('no focus ring utility lowers the ring token below full opacity', () => {
  const root = path.resolve(__dirname, '../..')
  const offenders = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) {
        const pattern = /\b(?:ring|outline)-ring\/(\[[^\]]+\]|[\w.]+)/g
        for (const match of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
          const raw = match[1].replace(/^\[|\]$/g, '')
          const value = raw.endsWith('%') ? parseFloat(raw) : raw.includes('.') ? parseFloat(raw) * 100 : parseFloat(raw)
          if (!(value >= 100)) offenders.push(`${path.relative(root, file)}: ${match[0]}`)
        }
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(root, dir))
  assert.deepEqual(offenders, [])
})
