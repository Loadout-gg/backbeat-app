// STATIC source contracts only. These do not parse or execute PostgreSQL.
// Executed coverage: tests/sql/booking-payment-history.sql (manual, throwaway local cluster).
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { MAX_PAYMENT_VOID_REASON_LENGTH, PAYMENT_VOID_KINDS } from "@/lib/booking-finance"

const read = (path: string) => readFileSync(path, "utf8")
const migration = read("migrations/010_booking_payment_history.sql")
const rollback = read("ops/supabase/booking-finance/010-rollback.sql")
const code = (sql: string) => sql.replace(/--.*$/gm, "")
const keywords = (sql: string) => code(sql).replace(/'(?:[^']|'')*'/g, "''")

it("STATIC: 010 and its rollback need an explicit development or staging target, never production", () => {
  for (const sql of [migration, rollback]) {
    expect(sql).toContain("current_setting('backbeat.booking_payment_history_target', true)")
    expect(sql).toContain("IF target = 'development' THEN\n    expected_id := 'backbeat-dev'; expected_environment := 'development';")
    expect(sql).toContain("ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN\n    expected_id := 'backbeat-staging'; expected_environment := 'staging';")
    for (const refusal of ["TARGET_NOT_EXPLICIT", "MARKER_MISSING", "MARKER_MISMATCH"]) expect(sql).toContain(`PAYMENT_HISTORY_010_${refusal}`)
    expect(sql).toContain("WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE")
    expect(sql).toContain("SET LOCAL lock_timeout")
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1)
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true)
    for (const forbidden of ["jttrznlbbjyufzyqmzzs", "ngwkmrfmivvgwtnpadmj", "xcastozqncxdauelquep"]) expect(sql).not.toContain(forbidden)
  }
})
it("STATIC: 010 is additive and changes no grant, role, policy or RLS; it refuses a delete-capable shape", () => {
  const sql = keywords(migration)
  expect(sql).not.toMatch(/\bGRANT\b|\bCREATE POLICY\b|\bALTER POLICY\b|\bDROP POLICY\b|ROW LEVEL SECURITY|\bCREATE ROLE\b|\bSECURITY DEFINER\b/)
  expect(sql).not.toMatch(/\bDELETE FROM\b|\bINSERT INTO\b|\bTRUNCATE\b|\bDROP (?:TABLE|COLUMN|CONSTRAINT|TRIGGER|FUNCTION)\b/)
  // The only row write is the trigger that marks the original of a correction.
  expect(sql.match(/\bUPDATE public\./g)).toHaveLength(1)
  expect(sql.match(/ADD COLUMN \w+ (?:timestamptz|text|uuid),/g)).toHaveLength(4)
  expect(sql).toContain("ADD COLUMN replaces_payment_id uuid,")
  expect(sql).not.toMatch(/ADD COLUMN [^,]*\b(?:DEFAULT|NOT NULL)\b/)
  expect(code(migration)).toContain("has_table_privilege('authenticated', 'public.booking_payments', 'DELETE, TRUNCATE')")
  expect(code(migration)).toContain(
    "conname = 'booking_payments_booking_fkey' AND contype = 'f' AND confdeltype = 'r'\n        AND confrelid = 'public.bookings'::pg_catalog.regclass) THEN\n    RAISE EXCEPTION 'PAYMENT_HISTORY_010_BOOKING_FK_NOT_RESTRICT';",
  )
  expect(code(migration).indexOf("PAYMENT_HISTORY_010_BOOKING_FK_NOT_RESTRICT")).toBeLessThan(code(migration).indexOf("$guard$;"))
  for (const requirement of ["PAYMENT_HISTORY_010_REQUIRES_007", "PAYMENT_HISTORY_010_BOOKING_FK_NOT_RESTRICT", "PAYMENT_HISTORY_010_ACL_MISMATCH", "PAYMENT_HISTORY_010_ALREADY_PRESENT"]) {
    expect(migration).toContain(requirement)
  }
  expect(migration.match(/SECURITY INVOKER SET search_path = ''/g)).toHaveLength(3)
  expect(migration).toContain("FROM PUBLIC, anon, authenticated;")
})
it("STATIC: 010 mirrors the application value sets and limits", () => {
  expect(migration).toContain(`CHECK (void_kind IN (${PAYMENT_VOID_KINDS.map(kind => `'${kind}'`).join(", ")}))`)
  expect(migration).toContain(`char_length(void_reason) BETWEEN 1 AND ${MAX_PAYMENT_VOID_REASON_LENGTH}`)
  expect(migration).toContain("REFERENCES public.booking_payments(workspace_id, id) ON DELETE RESTRICT")
  expect(migration).toContain("UNIQUE (workspace_id, replaces_payment_id)")
})
it("STATIC: the 010 rollback never drops recorded history", () => {
  expect(rollback).toContain("PAYMENT_HISTORY_010_ROLLBACK_HAS_HISTORY")
  expect(rollback).toContain("WHERE void_kind IS NOT NULL OR replaces_payment_id IS NOT NULL")
  expect(keywords(rollback)).not.toMatch(/\bDELETE FROM\b|\bUPDATE public\.|\bGRANT\b|\bPOLICY\b/)
})
