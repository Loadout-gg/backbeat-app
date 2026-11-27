// SOURCE_STATIC evidence for the owner decision on PR #36 (verification-plan IDs in the test
// names). These read the candidate's source; they do not execute PostgreSQL, Supabase or a
// browser. Executed evidence: tests/sql/travel-documents.sql and the other travel-document tests.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")
function files(dir: string, pattern = /\.(ts|tsx|mjs)$/): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, pattern) : pattern.test(name) ? [path] : []
  })
}
const code = (source: string) => source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")
const migration = read("migrations/009_booking_travel_stays.sql")
const sql = migration.replace(/--[^\n]*/g, "")
const app = [...files("lib"), ...files("app"), ...files("components")]
const SERVICE = "lib/travel-documents/scan-service.ts"
const PRIVILEGED = "lib/supabase/privileged.ts"
const functions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(backbeat_travel_document_\w+)\(([\s\S]*?)\)\s*RETURNS ([\s\S]*?)\nAS \$\$([\s\S]*?)\n\$\$;/g)]
  .map(match => ({ name: match[1], args: match[2], header: match[3], body: match[4] }))
const trusted = ["reserve_upload", "pending_key", "finalize_upload", "authorize_download", "record_issuance", "restore_probe",
  "confirm_restored_file", "purge_claim", "cleanup_claim", "purge_due", "purge_worklist", "purge_confirm", "audit_retention_purge"]
const member = ["archive", "restore", "relationship_end", "relationship_resume"]
const internal = ["cutoff", "is_member", "audit_write", "archive_row", "scrub", "audit_guard", "protect", "card_audit"]

