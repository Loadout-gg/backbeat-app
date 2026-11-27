// Operator script: audit-log retention for travel documents (owner parameter 2026-11-27:
// 24 calendar months, through a separately authorized purge, never automatic).
// NOT part of the app, NOT scheduled, NOT callable from a browser. Running it with --execute is
// reserved to Alberto (governance r03) for the exact target and cutoff. The database refuses a
// cutoff younger than 24 calendar months and removes only rows older than the cutoff; every
// other audit row stays byte-identical and the table stays append-only for everyone else.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node ops/supabase/booking-travel/purge-travel-audit.mjs --target hosted:<ref> --before 2024-11-27T00:00:00Z [--execute]
import { createClient } from "@supabase/supabase-js"
import { pathToFileURL } from "node:url"
import { resolveTarget } from "./purge-travel-documents.mjs"

export function parseArgs(argv) {
  const options = { target: null, before: null, execute: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--execute") options.execute = true
    else if (arg === "--target") options.target = argv[++index] ?? null
    else if (arg === "--before") options.before = argv[++index] ?? null
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.before || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(options.before) || Number.isNaN(Date.parse(options.before))) {
    throw new Error("--before must be a UTC instant such as 2024-11-27T00:00:00Z")
  }
  return options
}

/** Without execute nothing is called. With execute: one database call; returns the row count. */
export async function runAuditRetention(client, { before, execute = false }) {
  if (!execute) return { execute, before, removed: null }
  const { data, error } = await client.rpc("backbeat_travel_document_audit_retention_purge", { p_before: before })
  if (error) throw new Error(error.code === "BB021" ? "Refused: the cutoff is younger than 24 calendar months" : `audit retention failed (${error.code ?? "unknown"})`)
  return { execute, before, removed: Number(data) }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the operator shell")
  const target = resolveTarget(options.target, url)
  if (!target) throw new Error("--target must be hosted:<project ref> (or local) and match SUPABASE_URL")
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  console.log(JSON.stringify({ target, ...(await runAuditRetention(client, options)) }, null, 2))
  if (!options.execute) console.log("Dry run: nothing was removed. Re-run with --execute once authorized.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "audit retention failed")
    process.exitCode = 1
  })
}
