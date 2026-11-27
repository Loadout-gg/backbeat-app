# Booking travel, accommodation and artist travel documents (P4)

P4 of the reference plan `ARCH-20261114-booking-domain` r02 (D4): travel legs, stays, `bookings.transport_to_city` and `artists.date_of_birth`, with Simone's decisions of 2026-11-23 (decision register `BOOKING-P4-TRAVEL`). Migration `009`.

Artist travel documents (cards, scans, audit, 12-month recovery) were redesigned on 2026-11-27 for Alberto's decision on PR #36 and are described in **[travel documents](travel-documents.md)**; this file keeps the parts they share: the migration's guard, the ops files, the rollout order and the rollback.

**Status: candidate.** 009 is not applied anywhere. Under governance r03 point 3, Alberto approves the exact 009 bytes and target and applies it; Storage provisioning, the scan flag, merge and deploy are his too. The "Order" below is the proposed sequence, not an authorization.

## Contract

### Data

| Table / column | Parent | Content |
|---|---|---|
| `booking_travel_legs` | `bookings` (composite `(workspace_id, booking_id)`, `ON DELETE CASCADE`) | `direction` (`inbound`, `outbound`, `other`), `mode`, `carrier`, `reference`, departure and arrival place / date / time / zone label, `travellers` (free text), `driver_name`, `driver_phone`, `notes` |
| `booking_stays` | `bookings` (same key, cascade) | `name` (required), `address`, `check_in_on`, `check_out_on`, `confirmation_ref`, `notes` |
| `artist_travel_documents`, `artist_travel_document_files`, `artist_travel_document_audit`, `artist_travel_document_relationships` | `artists` | See [travel documents](travel-documents.md) |
| `artists.date_of_birth` | - | `date`, nullable, not before 1900-01-01 (database) and not after today in the calendar zone (app) |
| `bookings.transport_to_city` | - | `text`, nullable, `promoter`, `artist` or `not_needed`: who organizes and pays travel to the venue city (owner decision D6). One field per booking, independent of the `mode` of any leg |

- Times are local date + time per endpoint, as written on the ticket. No conversion, no instants, no computed duration (decision 2, D4.2 A). The zone is an optional free-text label (max 64), not an IANA zone.
- A time needs its date. Order rule (database CHECK `booking_travel_legs_order_check` and Zod, Simone 2026-11-23):
  - **Both zone labels set and different** (case and outer spaces ignored): local clocks are not comparable, so times are not compared and the arrival date may be **up to one day before** the departure date (date-line crossing, e.g. Tokyo 2030-05-02 17:00 → Los Angeles 2030-05-01 10:00). Two or more days earlier is rejected.
  - **Equal labels, or one or both missing** (blank counts as missing): arrival date is not before departure date and, on the same date, arrival time is not before departure time.
- Check-out is never before check-in; same-day check-out is allowed.
- Lengths: mode 50, carrier 200, reference 100, places 300, zone 64, travellers 1000, driver name 200, driver phone 100, notes 2000; stay name 200, address 1000, confirmation 100; document number 64, issuing country 100, nationality 100, holder name 200. Every limit is both a Zod rule (`lib/booking-travel-validation.ts`) and a database CHECK.
- Driver fields moved from the Performance placeholder into legs: the disabled driver inputs and the "Same driver Inbound/Outbound" checkbox are gone from the Performance tab.
- Crew who are not artists: free-text `travellers` on the leg only; their identity documents are not stored.

### Access

- Legs and stays, RLS: one `FOR ALL TO authenticated` policy per table, `backbeat_is_active_member(workspace_id)`, like migration 001. Every active workspace member sees and edits everything (decision 5); no role policy.
- Legs and stays, grants: `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`; then `SELECT, INSERT, DELETE` and **column-scoped** `UPDATE` to `authenticated`. `id`, `workspace_id`, `booking_id` and `created_at` are not updatable, so a row cannot be moved to another booking or workspace. `anon` has no access.
- Travel documents: stricter and different (no delete, no lifecycle writes, audit read-only, trusted server functions). See [travel documents](travel-documents.md).
- `bookings` and `artists` RLS, grants and policies are unchanged. Their two new columns are covered by the existing table grants: an active member can read and write `transport_to_city` and `date_of_birth`.

### Privacy (decision 4)

Documents, date of birth, travellers and driver contact are sensitive personal data.