it("ACL-01 RLS on every new relation; explicit revocation before the minimal grants; audit is SELECT-only for members", () => {
  for (const table of ["artist_travel_documents", "artist_travel_document_files", "artist_travel_document_audit", "artist_travel_document_relationships"]) {
    expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
  }
  const revoke = sql.indexOf("REVOKE ALL ON TABLE public.artist_travel_documents, public.artist_travel_document_files,\n  public.artist_travel_document_audit, public.artist_travel_document_relationships\n  FROM PUBLIC, anon, authenticated, service_role;")
  expect(revoke).toBeGreaterThan(-1)
  const grants = [...sql.matchAll(/GRANT ([^;]*?) ON ([^;]*?) TO (\w+);/g)].filter(grant => grant[2].includes("artist_travel_document"))
  expect(grants.length).toBe(4)
  for (const grant of grants) {
    expect(grant.index!).toBeGreaterThan(revoke)
    expect(grant[3]).toBe("authenticated")
    expect(grant[1]).not.toMatch(/\b(DELETE|TRUNCATE|ALL)\b/)
  }
  // The audit table is named in exactly one grant, and that grant is plain SELECT.
  expect(grants.filter(grant => grant[2].includes("artist_travel_document_audit")).map(grant => grant[1].trim())).toEqual(["SELECT"])
  expect(grants.filter(grant => grant[2].includes("artist_travel_document_files")).map(grant => grant[1])).toEqual([expect.stringMatching(/^SELECT \(/)])
  expect(grants.find(grant => grant[2].includes("artist_travel_document_files"))![1]).not.toMatch(/object_key|sha256/)
  // Every policy on the four relations is authenticated + active member of the row's workspace.
  const policies = [...sql.matchAll(/CREATE POLICY (artist_travel_document_\w+) ON public\.\w+ FOR (\w+) TO (\w+)\s+([^;]+);/g)]
  expect(policies.map(policy => `${policy[1]}:${policy[2]}`).sort()).toEqual([
    "artist_travel_document_audit_read:SELECT", "artist_travel_document_create:INSERT", "artist_travel_document_edit:UPDATE",
    "artist_travel_document_file_read:SELECT", "artist_travel_document_read:SELECT", "artist_travel_document_relationship_read:SELECT",
  ])
  for (const policy of policies) {
    expect(policy[3]).toBe("authenticated")
    expect(policy[4]).toContain("public.backbeat_is_active_member(workspace_id)")
  }
  // Untouched surfaces: no grant, revoke or policy statement names an existing table.
  expect(sql).not.toMatch(/(GRANT|REVOKE)[^;]*public\.(bookings|artists|events|workspaces|workspace_members|profiles|booking_payments)\b/)
  expect(sql).not.toMatch(/POLICY[^;]*ON public\.(bookings|artists|events|workspaces|workspace_members|profiles|booking_payments)\b/)
  // anon is only ever named to take privileges away.
  for (const statement of sql.split(";").filter(part => /\banon\b/.test(part))) expect(statement).toMatch(/^\s*REVOKE |'REVOKE ALL ON SEQUENCE /)
})

it("ACL-02 one caller class per function; trusted writer and purge are not browser-callable; definers pin search_path and take typed inputs", () => {
  expect(functions.map(fn => fn.name.replace("backbeat_travel_document_", "")).sort()).toEqual([...trusted, ...member, ...internal].sort())
  for (const fn of functions) {
    expect(fn.header, fn.name).toContain("SET search_path = ''")
    expect(fn.args, fn.name).not.toMatch(/\b(json|jsonb|anyelement|record|regclass|name)\b/)
    // No dynamic SQL built from an argument: the only EXECUTE is the fixed Storage-catalog probe.
    const dynamic = fn.body.match(/\bEXECUTE\b[^;]*;/g) ?? []
    if (fn.name.endsWith("purge_confirm")) expect(dynamic).toHaveLength(1)
    else expect(dynamic, fn.name).toEqual([])
  }
  const revoked = sql.slice(sql.indexOf("REVOKE ALL ON FUNCTION"), sql.indexOf("FROM PUBLIC, anon, authenticated, service_role;", sql.indexOf("REVOKE ALL ON FUNCTION")))
  for (const fn of functions) expect(revoked, fn.name).toContain(`public.${fn.name}(`)
  const granted = (role: string) => {
    const start = sql.lastIndexOf("GRANT EXECUTE ON FUNCTION", sql.indexOf(`TO ${role};`, sql.indexOf("REVOKE ALL ON FUNCTION")))
    return [...sql.slice(start, sql.indexOf(`TO ${role};`, start)).matchAll(/public\.backbeat_travel_document_(\w+)\(/g)].map(match => match[1]).sort()
  }
  expect(granted("authenticated")).toEqual([...member].sort())
  expect(granted("service_role")).toEqual([...trusted].sort())
  expect(sql.match(/GRANT EXECUTE ON FUNCTION/g)).toHaveLength(2)
  // Member entry points take no actor: the actor is the session. Trusted ones re-read membership.
  for (const fn of functions.filter(fn => member.includes(fn.name.replace("backbeat_travel_document_", "")))) {
    expect(fn.args).not.toMatch(/p_actor/)
    expect(fn.body).toContain("public.backbeat_travel_document_is_member(auth.uid(), p_workspace_id)")
  }
  for (const short of ["reserve_upload", "pending_key", "finalize_upload", "authorize_download", "restore_probe", "confirm_restored_file"]) {
    const fn = functions.find(candidate => candidate.name === `backbeat_travel_document_${short}`)!
    expect(fn.body, short).toContain("public.backbeat_travel_document_is_member(p_actor, p_workspace_id)")
  }
})

it("AUD-03 / ACL-01 the audit table has no foreign key, no reason column and exactly one writer", () => {
  const table = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.artist_travel_document_audit ("), sql.indexOf("CREATE TABLE IF NOT EXISTS public.artist_travel_document_relationships"))
  expect(table).not.toMatch(/REFERENCES|CASCADE|SET NULL/)
  expect(table).not.toMatch(/reason/i)
  expect(table).toContain("occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now()")
  const inserts = functions.filter(fn => /INSERT INTO public\.artist_travel_document_audit/.test(fn.body)).map(fn => fn.name)
  expect(inserts).toEqual(["backbeat_travel_document_audit_write"])
  const mutators = functions.filter(fn => /(UPDATE|DELETE FROM) public\.artist_travel_document_audit/.test(fn.body)).map(fn => fn.name)
  expect(mutators).toEqual(["backbeat_travel_document_audit_retention_purge"])
  // CORE-06: nothing in the candidate validates or asks for a written reason.
  expect(sql).not.toMatch(/char_length\(\s*reason|(?<![a-z_])reason\s+text/i)
  for (const path of app) expect(code(read(path)), path).not.toMatch(/\b(download|scan)\w*reason\b|reason\s*:\s*z\.|minLength|"Reason"|Reason for/i)
})

it("LIFE-01 / LIFE-02 no function removes a card, a scan row or a Storage object; only the scrub clears document fields", () => {
  for (const fn of functions) {
    expect(fn.body, fn.name).not.toMatch(/DELETE FROM public\.artist_travel_document(s|_files)\b/)
    expect(fn.body, fn.name).not.toMatch(/(DELETE FROM|UPDATE|INSERT INTO|TRUNCATE)\s+storage\./i)
  }
  expect(sql).not.toMatch(/(DELETE FROM|UPDATE|INSERT INTO|TRUNCATE)\s+storage\./i)
  const clearing = functions.filter(fn => /number = NULL/.test(fn.body)).map(fn => fn.name)
  expect(clearing).toEqual(["backbeat_travel_document_scrub"])
  expect(migration).toContain("SELECT ((archived AT TIME ZONE 'UTC') + INTERVAL '12 months') AT TIME ZONE 'UTC';")
})

it("ACL-04 the privileged client is isolated: one importer, no cookies, no session, server-only, never logged", () => {
  const privileged = read(PRIVILEGED)
  expect(code(privileged)).not.toMatch(/cookies|next\/headers|@supabase\/ssr/)
  expect(privileged).toContain("persistSession: false")
  expect(privileged).toContain('typeof window !== "undefined"')
  expect(privileged).toContain('process.env.TRAVEL_DOC_SCANS_ENABLED === "true"')
  expect(code(privileged)).not.toMatch(/console\./)
  for (const path of app) {
    const source = code(read(path))
    if (path !== PRIVILEGED && /SERVICE_ROLE|service_role/.test(source)) throw new Error(`service role named in ${path}`)
    if (source.includes("createPrivilegedClient") && path !== PRIVILEGED) expect(path).toBe(SERVICE)
    if (/from ["']@\/lib\/supabase\/privileged["']/.test(source)) {
      expect([SERVICE, "lib/actions/artist-travel-documents.ts"]).toContain(path)
    }
    if (source.includes("NEXT_PUBLIC") && /SERVICE|TRAVEL_DOC/.test(source)) throw new Error(`public env near a server secret in ${path}`)
  }
  // The actions module reads only the flag, never the client.
  expect(read("lib/actions/artist-travel-documents.ts")).not.toContain("createPrivilegedClient")
  // No client component reaches the trusted path except through server actions or the POST route.
  for (const path of app.filter(path => /^["']use client["']/.test(read(path).trimStart()))) {
    expect(read(path), path).not.toMatch(/scan-service|supabase\/privileged|\.storage\b/)
  }
  // Privileged calls come after the session and workspace were resolved.
  const service = read(SERVICE)
  const scope = service.slice(service.indexOf("async function resolveScope"), service.indexOf("/** Reads the stored object."))
  expect(scope.indexOf("auth.getUser()")).toBeGreaterThan(-1)
  expect(scope.indexOf("auth.getUser()")).toBeLessThan(scope.indexOf("getCurrentWorkspaceId()"))
  expect(scope.indexOf("getCurrentWorkspaceId()")).toBeLessThan(scope.indexOf("createPrivilegedClient()"))
  expect(service.match(/createPrivilegedClient\(\)/g)).toHaveLength(1)
  for (const exported of ["issueScanDownload", "reserveScanUpload", "finalizeScanUpload"]) {
    const body = service.slice(service.indexOf(`export async function ${exported}`))
    expect(body.indexOf("await resolveScope()")).toBeLessThan(body.indexOf(".rpc("))
  }
  // No public alias, no logging of keys / links, no Storage path in any payload type.
  expect(code(service)).not.toMatch(/getPublicUrl|console\.(log|info|debug)/)
  expect(service.match(/console\.error\(/g)).toHaveLength(1)
  expect(read("lib/actions/artist-travel-documents.ts")).not.toMatch(/object_key|signedUrl|sha256/)
})

it("ACL-04 rollback removes every entry point (no disclosure while rolled back) and keeps parked copies restricted", () => {
  const rollback = read("ops/supabase/booking-travel/rollback.sql")
  for (const short of [...trusted, ...member]) expect(rollback, short).toContain(`'backbeat_travel_document_${short}'`)
  expect(rollback).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role")
  expect(rollback).not.toMatch(/DROP TABLE|DROP TRIGGER|DISABLE ROW LEVEL SECURITY|storage\./i)
})

it("BOOK-01 no booking, event, promoter, email or export path reads, attaches or sends scans or card data", () => {
  const owners = ["lib/actions/artist-travel-documents.ts", SERVICE, PRIVILEGED, "lib/travel-document-scan.ts",
    "app/api/travel-documents/files/[fileId]/download/route.ts", "components/dashboard/travel-document-scan-controls.tsx",
    "components/dashboard/artist-travel-documents-section.tsx", "components/dashboard/booking-travel/booking-travel-panel.tsx",
    "app/dashboard/artists/[id]/page.tsx", "app/dashboard/bookings/[id]/page.tsx"]
  for (const path of app) {
    const source = code(read(path))
    if (/issueScanDownload|ScanDownloadButton|getArtistTravelProfile|createSignedUrl|travel-documents\/files/.test(source)) {
      expect(owners, path).toContain(path)
    }
  }
  // Booking writes never call a document function; the booking page only reads the profile for display.
  for (const path of ["lib/actions/bookings.ts", "lib/actions/booking-events.ts", "lib/actions/booking-payments.ts", "lib/actions/events.ts",
    "lib/actions/promoters.ts", "lib/actions/artist-export.ts", "lib/actions/dashboard.ts", "lib/actions/booking-travel.ts"]) {
    expect(code(read(path)), path).not.toMatch(/travel_document|travel-document|date_of_birth|storage/i)
  }
  // A download is only ever started by a click handler, never on render, mount or save.
  const controls = read("components/dashboard/travel-document-scan-controls.tsx")
  expect(controls).not.toMatch(/useEffect/)
  expect(controls.match(/travel-documents\/files/g)).toHaveLength(1)
  expect(controls).toContain('onClick={download}')
  // Only #36's logistics exist: the withdrawn ARCH-20261125 path (migration 011) is not in the tree.
  expect(readdirSync("migrations").filter(name => /^01[1-9]/.test(name))).toEqual([])
})

it("URL-01 / FILE-01 fixed parameters live in one place and match the database and the bucket", () => {
  const policy = read("lib/travel-document-scan.ts")
  expect(policy).toContain("export const SCAN_DOWNLOAD_TTL_SECONDS = 60")
  expect(policy).toContain("export const SCAN_MAX_BYTES = 10 * 1024 * 1024")
  expect(migration).toContain("media_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')")
  expect(migration).toContain("byte_size BETWEEN 1 AND 10485760")
  const provision = read("ops/supabase/booking-travel/storage-provision.sql")
  expect(provision).toContain("VALUES ('artist-travel-documents', 'artist-travel-documents', false, 10485760,\n  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])")
  expect(read(SERVICE)).not.toMatch(/createSignedUrl\([^)]*\b\d+\b/)
  expect(read(SERVICE)).not.toMatch(/upsert/)
})

it("HOST-01 (static) storage provisioning is separate, guarded, private, deny-all for sessions, and never applied by 009 or the app", () => {
  const provision = read("ops/supabase/booking-travel/storage-provision.sql")
  expect(migration.replace(/--[^\n]*/g, "")).not.toMatch(/storage\.buckets|CREATE POLICY[^;]*storage\./)
  expect(provision).toContain("current_setting('backbeat.travel_storage_target', true)")
  expect(provision).toContain("TRAVEL_STORAGE_TARGET_NOT_EXPLICIT")
  expect(provision).toContain("AS RESTRICTIVE FOR ALL TO anon, authenticated\n  USING (bucket_id <> 'artist-travel-documents')\n  WITH CHECK (bucket_id <> 'artist-travel-documents');")
  expect(provision.match(/CREATE POLICY/g)).toHaveLength(1)
  const statements = provision.replace(/--[^\n]*/g, "")
  expect(statements).not.toMatch(/DELETE FROM|TRUNCATE|DROP (TABLE|SCHEMA)|public = true/i)
  for (const forbidden of ["jttrznlbbjyufzyqmzzs", "ngwkmrfmivvgwtnpadmj", "xcastozqncxdauelquep"]) expect(provision).not.toContain(forbidden)
  for (const path of app) expect(code(read(path)), path).not.toMatch(/createBucket|storage\.buckets|\.storage\.from\([^)]*\)\.(remove|list|move|copy|update|upload)\(/)
})

it("LIFE-02 / AUD-04 (static) purge and audit retention are operator scripts: dry-run by default, explicit target, never imported, never scheduled", () => {
  const scripts = ["ops/supabase/booking-travel/purge-travel-documents.mjs", "ops/supabase/booking-travel/purge-travel-audit.mjs"]
  for (const path of scripts) {
    const source = read(path)
    expect(source).toContain("resolveTarget(options.target, url)")
    expect(source).toContain("execute: false")
    expect(source).toContain("process.env.SUPABASE_SERVICE_ROLE_KEY")
    expect(source).not.toMatch(/NEXT_PUBLIC|eyJ[A-Za-z0-9_-]{10,}/)
  }
  for (const path of app) expect(read(path), path).not.toMatch(/purge-travel-|purge_claim\b|purge_confirm|cleanup_claim|audit_retention_purge/)
  for (const config of ["vercel.json", "package.json", ".github/workflows/ci.yml"]) {
    expect(read(config), config).not.toMatch(/purge-travel|travel_document|crons|schedules/)
  }
  const purge = read(scripts[0])
  expect(purge).toContain("storage.remove([current.object_key])")
  expect(code(purge)).not.toMatch(/emptyBucket|deleteBucket|\.list\(|storage\.objects/)
})
