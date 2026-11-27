# Artist travel documents: cards, scans, audit, recovery

Implements Alberto's decision on PR #36 of 2026-11-27 ([record](agents/decisions/ARCH-20261127-TRAVEL-DOCUMENTS-D1-D6.md), D1–D6 with both appendices) and Simone's parameters of the same day. Travel legs, stays, date of birth and the rollout steps of migration `009` are in [booking travel](booking-travel.md).

**Status: candidate.** Migration `009` is not applied anywhere. The bucket does not exist. Scans are behind a server flag that is off. Applying 009, provisioning Storage, setting the flag and the server credential, merging and deploying are Alberto's reserved operations (governance r03 point 3); nothing in this document authorizes them.

## Why (product, owner PDR v0.1, 2026-11-27)

Agency operators handle each artist like a footballer under contract. Promoters, airlines and hotels ask for the artist's identity document on almost every show; in an emergency (missed flight, hotel unconfirmed) the person on logistics must find it and send it in seconds, from a phone or a computer.

| Principle | Consequence here |
|---|---|
| Speed first: no extra steps, no reason prompts, no confirmation on read or download | Download is one tap, on the artist profile and on the booking. No dialog, no reason. |
| One source of truth | One card per document on the artist; bookings show it, never copy it. |
| Every active team member sees and works on everything | No role or referent restriction (D1). Only agency settings are reserved, and they are not involved here. |
| Never lose history: cancel and correct, never erase | Delete is a recoverable archive; replaced scans are kept; the audit is append-only. |
| Phone and computer | Controls are plain buttons and native file inputs, usable at phone width. |

The artist does not upload documents: the team does. Documents are never sent automatically with a booking, an email, a PDF or a portal: a member downloads the scan and attaches it.

## Owner parameters (Simone, 2026-11-27)

| Parameter | Value | Where enforced |
|---|---|---|
| Written reason | None, anywhere | No reason column, parameter or field; `.strict()` schemas and the download endpoint reject one |
| Scan types | PDF, JPEG, PNG, HEIC, decided on the observed bytes | `lib/travel-document-scan.ts` (server, on the stored object), CHECK in 009, bucket `allowed_mime_types` |
| Scan size | 10 MB | Same three places |
| Signed link lifetime | 60 s | `SCAN_DOWNLOAD_TTL_SECONDS`; never taken from a request |
| Relationship end / resume | Two explicit manual actions on the artist profile | `backbeat_travel_document_relationship_end` / `_resume` |
| `bookings.transport_to_city` | `promoter`, `artist`, `not_needed`, or empty: who organizes and pays travel to the venue city | CHECK in 009, Zod, Travel tab |
| Audit retention | 24 calendar months, by a separately authorized purge, not automatic | `backbeat_travel_document_audit_retention_purge` (refuses a younger cutoff) + operator script |
| Storage backup | None for now. Accepted risk (see limitations) | — |

Deal types and the field: landed = artist organizes and pays travel to the city (`artist`), the promoter pays the hotel; promoter pays flights = `promoter` (the team gives availability, the promoter books with agency approval); all-in = the DJ books and pays travel and hotel, cost inside the fee (`artist`). The approval step and who pays the hotel are not modelled by this field.

## Model

| Table | Content | Member session can |
|---|---|---|
| `artist_travel_documents` | Data card: type, number, name as on the document, nationality, issuing country, issue date, expiry; lifecycle `state`, `generation`, `current_file_id`, `archived_at`, `restore_until`, `archive_cause`, `purged_at` | SELECT; INSERT and UPDATE of the data fields of an **active** card. No DELETE, no lifecycle column |
| `artist_travel_document_files` | One row per reserved scan version: allocated `object_key`, state, observed type / size / SHA-256 | SELECT without `object_key` and `sha256`. No write |
| `artist_travel_document_audit` | Automatic events. No foreign key, no free text | SELECT. No write |
| `artist_travel_document_relationships` | `ended_at` per artist, once "End relationship" was used | SELECT. No write |

