import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

// Shared static scanner for the read-projection guards (events R17, bookings F19).
// It finds Supabase reads of one table under lib/, app/ and components/ and resolves
// their select argument to the literal column list(s) it can send.
export const ROOT = join(__dirname, "..", "..")
const SCANNED = ["lib", "app", "components"]

export type TableRead = { file: string; fn: string | null; columns: string }

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path)
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ? [path] : []
  })
}

/**
 * Resolves a select argument to every column list it can take: a string literal, a
 * same-file const literal (with ${CONST} parts) or alias of NAME[key], or NAME[key] over a same-file const
 * object literal whose values are all string literals (every value is returned).
 */
export function resolveColumns(source: string, argument: string, depth = 0): string[] {
  if (depth > 5) throw new Error(`Unresolvable select argument: ${argument}`)
  const trimmed = argument.trim()
  const literal = /^(["'`])([\s\S]*)\1$/.exec(trimmed)
  if (literal) {
    return [literal[2].replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name: string) =>
      resolveColumns(source, name, depth + 1).join(","))]
  }
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    const declaration = new RegExp(`const\\s+${trimmed}\\s*(?::[^=]+)?=\\s*(["'\`][\\s\\S]*?["'\`]|[A-Za-z_$][\\w$]*\\[[^\\]\\n]+\\])\\s*(?:\\n|;)`).exec(source)
    if (!declaration) throw new Error(`Select argument ${trimmed} is not a same-file string constant`)
    return resolveColumns(source, declaration[1], depth + 1)
  }
  const indexed = /^([A-Za-z_$][\w$]*)\[[^\]]+\]$/.exec(trimmed)
  if (indexed) {
    const body = new RegExp(`const\\s+${indexed[1]}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*(?:as\\s+const\\s*)?;`).exec(source)
    if (!body) throw new Error(`Select argument ${trimmed} is not a same-file object constant`)
    const entries = body[1].split(/,\s*\n/).map(entry => entry.trim()).filter(Boolean)
    return entries.flatMap(entry => {
      const value = /^[\w$"']+\s*:\s*(["'`][\s\S]*["'`])\s*,?$/.exec(entry)
      if (!value) throw new Error(`Unsupported entry in ${indexed[1]}: ${entry}`)
      return resolveColumns(source, value[1], depth + 1)
    })
  }
  throw new Error(`Unsupported select argument: ${trimmed}`)
}

/** Returns the first argument of the call whose "(" is at index open, or "" for an empty call. */
function firstArgument(text: string, open: number): string {
  let depth = 0
  let quote: string | null = null
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === "\\") index += 1
      else if (char === quote) quote = null
    } else if (char === "\"" || char === "'" || char === "`") quote = char
    else if (char === "(" || char === "{" || char === "[") depth += 1
    else if (depth > 0 && (char === ")" || char === "}" || char === "]")) depth -= 1
    else if (depth === 0 && (char === ")" || char === ",")) return text.slice(open + 1, index)
  }
  throw new Error("Unterminated select call")
}

function enclosingFunction(source: string, index: number): string | null {
  const names = [...source.slice(0, index).matchAll(/function\s+([A-Za-z_$][\w$]*)/g)]
  return names.length ? names[names.length - 1][1] : null
}

/** Every read of `table`: direct .from(table) selects and table(...) embeds in any select. */
export function tableReads(table: string, files = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))): TableRead[] {
  const reads: TableRead[] = []
  for (const path of files) {
    const source = readFileSync(path, "utf8")
    const file = relative(ROOT, path)
    for (const match of source.matchAll(new RegExp(`\\.from\\(\\s*(["'\`])${table}\\1\\s*\\)`, "g"))) {
      const start = match.index + match[0].length
      const next = source.indexOf(".from(", start)
      const chain = source.slice(start, next === -1 ? undefined : next)
      const select = /\.select\(/.exec(chain)
      if (!select) continue
      const argument = firstArgument(chain, select.index + ".select".length)
      const fn = enclosingFunction(source, match.index)
      if (argument.trim() === "") reads.push({ file, fn, columns: "" })
      else for (const columns of resolveColumns(source, argument)) reads.push({ file, fn, columns: columns.replace(/\s/g, "") })
    }
    // Table embedded in any table's read, e.g. bookings(*) or alias:bookings(...).
    for (const match of source.matchAll(/\.select\(/g)) {
      const argument = firstArgument(source, match.index + ".select".length)
      let resolved: string[]
      try {
        resolved = argument.trim() === "" ? [] : resolveColumns(source, argument)
      } catch {
        continue // Non-literal selects of other tables are not reads of this table.
      }
      for (const columns of resolved.map(value => value.replace(/\s/g, ""))) {
        for (const embed of columns.matchAll(new RegExp(`(?:^|[,(:])${table}(?:!\\w+)?\\(([^)]*)\\)`, "g"))) {
          reads.push({ file, fn: enclosingFunction(source, match.index), columns: embed[1] })
        }
      }
    }
  }
  return reads
}

/** Runs the scanner on an in-memory source through a temporary file. */
export function tableReadsFromSource(table: string, snippet: string): TableRead[] {
  const dir = mkdtempSync(join(tmpdir(), `${table}-projection-`))
  try {
    const path = join(dir, "snippet.ts")
    writeFileSync(path, snippet)
    return tableReads(table, [path])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
