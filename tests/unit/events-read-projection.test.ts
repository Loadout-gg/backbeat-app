import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

// Static guard: no events read under lib/, app/ or components/ may select every
// column (`*` or a bare select()) or name public_token. List rows reach the browser,
// so they carry only the rendered fields (Alberto, PR #35, 2026-11-23).
const ROOT = join(__dirname, "..", "..")
const SCANNED = ["lib", "app", "components"]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path)
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ? [path] : []
  })
}

/** Resolves a select argument: a string literal, or a same-file const literal with ${CONST} parts. */
function resolveArgument(source: string, argument: string, depth = 0): string {
  if (depth > 5) throw new Error(`Unresolvable select argument: ${argument}`)
  const trimmed = argument.trim()
  const literal = /^(["'`])([\s\S]*)\1$/.exec(trimmed)
  if (literal) {
    return literal[2].replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name: string) =>
      resolveArgument(source, name, depth + 1))
  }
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    const declaration = new RegExp(`const\\s+${trimmed}\\s*=\\s*(["'\`][\\s\\S]*?["'\`])\\s*(?:\\n|;)`).exec(source)
    if (!declaration) throw new Error(`Select argument ${trimmed} is not a same-file string constant`)
    return resolveArgument(source, declaration[1], depth + 1)
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

type EventsRead = { file: string; columns: string }

function eventsReads(files = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))): EventsRead[] {
  const reads: EventsRead[] = []
  for (const path of files) {
    const source = readFileSync(path, "utf8")
    const file = relative(ROOT, path)
    for (const match of source.matchAll(/\.from\(\s*(["'`])events\1\s*\)/g)) {
      const start = match.index + match[0].length
      const next = source.indexOf(".from(", start)
      const chain = source.slice(start, next === -1 ? undefined : next)
      const select = /\.select\(/.exec(chain)
      if (!select) continue
      const argument = firstArgument(chain, select.index + ".select".length)
      const columns = argument.trim() === "" ? "" : resolveArgument(source, argument).replace(/\s/g, "")
      reads.push({ file, columns })
    }
    // Events embedded in any table's read, e.g. events(*) or alias:events(...).
    for (const match of source.matchAll(/\.select\(/g)) {
      const argument = firstArgument(source, match.index + ".select".length)
      let columns: string
      try {
        columns = argument.trim() === "" ? "" : resolveArgument(source, argument).replace(/\s/g, "")
      } catch {
        continue // Non-literal selects of other tables are not events reads.
      }
      for (const embed of columns.matchAll(/(?:^|[,(:])events(?:!\w+)?\(([^)]*)\)/g)) {
        reads.push({ file, columns: embed[1] })
      }
    }
  }
  return reads
}

function projectionViolations(reads: EventsRead[]): string[] {
  return reads.flatMap(({ file, columns }) => {
    if (columns === "") return [`${file}: bare select() reads every events column`]
    if (columns.includes("*")) return [`${file}: select("${columns}") reads every events column`]
    if (/public_token/.test(columns)) return [`${file}: select("${columns}") reads public_token`]
    return []
  })
}

describe("events read projection", () => {
  it("finds the events reads it guards", () => {
    const files = eventsReads().map(read => read.file)
    expect(files.filter(file => file === join("lib", "actions", "events.ts")).length).toBeGreaterThanOrEqual(3)
    expect(files).toContain(join("lib", "actions", "dashboard.ts"))
  })

  it("never selects every column or public_token in an events read", () => {
    expect(projectionViolations(eventsReads())).toEqual([])
  })

  it("keeps list reads to the rendered fields plus the artist and promoter embeds", () => {
    const lists = eventsReads().filter(read => read.columns.includes("artists:artist_id"))
    expect(lists).toHaveLength(2)
    for (const { columns } of lists) {
      expect(columns).toBe(
        "id,title,date,location,status,artist_id,artists:artist_id(id,name,stage_name),promoters:promoter_id(id,name,company_name)",
      )
    }
  })

  it.each([
    [`.from("events").select("*")`, "every events column"],
    [`.from("events").select(\`*, artists:artist_id (id)\`)`, "every events column"],
    [`.from("events").select()`, "bare select()"],
    [`.from('events').select("id,public_token")`, "public_token"],
    [`const COLS = "id,public_token"\nq.from("events").select(COLS, { count: "exact" })`, "public_token"],
    [`q.from("bookings").select("id, event:events(*)")`, "every events column"],
  ])("rejects %s", (snippet, reason) => {
    const reads = eventsReadsFromSource(snippet)
    expect(projectionViolations(reads).join("\n")).toContain(reason)
  })
})

function eventsReadsFromSource(snippet: string): EventsRead[] {
  // Exercise the same scanner on an in-memory source through a temporary file.
  const dir = mkdtempSync(join(tmpdir(), "events-projection-"))
  try {
    const path = join(dir, "snippet.ts")
    writeFileSync(path, snippet)
    return eventsReads([path])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