- Read only through explicit projections in `lib/actions/booking-travel.ts` (legs, stays) and `lib/actions/artist-travel-documents.ts` (documents, date of birth). A static test fails if any other module under `lib/`, `app/` or `components/` names these tables or `date_of_birth`.
- Never in list, selector, dashboard or CSV reads: `listArtists` and `getArtist` now use an explicit column list (`ARTIST_COLUMNS`) instead of `*`, so `date_of_birth` never reaches the artists list, the profile DTO or any export built on them. Booking list reads do not embed the child tables.
- Never logged: actions log only the SQLSTATE (`{ code }`), never the provider message or details (a CHECK violation echoes the row).
- Never in error copy: every action returns fixed copy; `23503` → "Booking not found" / "Artist not found", `23514` → a fixed "not accepted" message.
- Not included in any export.
- Travel documents: retention, recovery and removal are decided (12 months, [travel documents](travel-documents.md)). Legs, stays, travellers, driver contact and date of birth have no retention rule yet: they live until their booking is deleted or a member edits them.
- Parallel work: any new artist read must use an explicit projection. The static test `no artist read selects every column` fails if a merged branch (for example a CSV export) adds `from("artists").select("*")`; a new artist column (for example a default commission) must be added to `ARTIST_COLUMNS` by hand.

### Actions

