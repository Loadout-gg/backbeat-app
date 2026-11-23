import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { tableReads, tableReadsFromSource, type TableRead } from "./select-projection-scanner"

// Static guard: no events read under lib/, app/ or components/ may select every
// column (`*` or a bare select()) or name public_token. List rows reach the browser,
// so they carry only the rendered fields (Alberto, PR #35, 2026-11-23).
type EventsRead = TableRead
const eventsReads = () => tableReads("events")
const eventsReadsFromSource = (snippet: string) => tableReadsFromSource("events", snippet)

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
