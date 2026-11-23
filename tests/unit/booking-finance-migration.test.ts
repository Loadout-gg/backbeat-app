// STATIC source contracts only. These do not parse or execute PostgreSQL.
// Executed coverage: tests/sql/booking-finance.sql (manual, throwaway local cluster).
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { BOOKING_FEE_CURRENCIES, MAX_BOOKING_FEE_MINOR } from "@/lib/booking-fee"
import {
  COMMISSION_MODES, COMMISSION_TYPES, MAX_COMMISSION_BASIS_POINTS, MAX_PAYMENT_NOTE_LENGTH, MAX_TAX_NOTE_LENGTH, PAYMENT_KINDS,
} from "@/lib/booking-finance"
const read = (path: string) => readFileSync(path, "utf8")
const migration = read("migrations/007_booking_finance.sql")
const [preflight, postflight, verify, rollback] = ["preflight", "postflight", "verify", "rollback"]
  .map(name => read(`ops/supabase/booking-finance/${name}.sql`))
const list = (values: readonly string[]) => values.map(value => `'${value}'`).join(", ")
const code = (sql: string) => sql.replace(/--.*$/gm, "")
/** Code without comments and without the contents of string literals (labels name privileges). */
const keywords = (sql: string) => code(sql).replace(/'(?:[^']|'')*'/g, "''")