All four: RLS on, one policy per operation, `backbeat_is_active_member(workspace_id)`. A session reads cards that are `active` or `archived` (an archived card is fully readable through the API by the members who can restore it; the app shows only the reduced recovery view); a card claimed by the purge, or purged, is no longer readable. `anon` has nothing. The trusted server role (`service_role`) has **no table privilege** on them: it can only execute the functions granted to it.

`nationality`, `issuing_country`, `issued_on`, `expires_on` and `holder_name` are independent fields; none is derived from another and no order rule ties issue date and expiry.

`artists.date_of_birth` (D4, described separately): a nullable `date` on the artist row, added by 009, CHECK not before 1900-01-01, not in the future (application). Read only by `getArtistTravelProfile`; written only by `updateArtistDateOfBirth`, which updates that one column. It is not a document field, is not the issue date, does not follow the document lifecycle (it is not archived by "End relationship") and is not in the document audit. Like every artist column it is writable by an active member through the existing table grant. No other use is attributed to it.

### Card lifecycle

```
active --delete / end relationship--> archived --restore (strictly before restore_until)--> active
archived --operator purge claim (restore_until <= now)--> purge_pending --every object confirmed absent--> purged
```

- **Delete** (`backbeat_travel_document_archive`): one transaction sets `archived`, `archived_at = now()`, `restore_until`, the cause and a new `generation`. The scan stays bound to the card. Storage is not called. A repeat, or a later "End relationship", changes neither the cutoff nor anything else.
- **Recovery clock**: `restore_until` = the database's archive instant + 12 **calendar** months in UTC, same time of day, day clamped to the end of the target month (29 Feb → 28 Feb). Stored once per archive episode. Reads, retries, a later relationship end or a purge run never move it. Document expiry is not the clock and deletes nothing.
- **Restore** (`backbeat_travel_document_restore`): only while `archived` and `now() < restore_until`; at the cutoff instant or later it is refused (`BB016`). Refused while the relationship is ended (`BB019`). Same id, artist, workspace and data. An expired document restores as what it is: the UI shows "Expired". A restored card can be archived again later: a new episode with a new cutoff.
- **Scan after a restore**: the version becomes `restore_pending` and is not servable until the server has read the object and the database has compared its size and SHA-256 with the recorded ones: equal → `ready`; absent or different → `missing`, never ready. The check runs on the first download.
- **Purge** (operator only): see "Operator maintenance". A purged card is a tombstone: every document field NULL, ids and timestamps kept.
- **No hard delete**: no DELETE grant; trigger `BB018` refuses a direct or cascaded delete of any card that is not a purged tombstone and of any scan row that is not purged/cleaned, for every role. **An artist or workspace that still has a card cannot be deleted** until its documents were purged (new behaviour, same shape as `BB011` for bookings with an event).

### Scan versions

`pending` (reserved, unservable) → `ready` (validated) → `superseded` (replaced; kept privately with its own 12-month cutoff, then purged). `rejected` = never admitted (invalid bytes, no bytes, or the card was archived / restored meanwhile). Keys are allocated by the database (`<workspace>/<artist>/<card>/<version>/<random>`), never chosen or sent by a browser, never returned by a read, and never rewritten. The uploading browser sees its key only inside the one-time upload URL of its own reservation; the deny-all session policy on the bucket is what makes that harmless. A composite foreign key makes the current scan of a card one of that card's own versions.

Upload, in three steps:

1. `reserveTravelDocumentScan` → trusted function inserts the pending version and the server returns a one-time **signed upload URL** for its key (no upsert: it cannot replace stored bytes).
2. The browser sends the file straight to Storage with that URL (Vercel request bodies stop at 4.5 MB; scans go up to 10 MB). It sends the public project key only, not the member's session.
3. `finalizeTravelDocumentScan` → the server reads the stored object, decides type and size on the bytes, computes the digest and calls the trusted function, which publishes the version under the card's row lock, or records the rejection. Archive and finalize are serialized by that lock: archive first → the version is rejected (`lost_generation`) and stays inventoried; finalize first → the version is current and goes into the archive with the card.

