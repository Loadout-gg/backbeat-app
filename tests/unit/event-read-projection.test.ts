// STATIC source contract (BACKLOG R17): no read of the events table may select every
// column. events.public_token must never leave the server, and a later column must not
// reach a client component just because it was added to the table.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return sources(path)
  return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
})
/** Every query chain that starts at .from("events"), up to the next chain or 1500 characters. */
function eventQueries(source: string): string[] {
  const chains: string[] = []
  for (const match of source.matchAll(/\.from\(\s*["'`]events["'`]\s*\)/g)) {
    const rest = source.slice(match.index + match[0].length, match.index + 1500)
    const next = rest.search(/\.from\(/)
    chains.push(next === -1 ? rest : rest.slice(0, next))
  }
  return chains
}
/** The first argument of each .select(...) in a chain: a literal, or the constant it names. */
function selections(chain: string, source: string): string[] {
  return [...chain.matchAll(/\.select\(\s*(?:(["'`])([\s\S]*?)\1|([A-Z][A-Z0-9_]*))/g)].map(match => {
    if (match[2] !== undefined) return match[2]
    const constant = source.match(new RegExp(`const ${match[3]}\\s*=\\s*(["'\`])([\\s\\S]*?)\\1`))
    return constant ? constant[2] : `UNRESOLVED:${match[3]}`
  })
}
const wildcard = (selection: string) => selection.split(/[\s,()]+/).includes("*") || /^\s*$/.test(selection)

const files = ["lib", "app", "components"].flatMap(sources)
const reads = files.flatMap(file => {
  const source = readFileSync(file, "utf8")
  return eventQueries(source).flatMap(chain => selections(chain, source).map(selection => ({ file, selection })))
})

it("STATIC: the detector sees wildcards, including one hidden behind a constant or an embed", () => {
  const sample = `
    const FIELDS = "id, *"
    supabase.from("events").select("*").eq("id", id)
    supabase.from("events").select(\`
      *,
      artists:artist_id (id)\`, { count: "exact" })
    supabase.from("events").select(FIELDS)
    supabase.from("events").select()
    supabase.from("events").select("id,title, artists:artist_id (id, name)")
    supabase.from("bookings").select("*")`
  const found = eventQueries(sample).flatMap(chain => selections(chain, sample))
  expect(found).toHaveLength(4)
  expect(found.map(wildcard)).toEqual([true, true, true, false])
  // A bare .select() selects every column: it must not slip through as "no selection".
  expect(eventQueries(sample).filter(chain => /\.select\(\s*\)/.test(chain))).toHaveLength(1)
})

it("STATIC: every read of the events table names its columns and never names public_token", () => {
  // Both list reads, the detail read, the linked-event read and the write witnesses.
  expect(reads.length).toBeGreaterThanOrEqual(7)
  expect(reads.filter(read => read.file.endsWith(join("lib", "actions", "events.ts"))).length).toBeGreaterThanOrEqual(5)
  for (const read of reads) {
    expect(read.selection, read.file).not.toMatch(/^UNRESOLVED:/)
    expect(wildcard(read.selection), `${read.file}: select("${read.selection.trim()}")`).toBe(false)
    expect(read.selection, read.file).not.toContain("public_token")
  }
  for (const file of files) {
    const source = readFileSync(file, "utf8")
    for (const chain of eventQueries(source)) expect(chain, file).not.toMatch(/\.select\(\s*\)/)
  }
})

it("STATIC: no application source reads or writes public_token", () => {
  for (const file of files) {
    const code = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    expect(code, file).not.toContain("public_token")
  }
})
