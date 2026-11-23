// STATIC source contracts only. These do not parse or execute PostgreSQL.
// Executed coverage: tests/sql/booking-lifecycle.sql (manual, throwaway local cluster).
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { BOOKING_STATUSES, BOOKING_TRANSITIONS } from "@/lib/booking-status"
const read = (path: string) => readFileSync(path, "utf8")
const key = read("migrations/005_booking_workspace_key.sql")
const lifecycle = read("migrations/006_booking_lifecycle.sql")
const ops = ["preflight", "rollback", "restore"].map(name => read(`ops/supabase/booking-lifecycle/${name}.sql`))
const list = (values: readonly string[]) => values.map(value => `'${value}'`).join(", ")

it("STATIC: every write file needs an explicit development or staging target, never production", () => {
  for (const sql of [key, lifecycle, ops[1], ops[2]]) {
    expect(sql).toContain("current_setting('backbeat.booking_lifecycle_target', true)")
    // Each target is bound to its own marker row; a missing table (production shape) is refused.
    expect(sql).toContain("IF target = 'development' THEN\n    expected_id := 'backbeat-dev'; expected_environment := 'development';")
    expect(sql).toContain("ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN\n    expected_id := 'backbeat-staging'; expected_environment := 'staging';")
    expect(sql).toContain("BOOKING_LIFECYCLE_TARGET_NOT_EXPLICIT")
    expect(sql).toContain("BOOKING_LIFECYCLE_SYNTHETIC_MARKER_MISSING")
    expect(sql).toContain("BOOKING_LIFECYCLE_MARKER_DOES_NOT_MATCH_TARGET")
    expect(sql).toContain("(SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1")
    expect(sql).toContain("WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE")
    expect(sql).toContain("BOOKING_LIFECYCLE_BOOKINGS_RLS_REQUIRED")
    expect(sql).toContain("SET LOCAL lock_timeout")
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true)
  }
  for (const sql of [key, lifecycle, ...ops]) {
    // Production (migration 004's ref) and the unrelated projects on the local CLI login.
    for (const forbidden of ["jttrznlbbjyufzyqmzzs", "ngwkmrfmivvgwtnpadmj", "xcastozqncxdauelquep"]) expect(sql).not.toContain(forbidden)
  }
})
it("STATIC: the preflight is read-only", () => {
  for (const marker of ["development", "staging", "invalid", "absent"]) expect(ops[0]).toContain(marker)
  expect(ops[0]).toContain("BEGIN TRANSACTION READ ONLY;")
  expect(ops[0].trimEnd().endsWith("ROLLBACK;")).toBe(true)
  expect(ops[0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b/)
})
it("STATIC: 005 only adds the workspace key, idempotently", () => {
  expect(key).toContain("ADD CONSTRAINT bookings_workspace_id_id_key UNIQUE (workspace_id, id)")
  expect(key).toContain("IF NOT EXISTS")
  expect(key).not.toMatch(/POLICY|GRANT|REVOKE|DROP|UPDATE public|DELETE/)
})
it("STATIC: 006 mirrors the application status list and transition graph", () => {
  expect(lifecycle).toContain(`CHECK (status IN\n    (${list(BOOKING_STATUSES)}))`)
  for (const from of BOOKING_STATUSES) {
    const targets = BOOKING_TRANSITIONS[from]
    if (targets.length === 0) expect(lifecycle).not.toContain(`WHEN '${from}' THEN`)
    else if (targets.length === 1) expect(lifecycle).toContain(`WHEN '${from}' THEN NEW.status = '${targets[0]}'`)
    else expect(lifecycle).toContain(`WHEN '${from}' THEN NEW.status IN (${list(targets)})`)
  }
  expect(lifecycle).toContain("IF NEW.status IS DISTINCT FROM OLD.status THEN")
  expect(lifecycle).toContain("NEW.date > (CURRENT_DATE + 1)")
  for (const code of ["BB001", "BB002", "BB003"]) expect(lifecycle).toContain(`ERRCODE = '${code}'`)
})
it("STATIC: 006 is re-runnable, rewrites no row and leaves RLS, grants and policies alone", () => {
  expect(lifecycle).toContain("ADD COLUMN IF NOT EXISTS hold_expires_on date")
  expect(lifecycle).toContain("CHECK (hold_expires_on IS NULL OR status = 'hold')")
  expect(lifecycle).toContain("CREATE OR REPLACE FUNCTION public.backbeat_enforce_booking_status()")
  expect(lifecycle).toContain("SET search_path = ''")
  expect(lifecycle).not.toContain("SECURITY DEFINER")
  expect(lifecycle).toContain("DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings")
  expect(lifecycle).toContain("REVOKE ALL ON FUNCTION public.backbeat_enforce_booking_status() FROM PUBLIC, anon, authenticated")
  expect(lifecycle).not.toMatch(/UPDATE public\.bookings|DELETE FROM|POLICY|ROW LEVEL SECURITY|GRANT /)
})
it("STATIC: verify.sql is one block whose final exception is the report and the rollback", () => {
  const verify = read("ops/supabase/booking-lifecycle/verify.sql")
  expect(verify.match(/^DO \$verify\$/gm)).toHaveLength(1)
  expect(verify.trimEnd().endsWith("$verify$;")).toBe(true)
  expect(verify).toContain("RAISE EXCEPTION E'BOOKING_LIFECYCLE_VERIFY %")
  expect(verify).toContain("USING ERRCODE = 'BBV00'")
  expect(verify).not.toMatch(/CREATE|TEMP|COMMIT/)
})
it("STATIC: rollback backs up hold/option rows before rewriting them, and restore drops the backup", () => {
  const [, rollback, restore] = ops
  const backup = rollback.indexOf("INSERT INTO public.bookings_lifecycle_rollback_backup")
  expect(backup).toBeGreaterThan(-1)
  expect(rollback.indexOf("UPDATE public.bookings SET status = 'in_progress'")).toBeGreaterThan(backup)
  expect(rollback.indexOf("DROP COLUMN IF EXISTS hold_expires_on")).toBeGreaterThan(backup)
  expect(rollback).toContain("ENABLE ROW LEVEL SECURITY")
  expect(rollback).toContain("REVOKE ALL ON TABLE public.bookings_lifecycle_rollback_backup FROM PUBLIC, anon, authenticated")
  expect(rollback).toContain("CHECK (status IN ('in_progress', 'confirmed', 'cancelled', 'completed'))")
  expect(restore).toContain("b.status = 'in_progress'")
  expect(restore).toContain("DROP TABLE public.bookings_lifecycle_rollback_backup")
})