`lib/actions/booking-travel.ts`: `getBookingTravel(bookingId)` (complete reads of legs, stays and the booking's `transport_to_city`; rejects on failure), `createTravelLeg`, `updateTravelLeg`, `deleteTravelLeg`, `createBookingStay`, `updateBookingStay`, `deleteBookingStay`, `updateBookingTransportToCity` (writes only that column).
`lib/actions/artist-travel-documents.ts`: `getArtistTravelProfile(artistId)` (null when the artist is not in the workspace, rejects on failure), `updateArtistDateOfBirth`, and the document actions listed in [travel documents](travel-documents.md).

All writes: Zod validation and ID checks before any backend access, session required, scoped to `getCurrentWorkspaceId()`, affected-row witness (`select("id")`, zero rows → "… not found"). Inputs are full replacements (blank → NULL); `.strict()` schemas reject `workspace_id` / `booking_id` / `artist_id` keys.

### UI

- Booking editor: the Travel and Accommodation tabs replace the coming-soon panels. Each lists, adds, edits and deletes its rows with inline forms that save on their own (not through "Update booking"). The tabs stay mounted while hidden, so an unsaved form survives a tab switch. Duplicate submits are ignored, a failed save keeps the draft and shows fixed copy, delete asks for confirmation. A failed read shows "could not be loaded", never an empty list.
- The Travel tab starts with "Transport to the city": one select (Not set, Promoter organizes and pays, Artist organizes and pays, Not needed) that saves on change, on its own. It is not offered when the travel read failed.
- The Travel tab shows the booking artist's date of birth and active documents read-only (number, name, nationality, issuing country, issue date, expiry), with "Expired" or "Expires before this booking", a one-tap "Download scan" that records the booking as context (when scans are enabled), and a link to edit them on the artist profile. Deleted documents are not shown on a booking. Nothing is sent with the booking.
- Artist profile: a dedicated "Travel documents" section below the tabs: date of birth form, cards (add, edit, delete, upload / replace / download scan), deleted documents with restore, end / resume relationship, activity.

## Files

| File | Purpose |
|---|---|
| `migrations/009_booking_travel_stays.sql` | Legs, stays, travel-document tables, functions, triggers, RLS, grants, `artists.date_of_birth`, `bookings.transport_to_city` |
| `ops/supabase/booking-travel/preflight.sql` | Read-only, one SELECT: marker class, prerequisites (005, artists key, RLS, `service_role`, free SQLSTATEs), 009 objects absent, bucket state (informational) |
| `ops/supabase/booking-travel/postflight.sql` | Read-only, one SELECT: tables, RLS, policies, effective table / column / function privileges of `anon`, `authenticated`, `service_role`, FKs, triggers, columns; first row `POSTFLIGHT OK` |
| `ops/supabase/booking-travel/verify.sql` | Post-apply checks as two real users; every write rolled back; final SELECT is the report. Database boundary only: no scan, link or Storage check |
| `ops/supabase/booking-travel/rollback.sql` | Undo 009 without data loss (park six tables and two columns in `*_rollback_backup`, drop every entry-point function) |
| `ops/supabase/booking-travel/restore.sql` | After re-applying 009: copy parked rows back, drop backups |
| `ops/supabase/booking-travel/storage-provision.sql` | Separate from 009: private bucket + deny-all policy for sessions. Own target setting (`backbeat.travel_storage_target`) |
| `ops/supabase/booking-travel/purge-travel-documents.mjs`, `purge-travel-audit.mjs` | Operator scripts (dry run by default); see [travel documents](travel-documents.md) |
| `tests/sql/booking-travel.sql`, `tests/sql/travel-documents.sql` | Executed SQL contract tests (throwaway local PostgreSQL 17) |

Migration 009 is idempotent and refuses to run without `backbeat.booking_travel_target` set to `development` or `hosted:hupkygptbvnzrihrlcxv` (staging), with the same marker binding as 005/006 (exactly one `runtime_environment` row matching the target; a missing marker table, i.e. production shape, is refused). It also requires 005 (`bookings_workspace_id_id_key`), the artists `(workspace_id, id)` key, `backbeat_is_active_member(uuid)` and RLS on `bookings`, `artists`, `workspaces`. A re-run refuses a same-named table with another shape. It creates no bucket and no Storage policy and writes no row.

## Order (proposed; each reserved step needs Alberto's authorization for the exact bytes and target)

Schema first, then code. Current staging code runs unchanged on the migrated schema: the new tables and functions are unused; `artists.date_of_birth` and `bookings.transport_to_city` reach the existing `select("*")`-style reads of those tables only as NULL until this PR's code (the only writer) is deployed, so keep the window between apply and merge short. The new code on the old schema shows "could not be loaded" in the Travel/Accommodation tabs and the travel documents section, and every write there fails. **Do not merge before 009 is applied on staging.**

Paste-ready copies for the staging SQL editor: `~/Desktop/backbeat-sql/pr36/` on Simone's machine (repo files; 02 has the staging target line added, 04 its own). Their SHA-256 are in the PR #36 comment for the head they were built from; a changed file invalidates them.

1. `01_preflight.sql`: expect `PREFLIGHT READY`, marker class `staging`, every `009` row `absent` / `0`.
2. `02_migration_009.sql` (setting line + migration, one run).
3. `03_postflight.sql`: expect `POSTFLIGHT OK failing: none`.
4. Optional, with one booking in the app and a second account in another workspace: `ops/supabase/booking-travel/verify.sql`: expect `BOOKING_TRAVEL_VERIFY ALL PASS: pass=23 fail=0 skip=0`. `INCOMPLETE` means missing test data, `FAILED` means do not merge. Nothing is left behind.
5. Merge the PR to `staging`, verify the deployment commit. Scans are off: cards, delete / restore, relationship, audit and transport to the city work; upload and download controls are not shown.
6. Later and separately, to activate scans: `04_storage_provision.sql`; server variables `SUPABASE_SERVICE_ROLE_KEY` and `TRAVEL_DOC_SCANS_ENABLED=true` on `backbeat-staging`; then the `HOSTED_STAGING` cases of the verification plan with synthetic files before anyone relies on it.

## Rollback

1. Turn scans off (`TRAVEL_DOC_SCANS_ENABLED` unset) and redeploy the previous application version (revert the merge through a PR to `staging`).
2. Run `rollback.sql` with the same target setting. Every entry-point function of 009 is dropped first (no link can be issued, nothing can be archived, restored or purged), the six tables are renamed to `*_rollback_backup` (indexes renamed, policies dropped, grants revoked for `anon`, `authenticated` and `service_role`; RLS stays on, so the API sees nothing; the append-only and delete-protection triggers stay on the parked tables), and `artists.date_of_birth` and `bookings.transport_to_city` values are copied to their own backup tables before the columns are dropped. No row is deleted. A second run is a no-op.
3. Storage is not touched by a rollback: objects stay in the private bucket, unreachable without the functions. A database rollback or backup never restores Storage bytes.
4. To go forward again: apply 009, then `restore.sql`: it copies parked rows back (rows already present are kept; audit rows with their original sequence, actor and time), restores empty dates of birth and transport values and drops the backups.

Backups keep their foreign keys. To discard them for good (destructive, Alberto's): drop the eight `*_rollback_backup` tables; the parked audit and card tables refuse row deletes (`BB012`, `BB018`) but not `DROP TABLE`.

## Tests

- `pnpm test`: validation (`booking-travel-validation`), actions (`booking-travel-actions`: workspace scope, row witness, fixed copy, nothing sensitive logged, explicit projections), static migration and privacy contracts (`booking-travel-migration`), components (`booking-travel`, `artist-travel-documents`), the artists list projection in `backend-read-contracts`, and the travel-document suites listed in [travel documents](travel-documents.md).
- `PG_BIN=<postgresql-17 bin> sh tests/sql/run-local.sh booking-travel travel-documents`: each suite applies 001–008 and 010, then 009, to its own throwaway cluster. `booking-travel`: guard matrix, prerequisites, idempotency, untouched parent rows, CHECKs (including the date-line rule), column-scoped UPDATE, `transport_to_city`, cross-workspace isolation, cascade on booking delete, artist delete refused while a card exists, preflight / postflight / verify, rollback and restore. `travel-documents`: see its own document. The `auth` and `storage` schemas are stubs: not proof of hosted Auth, PostgREST or Storage behaviour. Not part of CI.
- `tests/integration` and `tests/e2e` need an authorized synthetic stack (NOT_RUN).