Active content: only the four types are admitted, and scans are delivered only as attachments (`Content-Disposition` through the signed link's `download` name, e.g. `passport-scan.pdf`); the app never renders or previews one. A PDF can still carry active content: an accepted type is not a malware verdict.

### Download

`POST /api/travel-documents/files/<fileId>/download`, same-origin only, body `{}` or `{ "bookingId": … }` / `{ "eventId": … }`. Anything else in the body (key, path, TTL, reason, actor) is refused. Response: `{ "url": … }` with `Cache-Control: private, no-store`.

1. Flag on; session user verified with the user client (Auth server check, so an expired or revoked session is refused); selected workspace with an active membership.
2. Privileged client → `backbeat_travel_document_authorize_download`: in **one transaction** re-reads the actor's active membership, the binding workspace → artist → active card → its current `ready` version, validates the optional booking/event against the same workspace and artist, and writes the `download_authorized` event. Committed when the call returns.
3. Only then the signer: `createSignedUrl(key, 60, { download })`.
4. `backbeat_travel_document_record_issuance`: the fence. It returns true only if the signer succeeded, the actor is still a member and the card is still active at the authorized generation with that version current; it writes a second event (`download_issued` or `download_not_issued` with `signer_failed`, `membership_lost` or `lost_generation`). The first event is never changed.
5. The link leaves the server only when 4 returned true.

A request id is single use (unique indexes): a replay is not a fresh grant. No outcome row for an authorization means the outcome is unknown, not a release.

### Audit

Actions: `card_created`, `card_updated` (trigger, session user), `archived`, `restored`, `relationship_ended`, `relationship_resumed`, `scan_upload_reserved`, `scan_uploaded`, `scan_replaced`, `scan_rejected`, `scan_restore_verified`, `scan_restore_missing`, `download_authorized`, `download_issued`, `download_not_issued`, and, with no actor, `purge_claimed`, `file_purged`, `document_purged`, `quarantine_cleaned`. Each row: workspace, artist, card, version, actor, action, fixed detail code, card generation, request id, validated booking/event, database time, sequence.

Append-only: the only writer is `backbeat_travel_document_audit_write` (not executable by any API role); UPDATE and TRUNCATE raise `BB012` for every role including the table owner; DELETE passes only inside the retention function. This is an application boundary, not protection from an unrestricted database administrator. Card writes made without a session user (SQL editor, `restore.sql`) are not attributed and not audited.

The artist profile shows the latest 50 events ("You" / "Team member" / "System", no user ids).

### Relationship end and resume

Manual, per artist, on the artist profile. Not a contract subsystem; no booking status is a signal.

- **End relationship** (one inline confirmation): archives every active card of that artist in one transaction, cause `relationship_ended`, each with its own cutoff from that instant. Cards archived earlier keep their cutoff. Artist, bookings and payments are untouched. While ended: no new card, no restore (`BB019`).
- **Resume relationship**: clears the signal. Nothing is restored or republished; each card is restored by hand, inside its own window.

## SQLSTATEs

| Code | Meaning |
|---|---|
| `BB012` | Audit rows are append-only |
| `BB013` | Actor is not an active member of the workspace (trusted path) |
| `BB014` | Card, version or artist not found, or outside the workspace (also for a non-member on a member entry point) |
| `BB015` | State does not allow it (archived, not current, not pending, replayed request, object still listed) |
| `BB016` | Restore window closed, or the purge already claimed the card |
| `BB017` | Booking / event is not of this workspace and artist |
| `BB018` | Hard delete of a card or scan row refused |
| `BB019` | Relationship ended |
| `BB020` | Scan of a restored card not verified yet, or missing |
| `BB021` | Audit retention cutoff younger than 24 months |

## Functions and who can call them

Every function is `SECURITY DEFINER` (or a trigger) with `search_path = ''`, typed parameters and no dynamic SQL from an argument. EXECUTE is revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, then granted to one caller class.

| Caller | Functions (`backbeat_travel_document_…`) | Actor |
|---|---|---|
| Member session (`authenticated`) | `archive`, `restore`, `relationship_end`, `relationship_resume` | `auth.uid()`, never a parameter |
| Trusted server (`service_role`) | `reserve_upload`, `pending_key`, `finalize_upload`, `authorize_download`, `record_issuance`, `restore_probe`, `confirm_restored_file` | `p_actor` = the session user the server verified; membership re-read inside |
| Operator scripts (`service_role`) | `purge_due`, `purge_claim`, `cleanup_claim`, `purge_worklist`, `purge_confirm`, `audit_retention_purge` | None (recorded with no actor) |
| Nobody | `cutoff`, `is_member`, `audit_write`, `archive_row`, `scrub`, and the trigger functions | — |

## Server code and configuration

| Piece | Role |
|---|---|
| `lib/supabase/privileged.ts` | The only place that builds the service-role client: no cookies, no session, server-only. Imported by the scan service only (static test) |
| `lib/travel-documents/scan-service.ts` | Trusted path: resolve session and workspace, then the functions and Storage, in the order above. Logs a fixed label and the SQLSTATE only |
| `app/api/travel-documents/files/[fileId]/download/route.ts` | The download POST |
| `lib/actions/artist-travel-documents.ts` | Reads (explicit projections), card writes, archive / restore / relationship through the member functions, scan reserve / finalize |
| `lib/travel-document-scan.ts` | Types, 10 MB, 60 s, byte sniffing |
| `ops/supabase/booking-travel/storage-provision.sql` | Bucket + deny-all policy for sessions. Separate, guarded, not applied |
| `ops/supabase/booking-travel/purge-travel-documents.mjs`, `purge-travel-audit.mjs` | Operator scripts. Dry run by default |

| Server variable | Default | Effect |
|---|---|---|
| `TRAVEL_DOC_SCANS_ENABLED` | unset = off | Only `"true"` enables upload and download |
| `SUPABASE_SERVICE_ROLE_KEY` | unset | Server credential for the trusted path. A secret: set by Alberto, never `NEXT_PUBLIC`, never in the repository |

Degradation: flag off → cards, archive, restore, relationship and audit work as usual; scan controls are not rendered and the section says scans are not enabled; the endpoint answers 503 with fixed copy. Flag on but credential, bucket or Storage unavailable → "Scan storage is unavailable. Please try again."; nothing is marked ready and no link is issued.

## Operator maintenance (not scheduled, not callable from the app)

**Purge of documents past their window** — `node ops/supabase/booking-travel/purge-travel-documents.mjs --target hosted:<ref> [--execute]`, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the operator's shell. Without `--execute` it prints counts only.

1. Claim, one transaction: cards `archived` with `restore_until <= now()` become `purge_pending`. Restore and claim take the same row lock and test the same state, so exactly one wins; a claimed card can no longer be restored. Their admitted objects, and displaced versions past their own cutoff, become the workset. A card without objects is scrubbed at once.
2. Per object: re-read the workset (a stale entry is skipped), remove that exact key through the Storage API, check that it is gone, then `purge_confirm`, which also refuses while `storage.objects` still lists the key. No SQL on `storage.objects`, no prefix removal.
3. When the last object of a card is confirmed, the card is scrubbed. Audit rows, artist, bookings and payments stay.

A failure leaves the object claimed with its key on record; the next run retries. `--include-never-admitted --min-age-hours N` (N ≥ 3, default 24: an upload link can deliver bytes for about 2 hours) additionally cleans reservations that never became a scan (a separate authorization).

**Audit retention** — `node ops/supabase/booking-travel/purge-travel-audit.mjs --target hosted:<ref> --before <UTC instant> [--execute]`. The database refuses a cutoff younger than 24 calendar months and removes only older rows.

Both are destructive and reserved to Alberto for the exact target and run.

## Accepted limitations

- **Links are bearer capabilities.** For 60 s a link can be opened by anyone who has it, without a Backbeat session, and forwarded. Archiving, replacing or removing a member stops **new** links; it does not revoke a link already issued or a copy already downloaded.
- **CDN and browser caches are separate from the token lifetime.** With Smart CDN a cached response can outlive the token. Not measured: record warm and cold behaviour on the actual plan before activation (plan URL-02, URL-03). No instant or per-link revocation is promised.
- **The audit records issuance, not use.** It says who asked, when, for which version and whether the app released a link. It does not prove the file was fetched, saved, received or forwarded.
- **No Storage backup.** Supabase database backups do not contain objects. A scan lost in Storage is lost: its card stays, the version is shown as missing and must be uploaded again. A database restore or `rollback.sql` never brings bytes back. Risk accepted by the owner for now.
- **Archive is retention, not erasure.** An archived document keeps its personal data for up to 12 months; a tombstone keeps ids and timestamps. An earlier erasure that is due (for example on request) is a separate, controlled procedure that does not exist yet. The 12 months are an operational policy, not a legal certification.
- **Type check is not a malware scan.** See "Scan versions".
- **Append-only is an application boundary.** A database administrator can bypass it.
- **Signed upload path not exercised on hosted Storage.** Whether the upload link works with the deny-all session policy in place, and what a member JWT can do against the bucket, are staging checks (FILE-02, FILE-03, HOST-01).
- **Session freshness** is whatever `auth.getUser()` and the membership re-read give on each request; no stricter revocation contract is defined (CORE-03, HOST-02).

## Verification

Evidence levels as in the decision: `SOURCE_STATIC` (reads the candidate), `LOCAL_INPROCESS` (synthetic, no new service), `HOSTED_STAGING` (existing staging, authorized scope). Test names start with the plan ID.

| Where | Level | IDs |
|---|---|---|
| `tests/unit/travel-documents-static.test.ts`, `tests/unit/booking-travel-migration.test.ts` | SOURCE_STATIC | ACL-01, ACL-02, ACL-04, BOOK-01; static side of AUD-03, LIFE-01, LIFE-02, URL-01, FILE-01, HOST-01, AUD-04 |
| `tests/sql/travel-documents.sql` (throwaway PostgreSQL 17; 001–008, 010, then 009; stub `auth` and `storage`) | LOCAL_INPROCESS | ACL-01..03, AUD-01..04, CORE-01..08, LIFE-01..10, DATA-01, FILE-01 (database side); races LIFE-03, LIFE-09, CORE-08 with a real second session and a lock barrier |
| `tests/sql/booking-travel.sql` | LOCAL_INPROCESS | BOOK-02, LIFE-06 (rollback / restore keep rows, never bytes), preflight / postflight / verify / rollback / restore |
| `tests/unit/travel-documents-scan-service.test.ts` | LOCAL_INPROCESS | CORE-03..08, URL-01, FILE-01, LIFE-03, LIFE-06, LIFE-07 (server order, both interleavings of authorize / archive with held promises) |
| `tests/unit/travel-documents-route.test.ts`, `travel-document-scan.test.ts`, `travel-documents-purge-script.test.ts`, `booking-travel-actions.test.ts`, `booking-travel-validation.test.ts` | LOCAL_INPROCESS | URL-01, CORE-05, CORE-06, FILE-01, LIFE-02, LIFE-09, AUD-04, DATA-01, BOOK-02, LIFE-05, LIFE-08 |
| `tests/component/artist-travel-documents.test.tsx`, `booking-travel.test.tsx` | LOCAL_INPROCESS | UI side of URL-01, CORE-05, CORE-06, FILE-01, LIFE-04..08, LIFE-10, DATA-01, BOOK-01, BOOK-02, AUD-01 |

`NOT_RUN`, and why: **HOST-01..05, URL-02, URL-03, FILE-02, FILE-03** need the existing staging project with 009 applied, the bucket provisioned and the flag on: all reserved and not authorized. Local PASS is not evidence for hosted Auth, PostgREST, Storage or CDN behaviour. `tests/integration` and `tests/e2e` need an authorized synthetic stack.

Run locally: `pnpm test`; `PG_BIN=<postgresql-17 bin> sh tests/sql/run-local.sh booking-travel travel-documents`.
