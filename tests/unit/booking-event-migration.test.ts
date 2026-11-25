// STATIC source contracts only. These do not parse or execute PostgreSQL.
// Executed coverage: tests/sql/booking-event.sql (manual, throwaway local cluster).
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { BOOKING_FEE_CURRENCIES, MAX_BOOKING_FEE_MINOR } from "@/lib/booking-fee"
import { CONVERTIBLE_BOOKING_STATUSES, EVENT_BOOKING_STATUS_SQLSTATE, EVENT_STATUSES } from "@/lib/booking-event"
const read = (path: string) => readFileSync(path, "utf8")
const migration = read("migrations/008_booking_event.sql")
const [preflight, postflight, verify, rollback] = ["preflight", "postflight", "verify", "rollback"]
  .map(name => read(`ops/supabase/booking-event/${name}.sql`))
const list = (values: readonly string[]) => values.map(value => `'${value}'`).join(", ")
const code = (sql: string) => sql.replace(/--.*$/gm, "")
/** The statements 008 runs at apply time: trigger function bodies run later, per row. */
const applyTime = (sql: string) => sql.replace(/\$function\$[\s\S]*?\$function\$/g, "$function$$function$")
const functionBody = (sql: string, name: string) =>
  sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`))?.[1] ?? ""

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

it("STATIC: 008 is additive and re-runnable: no backfill, no row rewrite, no policy or table grant", () => {
  const sql = code(migration)
  expect(applyTime(sql)).not.toMatch(/\bUPDATE public\.|\bDELETE FROM\b|\bINSERT INTO\b|\bTRUNCATE\b|\bDROP (?:TABLE|COLUMN|POLICY|INDEX)\b/)
  expect(sql).not.toMatch(/\bCREATE (?:OR REPLACE )?(?:POLICY|TABLE)\b|\bGRANT\b|\bREVOKE\b(?! ALL ON FUNCTION)|\bSECURITY DEFINER\b|ROW LEVEL SECURITY/)
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

it("STATIC: the link trigger gates on the booking status for every writer, as SECURITY INVOKER", () => {
  const sql = code(migration)
  expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(3)
  expect(sql).toContain("CREATE OR REPLACE FUNCTION public.backbeat_enforce_event_booking()\nRETURNS trigger LANGUAGE plpgsql SET search_path = ''")
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.backbeat_enforce_event_booking() FROM PUBLIC, anon, authenticated;")
  expect(sql).toContain("DROP TRIGGER IF EXISTS events_enforce_booking ON public.events;")
  expect(sql).toContain("CREATE TRIGGER events_enforce_booking BEFORE INSERT OR UPDATE OF booking_id, workspace_id ON public.events\n  FOR EACH ROW EXECUTE FUNCTION public.backbeat_enforce_event_booking();")
  expect(sql).toContain(`linked_status NOT IN (${list(CONVERTIBLE_BOOKING_STATUSES)})`)
  expect(sql).toContain(`USING ERRCODE = '${EVENT_BOOKING_STATUS_SQLSTATE}'`)
  expect(EVENT_BOOKING_STATUS_SQLSTATE).toBe("BB008")
  // Same-workspace lookup, row locked until commit; only evaluated when the link changes.
  expect(sql.replace(/\s+/g, " ")).toContain("FROM public.bookings AS b WHERE b.id = NEW.booking_id AND b.workspace_id = NEW.workspace_id FOR SHARE;")
  expect(sql).toContain("NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id")
  // SQLSTATEs of the other booking migrations are not reused.
  for (const taken of ["BB001", "BB002", "BB003", "BB004", "BB005"]) expect(sql).not.toContain(taken)
  expect(read("migrations/006_booking_lifecycle.sql")).not.toContain("BB008")
  expect(code(rollback)).toContain("DROP TRIGGER IF EXISTS events_enforce_booking ON public.events;\nDROP FUNCTION IF EXISTS public.backbeat_enforce_event_booking();")
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

it("STATIC: cancelling a converted booking cancels its event, which keeps its link and stays cancelled", () => {
  const sql = code(migration)
  for (const name of ["backbeat_cancel_booking_event", "backbeat_keep_cancelled_event"]) {
    expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${name}()\nRETURNS trigger LANGUAGE plpgsql SET search_path = ''`)
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated;`)
    expect(code(rollback)).toContain(`DROP FUNCTION IF EXISTS public.${name}();`)
  }
  expect(sql).toContain("CREATE TRIGGER bookings_cancel_event AFTER UPDATE OF status ON public.bookings\n  FOR EACH ROW EXECUTE FUNCTION public.backbeat_cancel_booking_event();")
  expect(sql).toContain("CREATE TRIGGER events_keep_cancelled BEFORE UPDATE OF status, booking_id ON public.events\n  FOR EACH ROW EXECUTE FUNCTION public.backbeat_keep_cancelled_event();")
  const cancel = functionBody(sql, "backbeat_cancel_booking_event").replace(/\s+/g, " ")
  // The only row write of 008: the status of the event linked to this booking, same workspace.
  expect(cancel.match(/UPDATE/g)).toHaveLength(1)
  expect(cancel).toContain("UPDATE public.events AS e SET status = 'cancelled' WHERE e.booking_id = NEW.id AND e.workspace_id = NEW.workspace_id")
  expect(cancel).not.toMatch(/DELETE|booking_id =\s*NULL|SET booking_id/)
  expect(cancel).toContain("USING ERRCODE = 'BB009'")
  const keep = functionBody(sql, "backbeat_keep_cancelled_event").replace(/\s+/g, " ")
  expect(keep).toContain("b.id = OLD.booking_id AND b.workspace_id = OLD.workspace_id AND b.status = 'cancelled'")
  expect(keep).toContain("USING ERRCODE = 'BB010'")
  expect(applyTime(sql)).not.toMatch(/SECURITY DEFINER/)
  // SQLSTATEs of 006, 007 and #33's 010 are not reused.
  for (const taken of ["BB001", "BB002", "BB003", "BB004", "BB005", "BB006", "BB007"]) expect(sql).not.toContain(taken)
})
