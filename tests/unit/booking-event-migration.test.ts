// STATIC source contracts only. These do not parse or execute PostgreSQL.
// Executed coverage: tests/sql/booking-event.sql (manual, throwaway local cluster).
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { BOOKING_FEE_CURRENCIES, MAX_BOOKING_FEE_MINOR } from "@/lib/booking-fee"
import { EVENT_STATUSES } from "@/lib/booking-event"
const read = (path: string) => readFileSync(path, "utf8")
const migration = read("migrations/008_booking_event.sql")
const [preflight, postflight, verify, rollback] = ["preflight", "postflight", "verify", "rollback"]
  .map(name => read(`ops/supabase/booking-event/${name}.sql`))
const list = (values: readonly string[]) => values.map(value => `'${value}'`).join(", ")
const code = (sql: string) => sql.replace(/--.*$/gm, "")

it("STATIC: 008 and its rollback need an explicit development or staging target, never production", () => {
  for (const sql of [migration, rollback]) {
    expect(sql).toContain("current_setting('backbeat.booking_event_target', true)")
    expect(sql).toContain("IF target = 'development' THEN\n    expected_id := 'backbeat-dev'; expected_environment := 'development';")
    expect(sql).toContain("ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN\n    expected_id := 'backbeat-staging'; expected_environment := 'staging';")
    for (const refusal of ["TARGET_NOT_EXPLICIT", "SYNTHETIC_MARKER_MISSING", "MARKER_DOES_NOT_MATCH_TARGET"]) {
      expect(sql).toContain(`BOOKING_EVENT_${refusal}`)
    }
    expect(sql).toContain("(SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1")
    expect(sql).toContain("WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE")
    expect(sql).toContain("SET LOCAL lock_timeout")
    expect(sql.startsWith("--")).toBe(true)
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true)
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1)
  }
  for (const sql of [migration, preflight, postflight, verify, rollback]) {
    // Production (migration 004's ref) and the unrelated projects on the local CLI login.
    for (const forbidden of ["jttrznlbbjyufzyqmzzs", "ngwkmrfmivvgwtnpadmj", "xcastozqncxdauelquep"]) expect(sql).not.toContain(forbidden)
  }
})

