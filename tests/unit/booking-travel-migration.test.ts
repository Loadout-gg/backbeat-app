// STATIC source contracts only. These do not parse or execute PostgreSQL.
// Executed coverage: tests/sql/booking-travel.sql (manual, throwaway local cluster).
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"
const read = (path: string) => readFileSync(path, "utf8")
const migration = read("migrations/009_booking_travel_stays.sql")
const ops = Object.fromEntries(["preflight", "postflight", "verify", "rollback", "restore"]
  .map(name => [name, read(`ops/supabase/booking-travel/${name}.sql`)]))
const writes = [migration, ops.rollback, ops.restore]
// Statements outside function bodies: what the migration itself does when it is applied.
const topLevel = migration.replace(/\nAS \$\$[\s\S]*?\n\$\$;/g, "\n;").replace(/DO \$(\w+)\$[\s\S]*?\$\1\$;/g, ";")

it("STATIC: every write file needs an explicit development or staging target, never production", () => {
  for (const sql of writes) {
    expect(sql).toContain("current_setting('backbeat.booking_travel_target', true)")
    expect(sql).toContain("IF target = 'development' THEN\n    expected_id := 'backbeat-dev'; expected_environment := 'development';")
    expect(sql).toContain("ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN\n    expected_id := 'backbeat-staging'; expected_environment := 'staging';")
    for (const code of ["BOOKING_TRAVEL_TARGET_NOT_EXPLICIT", "BOOKING_TRAVEL_SYNTHETIC_MARKER_MISSING", "BOOKING_TRAVEL_MARKER_DOES_NOT_MATCH_TARGET"]) expect(sql).toContain(code)
    expect(sql).toContain("(SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1")
    expect(sql).toContain("SET LOCAL lock_timeout")
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true)
  }
  for (const sql of [migration, ...Object.values(ops)]) {
    for (const forbidden of ["jttrznlbbjyufzyqmzzs", "ngwkmrfmivvgwtnpadmj", "xcastozqncxdauelquep"]) expect(sql).not.toContain(forbidden)
  }
})

it("STATIC: 009 is additive and leaves existing tables' access unchanged", () => {
  expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
  // No backfill: the migration itself writes no row (functions it defines do, when called).
  expect(topLevel).not.toMatch(/\b(UPDATE|DELETE\s+FROM)\s+public\./i)
  expect(topLevel).not.toMatch(/\bINSERT\s+INTO\b/i)
  expect(migration).toContain("ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS transport_to_city text;")
  expect(migration).toContain("CHECK (transport_to_city IS NULL OR transport_to_city IN ('promoter', 'artist', 'not_needed'))")
  expect(migration).not.toMatch(/ON public\.(bookings|artists)\b.*(POLICY|GRANT)/i)
  expect(migration).toContain("ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS date_of_birth date;")
  for (const table of ["booking_travel_legs", "booking_stays", "artist_travel_documents",
    "artist_travel_document_files", "artist_travel_document_audit", "artist_travel_document_relationships"]) {
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`)
    expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
  }
  expect(migration).toContain("REFERENCES public.bookings(workspace_id, id) ON DELETE CASCADE")
  // Date-line rule: one day earlier only when both zone labels are set and differ.
  expect(migration).toContain("AND arrive_date >= depart_date - 1)")
  expect(migration).toContain("REFERENCES public.artists(workspace_id, id) ON DELETE CASCADE")
  expect(migration.match(/FOR ALL TO authenticated\n  USING \(public\.backbeat_is_active_member\(workspace_id\)\)\n  WITH CHECK \(public\.backbeat_is_active_member\(workspace_id\)\);/g)).toHaveLength(2)
  expect(migration).toContain("FROM PUBLIC, anon, authenticated;")
  // UPDATE grants are column-scoped and never include the parent or workspace key.
  for (const grant of migration.match(/GRANT UPDATE \(([^)]*)\)/g) ?? []) {
    for (const key of ["workspace_id", "booking_id", "artist_id", " id,", "created_at"]) expect(grant).not.toContain(key)
  }
  expect(migration).not.toMatch(/GRANT[^;]*\banon\b/)
})

it("STATIC: preflight and postflight are single read-only SELECTs; verify reports through a final SELECT", () => {
  for (const sql of [ops.preflight, ops.postflight]) {
    // Keywords inside string literals (privilege names, report labels) and comments are data.
    const code = sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''")
    expect(code).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|BEGIN|COMMIT)\b/)
    expect(sql.match(/;\s*$/gm)).toHaveLength(1)
  }
  expect(ops.verify).toContain("RAISE EXCEPTION 'BB_VERIFY_ROLLBACK'")
  expect(ops.verify.trimEnd().split("\n").slice(-4).join("\n")).toMatch(/^SELECT /)
  // The verify report never carries provider messages (they can echo stored values).
  expect(ops.verify).not.toContain("SQLERRM ||")
})

it("STATIC: rollback parks data instead of dropping it; restore needs 009 first", () => {
  expect(ops.rollback).not.toMatch(/DROP TABLE/)
  expect(ops.rollback).toContain("_rollback_backup")
  expect(ops.rollback).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated")
  expect(ops.restore).toContain("BOOKING_TRAVEL_RESTORE_REQUIRES_009")
})

// Privacy (decision 4): the sensitive columns and tables are read only by the two dedicated
// action modules and written by the migration/ops files.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}
it("STATIC: date_of_birth and travel documents are read only by the dedicated modules", () => {
  const allowed: Record<string, string[]> = {
    date_of_birth: ["lib/actions/artist-travel-documents.ts"],
    artist_travel_documents: ["lib/actions/artist-travel-documents.ts"],
    booking_travel_legs: ["lib/actions/booking-travel.ts"],
    booking_stays: ["lib/actions/booking-travel.ts"],
    artist_travel_document_files: ["lib/actions/artist-travel-documents.ts"],
    artist_travel_document_audit: ["lib/actions/artist-travel-documents.ts"],
    artist_travel_document_relationships: ["lib/actions/artist-travel-documents.ts"],
    transport_to_city: ["lib/actions/booking-travel.ts"],
    // Lifecycle functions: member entry points from the actions module, trusted ones from the scan service.
    backbeat_travel_document_: ["lib/actions/artist-travel-documents.ts", "lib/travel-documents/scan-service.ts"],
  }
  for (const path of [...files("lib"), ...files("app"), ...files("components")]) {
    // Comments may name the column (to forbid it); only code counts.
    const source = read(path).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")
    for (const [token, owners] of Object.entries(allowed)) {
      if (source.includes(token)) expect(owners, `${token} in ${path}`).toContain(path)
    }
  }
})
it("STATIC: no artist read selects every column", () => {
  for (const path of files("lib/actions")) {
    const source = read(path)
    expect(source, path).not.toMatch(/from\("artists"\)\s*\.select\("\*"/)
  }
  expect(read("lib/actions/artists.ts")).not.toMatch(/ARTIST_COLUMNS = "[^"]*date_of_birth/)
})