it("STATIC: 007 and its rollback need an explicit development or staging target, never production", () => {
  for (const sql of [migration, rollback]) {
    expect(sql).toContain("current_setting('backbeat.booking_finance_target', true)")
    expect(sql).toContain("IF target = 'development' THEN\n    expected_id := 'backbeat-dev'; expected_environment := 'development';")
    expect(sql).toContain("ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN\n    expected_id := 'backbeat-staging'; expected_environment := 'staging';")
    for (const refusal of ["TARGET_NOT_EXPLICIT", "SYNTHETIC_MARKER_MISSING", "MARKER_DOES_NOT_MATCH_TARGET", "BOOKINGS_RLS_REQUIRED"]) {
      expect(sql).toContain(`BOOKING_FINANCE_${refusal}`)
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
it("STATIC: 007 is additive and re-runnable: no backfill, no row rewrite, no destructive statement", () => {
  const sql = code(migration)
  expect(sql).not.toMatch(/\bUPDATE public\.|\bDELETE FROM\b|\bINSERT INTO\b|\bTRUNCATE\b|\bDROP (?:TABLE|COLUMN)\b|\bSECURITY DEFINER\b/)
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.booking_payments")
  expect(sql).toContain("CREATE INDEX IF NOT EXISTS booking_payments_workspace_booking_idx")
  expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(6)
  expect(sql.match(/ADD COLUMN(?! IF NOT EXISTS)/g)).toBeNull()
  expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2)
  expect(sql.match(/SET search_path = ''/g)).toHaveLength(2)
  for (const trigger of ["booking_payments_enforce_currency ON public.booking_payments", "booking_payments_updated_at ON public.booking_payments", "bookings_enforce_fee_currency ON public.bookings"]) {
    expect(sql).toContain(`DROP TRIGGER IF EXISTS ${trigger}`)
  }
  expect(migration).toContain("Requires 004 and 005")
  for (const requirement of ["BOOKING_FINANCE_REQUIRES_004", "BOOKING_FINANCE_REQUIRES_005"]) expect(sql).toContain(requirement)
})
it("STATIC: 007 mirrors the application value sets and limits", () => {
  expect(migration).toContain(`CHECK (commission_type IN (${list(COMMISSION_TYPES)}))`)
  expect(migration).toContain(`CHECK (commission_mode IN (${list(COMMISSION_MODES)}))`)
  expect(migration).toContain(`CHECK (default_commission_type IN (${list(COMMISSION_TYPES)}))`)
  expect(migration).toContain(`CHECK (kind IN (${list(PAYMENT_KINDS)}))`)
  expect(migration).toContain(`CHECK (currency IN (${list(BOOKING_FEE_CURRENCIES)}))`)
  expect(migration).toContain(`CHECK (amount_minor BETWEEN 1 AND ${MAX_BOOKING_FEE_MINOR})`)
  expect(migration.match(new RegExp(`CASE WHEN (?:default_)?commission_type = 'percent' THEN ${MAX_COMMISSION_BASIS_POINTS} ELSE ${MAX_BOOKING_FEE_MINOR} END`, "g"))).toHaveLength(2)
  expect(migration).toContain(`CHECK (pg_catalog.char_length(tax_note) <= ${MAX_TAX_NOTE_LENGTH})`)
  expect(migration).toContain(`CHECK (pg_catalog.char_length(note) <= ${MAX_PAYMENT_NOTE_LENGTH})`)
})
it("STATIC: payments use the same-workspace key, RESTRICT, and the migration 001 access shape", () => {
  expect(migration).toContain("CONSTRAINT booking_payments_booking_fkey FOREIGN KEY (workspace_id, booking_id)\n    REFERENCES public.bookings(workspace_id, id) ON DELETE RESTRICT")
  expect(migration).toContain("CONSTRAINT booking_payments_workspace_id_id_key UNIQUE (workspace_id, id)")
  expect(migration).toContain("ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;")
  expect(migration).toContain("REVOKE ALL ON TABLE public.booking_payments FROM PUBLIC, anon, authenticated;")
  expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_payments TO authenticated;")
  expect(migration).toContain("CREATE POLICY booking_payment_access ON public.booking_payments FOR ALL TO authenticated\n  USING (public.backbeat_is_active_member(workspace_id))\n  WITH CHECK (public.backbeat_is_active_member(workspace_id));")
  expect(code(migration).match(/CREATE POLICY/g)).toHaveLength(1)
  expect(code(migration).match(/\bGRANT\b/g)).toHaveLength(1)
  expect(migration).toContain("REVOKE ALL ON FUNCTION public.backbeat_enforce_payment_currency(),\n  public.backbeat_enforce_booking_fee_currency() FROM PUBLIC, anon, authenticated;")
})
it("STATIC: the currency rule raises its own SQLSTATEs and nothing couples payments to the booking status", () => {
  expect(migration).toContain("USING ERRCODE = 'BB004'")
  expect(migration).toContain("USING ERRCODE = 'BB005'")
  expect(migration).toContain("NEW.fee_currency IS DISTINCT FROM OLD.fee_currency")
  expect(migration).toContain("FOR SHARE")
  expect(code(migration)).not.toMatch(/status/i)
  // Derived values are never stored.
  expect(code(migration)).not.toMatch(/promoter_total|paid_total|outstanding|artist_net|commission_amount/)
})
it("STATIC: preflight and postflight are single read-only SELECT statements", () => {
  for (const sql of [preflight, postflight]) {
    const statements = code(sql).split(";").map(part => part.trim()).filter(Boolean)
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(/^(?:SELECT|WITH)\b/)
    expect(keywords(sql)).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|SET|BEGIN|COMMIT)\b/)
  }
  for (const marker of ["development", "staging", "invalid", "absent", "READY_FOR_007"]) expect(preflight).toContain(marker)
  expect(postflight).toContain("'ALL PASS'")
})
it("STATIC: verify.sql rolls every write back and ends with one summarizing SELECT", () => {
  expect(verify.match(/^DO \$verify\$/gm)).toHaveLength(1)
  expect(verify).toContain("RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';\n  EXCEPTION WHEN OTHERS THEN\n    RESET ROLE;")
  expect(code(verify)).not.toMatch(/\bCOMMIT\b|\bCREATE\b|\bTEMP\b|\bALTER\b|\bDROP\b|\bGRANT\b/)
  const tail = verify.slice(verify.lastIndexOf("$verify$;") + "$verify$;".length).trim()
  expect(tail.startsWith("WITH lines AS")).toBe(true)
  expect(tail.split(";").filter(part => part.trim()).length).toBe(1)
  for (const expected of ["BB004", "BB005", "23503", "23514", "42501"]) expect(verify).toContain(`expected ${expected}`)
})
it("STATIC: rollback backs up before it removes, and the backups are invisible to API roles", () => {
  const sql = code(rollback)
  const firstDrop = Math.min(...["DROP TABLE IF EXISTS public.booking_payments;", "DROP COLUMN IF EXISTS commission_type", "DROP COLUMN IF EXISTS default_commission_type"].map(text => {
    expect(sql).toContain(text)
    return sql.indexOf(text)
  }))
  for (const backup of ["INSERT INTO public.booking_payments_rollback_backup", "INSERT INTO public.booking_finance_rollback_backup"]) {
    expect(sql.indexOf(backup)).toBeGreaterThan(-1)
    expect(sql.lastIndexOf(backup)).toBeLessThan(firstDrop)
  }
  expect(sql).toContain("ALTER TABLE public.booking_payments_rollback_backup ENABLE ROW LEVEL SECURITY;")
  expect(sql).toContain("ALTER TABLE public.booking_finance_rollback_backup ENABLE ROW LEVEL SECURITY;")
  expect(sql).toContain("REVOKE ALL ON TABLE public.booking_payments_rollback_backup,\n  public.booking_finance_rollback_backup FROM PUBLIC, anon, authenticated;")
  expect(sql).not.toMatch(/\bGRANT\b|CREATE POLICY/)
  // The lifecycle schema of 005/006 is left alone.
  expect(sql).not.toMatch(/bookings_enforce_status|bookings_workspace_id_id_key|hold_expires_on/)
})