it("STATIC: 008 is additive and re-runnable: no backfill, no row rewrite, no policy, grant or function", () => {
  const sql = code(migration)
  expect(sql).not.toMatch(/\bUPDATE public\.|\bDELETE FROM\b|\bINSERT INTO\b|\bTRUNCATE\b|\bDROP (?:TABLE|COLUMN|POLICY|INDEX)\b/)
  expect(sql).not.toMatch(/\bCREATE (?:OR REPLACE )?(?:POLICY|FUNCTION|TRIGGER|TABLE)\b|\bGRANT\b|\bREVOKE\b|\bSECURITY DEFINER\b|ROW LEVEL SECURITY/)
  expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(5)
  expect(sql.match(/ADD COLUMN(?! IF NOT EXISTS)/g)).toBeNull()
  expect(sql).toContain("CREATE INDEX IF NOT EXISTS bookings_workspace_promoter_idx")
  for (const column of ["booking_id uuid", "start_time time", "fee_amount_minor bigint", "fee_currency text", "promoter_id uuid"]) {
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`)
    expect(sql).not.toContain(`${column} NOT NULL`)
  }
  expect(sql).not.toMatch(/\bDEFAULT\b/)
  expect(migration).toContain("Requires 005")
  expect(sql).toContain("BOOKING_EVENT_REQUIRES_005")
  expect(sql).toContain("BOOKING_EVENT_RLS_REQUIRED")
})

it("STATIC: one event per booking, same-workspace links, and deletes that null only the link column", () => {
  const sql = code(migration).replace(/\s+/g, " ")
  expect(sql).toContain("ADD CONSTRAINT events_workspace_id_id_key UNIQUE (workspace_id, id)")
  expect(sql).toContain("ADD CONSTRAINT events_booking_id_key UNIQUE (booking_id)")
  expect(sql).toContain("ADD CONSTRAINT events_booking_id_fkey FOREIGN KEY (workspace_id, booking_id) REFERENCES public.bookings (workspace_id, id) ON DELETE SET NULL (booking_id)")
  expect(sql).toContain("ADD CONSTRAINT bookings_promoter_id_fkey FOREIGN KEY (workspace_id, promoter_id) REFERENCES public.promoters (workspace_id, id) ON DELETE SET NULL (promoter_id)")
  // A bare SET NULL on a composite key would also null workspace_id (NOT NULL): never used.
  expect(sql).not.toMatch(/ON DELETE SET NULL(?! \()/)
  expect(sql).not.toMatch(/ON DELETE CASCADE/)
})

it("STATIC: 008 mirrors the application value sets and refuses rows that violate the status CHECK", () => {
  expect(migration).toContain(`ADD CONSTRAINT events_status_check CHECK (status IN (${list(EVENT_STATUSES)}));`)
  expect(migration).toContain(`WHERE status IS NULL OR status NOT IN (${list(EVENT_STATUSES)})`)
  expect(migration).toContain("RAISE EXCEPTION 'BOOKING_EVENT_UNEXPECTED_EVENT_STATUS_ROWS'")
  expect(migration.indexOf("BOOKING_EVENT_UNEXPECTED_EVENT_STATUS_ROWS")).toBeLessThan(migration.indexOf("ADD CONSTRAINT events_status_check"))
  expect(migration).toContain(`CHECK (fee_amount_minor BETWEEN 0 AND ${MAX_BOOKING_FEE_MINOR})`)
  expect(migration).toContain(`CHECK (fee_currency IN (${list(BOOKING_FEE_CURRENCIES)}))`)
  expect(migration).toContain("CHECK ((fee_amount_minor IS NULL) = (fee_currency IS NULL))")
  // The preflight lists the violating rows by id and status, without their content.
  expect(preflight).toContain(`e.status NOT IN (${list(EVENT_STATUSES)})`)
  expect(preflight).toContain("'status_violation'")
  expect(code(preflight)).not.toMatch(/e\.title|e\.location|public_token/)
})

it("STATIC: preflight and postflight are single read-only statements; verify ends with one summarizing SELECT", () => {
  for (const sql of [preflight, postflight]) {
    const body = code(sql).trim()
    expect(body).toMatch(/^(SELECT|WITH)\b/)
    expect(body.match(/;/g)).toHaveLength(1)
    expect(body.endsWith(";")).toBe(true)
    expect(body).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|SET LOCAL|set_config)\b/)
  }
  // verify: one DO block whose writes are always rolled back, then the report SELECT.
  expect(verify.match(/RAISE EXCEPTION 'BB_VERIFY_ROLLBACK'/g)).toHaveLength(2)
  expect(code(verify).trimEnd()).toMatch(/\$verify\$;\s*WITH lines AS[\s\S]*ORDER BY ord;$/)
  expect(verify).toContain("SET LOCAL ROLE authenticated")
  expect(verify).toContain("SET LOCAL ROLE anon")
  expect(verify).not.toMatch(/\bCOMMIT\b/)
})

it("STATIC: the rollback backs up before dropping and never deletes events or bookings", () => {
  const sql = code(rollback)
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.booking_event_rollback_backup")
  expect(sql).toContain("ALTER TABLE public.booking_event_rollback_backup ENABLE ROW LEVEL SECURITY")
  expect(sql).toContain("REVOKE ALL ON TABLE public.booking_event_rollback_backup FROM PUBLIC, anon, authenticated")
  expect(sql.indexOf("INSERT INTO public.booking_event_rollback_backup")).toBeLessThan(sql.indexOf("DROP COLUMN IF EXISTS booking_id"))
  expect(sql).not.toMatch(/\bDELETE FROM\b|\bTRUNCATE\b|DROP TABLE|events_workspace_id_id_key/)
})
