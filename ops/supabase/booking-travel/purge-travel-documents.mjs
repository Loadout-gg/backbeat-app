// Operator script: permanent removal of travel documents whose 12-month recovery window is over
// (owner decision on PR #36, D5). NOT part of the app, NOT scheduled, NOT callable from a browser.
// Running it with --execute is a destructive operation reserved to Alberto (governance r03):
// it needs his authorization for the exact target and run. Without --execute it only reports.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node ops/supabase/booking-travel/purge-travel-documents.mjs --target hosted:<ref> [--execute]
//       [--include-never-admitted --min-age-hours 24]
//
// What --execute does, in this order, and why it is safe to stop or re-run at any point:
//   1. claim (database, one transaction): due cards become purge_pending and can no longer be
//      restored; their admitted objects and displaced versions past their own cutoff become the
//      workset. A restore that committed first is not claimed; nothing else is touched.
//   2. per object: re-read the workset (a stale entry is skipped), remove THAT key through the
//      Storage API (never SQL on storage.objects, never a prefix), check it is gone, then confirm
//      in the database, which independently refuses while the Storage catalog still lists the key.
//   3. when the last object of a card is confirmed, the database scrubs the card (document
//      fields removed; ids, audit and booking history stay).
// A failure leaves the object claimed with its key on record; the next run retries it.
// --include-never-admitted additionally cleans reservations that never became a document scan
// and are older than --min-age-hours (at least 3): a separate authorization.
// There is no Storage backup (accepted risk, docs/travel-documents.md): removal is final.
// Output: counts and app ids only. Never keys, links, file content or credentials.
import { createClient } from "@supabase/supabase-js"
import { pathToFileURL } from "node:url"

export const BUCKET = "artist-travel-documents"

/** --target must name the project in SUPABASE_URL: hosted:<ref> or local (127.0.0.1:55322). */
export function resolveTarget(target, url) {
  let host
  try { host = new URL(url).host } catch { return null }
  if (target === "local") return host === "127.0.0.1:55322" ? "local" : null
  const match = /^hosted:([a-z0-9]{20})$/.exec(target ?? "")
  return match && host === `${match[1]}.supabase.co` ? target : null
}

export function parseArgs(argv) {
  const options = { target: null, execute: false, includeNeverAdmitted: false, minAgeHours: 24 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--execute") options.execute = true
    else if (arg === "--include-never-admitted") options.includeNeverAdmitted = true
    else if (arg === "--target") options.target = argv[++index] ?? null
    else if (arg === "--min-age-hours") options.minAgeHours = Number(argv[++index])
    else throw new Error(`Unknown argument: ${arg}`)
  }
  // A signed upload URL lives for about 2 hours: never clean a reservation that can still receive bytes.
  if (!Number.isInteger(options.minAgeHours) || options.minAgeHours < 3) throw new Error("--min-age-hours must be a whole number of hours, at least 3")
  return options
}

async function call(client, name, args) {
  const { data, error } = await client.rpc(`backbeat_travel_document_${name}`, args)
  if (error) throw new Error(`${name} failed (${error.code ?? "unknown"})`)
  return data
}

function isNotFound(error) {
  const message = typeof error?.message === "string" ? error.message : ""
  if (/bucket/i.test(message)) return false
  return error?.status === 404 || error?.statusCode === "404" || error?.statusCode === 404 || /not[ _]?found/i.test(message)
}

/** Reports, and with execute claims, removes and confirms. Returns a summary of ids and counts. */
export async function runPurge(client, { execute = false, includeNeverAdmitted = false, minAgeHours = 24 } = {}) {
  const due = (await call(client, "purge_due"))?.[0] ?? {}
  const summary = { execute, due, claimed: 0, confirmed: [], skipped: [], failed: [] }
  if (!execute) return summary

  summary.claimed = Number(await call(client, "purge_claim")) || 0
  if (includeNeverAdmitted) {
    summary.claimed += Number(await call(client, "cleanup_claim", { p_min_age: `${minAgeHours} hours` })) || 0
  }
  const storage = client.storage.from(BUCKET)
  const snapshot = (await call(client, "purge_worklist")) ?? []
  for (const item of snapshot) {
    // Re-read before acting: only a row that is still claimed, with the key the database holds now.
    const current = ((await call(client, "purge_worklist")) ?? []).find(row => row.file_id === item.file_id)
    if (!current || (current.kind === "cleanup_pending" && !includeNeverAdmitted)) {
      summary.skipped.push(item.file_id)
      continue
    }
    try {
      const removed = await storage.remove([current.object_key])
      if (removed.error && !isNotFound(removed.error)) throw new Error("remove")
      const probe = await storage.info(current.object_key)
      if (!probe.error || !isNotFound(probe.error)) throw new Error("still present or unknown")
      await call(client, "purge_confirm", { p_file_id: current.file_id, p_bucket: BUCKET })
      summary.confirmed.push(current.file_id)
    } catch (error) {
      summary.failed.push({ fileId: current.file_id, step: error instanceof Error ? error.message : "unknown" })
    }
  }
  summary.remaining = ((await call(client, "purge_worklist")) ?? []).length
  return summary
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the operator shell")
  const target = resolveTarget(options.target, url)
  if (!target) throw new Error("--target must be hosted:<project ref> (or local) and match SUPABASE_URL")
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const summary = await runPurge(client, options)
  console.log(JSON.stringify({ target, ...summary }, null, 2))
  if (!options.execute) console.log("Dry run: nothing was claimed or removed. Re-run with --execute once authorized.")
  if (summary.failed.length > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "purge failed")
    process.exitCode = 1
  })
}
