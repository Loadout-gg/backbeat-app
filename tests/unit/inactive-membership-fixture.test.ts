import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

const sql = readFileSync("tests/integration/inactive-membership.sql", "utf8")

it("STATIC: trusted fixtures precede the first authenticated role switch", () => {
  const roleSwitch = sql.indexOf("SET LOCAL ROLE authenticated;")
  expect(roleSwitch).toBeGreaterThan(0)

  for (const table of [
    "auth.users",
    "public.workspaces",
    "public.workspace_members",
    "public.artists",
    "public.bookings",
    "public.promoters",
    "public.events",
  ]) {
    const insert = sql.indexOf(`INSERT INTO ${table} `)
    expect(insert, table).toBeGreaterThanOrEqual(0)
    expect(insert, table).toBeLessThan(roleSwitch)
  }
  expect(sql.slice(0, roleSwitch)).toContain("email_confirmed_at")
  expect(sql.slice(0, roleSwitch)).toContain("migration 003 prerequisite absent")
})

it("STATIC: preserves authenticated assertions, protected-row checks and rollback verification", () => {
  expect(sql).toContain("Wrong active test role/identity")
  expect(sql).toContain("Wrong inactive test role/identity")
  expect(sql).toContain("EXCEPTION WHEN insufficient_privilege")
  expect(sql).toContain("Inactive selected-workspace RPC succeeded")
  expect(sql).toContain("Protected stored rows changed")
  expect(sql).toContain("ROLLBACK;")
  expect(sql).toContain("\\if :fixture_clean")
  expect(sql.indexOf("\\if :fixture_clean")).toBeGreaterThan(
    sql.indexOf("ROLLBACK;"),
  )
  expect(sql).not.toMatch(/^\s*(?:GRANT|REVOKE|CREATE POLICY|ALTER POLICY|DROP POLICY)\b/im)
  expect(sql).not.toMatch(/^\s*COMMIT\s*;/im)
})
