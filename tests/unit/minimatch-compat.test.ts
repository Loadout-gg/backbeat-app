import { createRequire } from "node:module"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const projectRequire = createRequire(resolve(process.cwd(), "package.json"))
const nextRequire = createRequire(projectRequire.resolve("eslint-config-next"))
const legacyConsumers = ["eslint", "eslint-plugin-import", "eslint-plugin-react", "eslint-plugin-jsx-a11y"]

describe.each(legacyConsumers)("patched minimatch compatibility for %s", (consumer) => {
  const consumerRequire = createRequire(nextRequire.resolve(consumer))
  const minimatch = consumerRequire("minimatch")

  it("resolves the patched release instead of a vulnerable legacy copy", () => {
    expect(consumerRequire("minimatch/package.json").version).toBe("11.0.4")
  })

  it("retains the legacy callable CommonJS API and modern named exports", () => {
    expect(typeof minimatch).toBe("function")
    expect(minimatch.minimatch).toBe(minimatch)
    expect(minimatch("src/button.tsx", "**/*.{ts,tsx}")).toBe(true)
    expect(minimatch("src/button.css", "**/*.{ts,tsx}")).toBe(false)
    expect(minimatch(".hidden.ts", "*.ts")).toBe(false)
    expect(minimatch(".hidden.ts", "*.ts", { dot: true })).toBe(true)
    expect(new minimatch.Minimatch("**/*.tsx").match("app/page.tsx")).toBe(true)
    expect(minimatch.match(["a.ts", "b.css"], "*.ts")).toEqual(["a.ts"])
    expect(minimatch.filter("*.ts")("a.ts")).toBe(true)
    expect(minimatch.defaults({ nocase: true })("A.TS", "*.ts")).toBe(true)
  })
})

it("preserves the named API used by the TypeScript parser", () => {
  const tsRequire = createRequire(nextRequire.resolve("typescript-eslint"))
  const parserRequire = createRequire(tsRequire.resolve("@typescript-eslint/parser"))
  const estreeRequire = createRequire(parserRequire.resolve("@typescript-eslint/typescript-estree"))
  const { minimatch, Minimatch } = estreeRequire("minimatch")
  expect(estreeRequire("minimatch/package.json").version).toBe("11.0.4")
  expect(minimatch("src/file.ts", "**/*.ts")).toBe(true)
  expect(new Minimatch("**/*.ts").match("src/file.js")).toBe(false)
})
