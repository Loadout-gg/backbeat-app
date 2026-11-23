# Booking travel, accommodation and artist travel documents (P4)

P4 of the reference plan `ARCH-20261114-booking-domain` r02 (D4), plus artist travel documents, implemented under the staging delegation of 2026-11-21 with Simone's decisions of 2026-11-23 (decision register `BOOKING-P4-TRAVEL`). Staging only: production apply and promotion to `main` remain Alberto's. Migration `009`.

## Contract

### Data

| Table / column | Parent | Content |
|---|---|---|
| `booking_travel_legs` | `bookings` (composite `(workspace_id, booking_id)`, `ON DELETE CASCADE`) | `direction` (`inbound`, `outbound`, `other`), `mode`, `carrier`, `reference`, departure and arrival place / date / time / zone label, `travellers` (free text), `driver_name`, `driver_phone`, `notes` |
| `booking_stays` | `bookings` (same key, cascade) | `name` (required), `address`, `check_in_on`, `check_out_on`, `confirmation_ref`, `notes` |
| `artist_travel_documents` | `artists` (composite `(workspace_id, artist_id)`, cascade) | `doc_type` (`passport`, `id_card`, `other`), `number` (required), `issuing_country`, `expires_on`, `holder_name` |
| `artists.date_of_birth` | - | `date`, nullable, not before 1900-01-01 (database) and not after today in the calendar zone (app) |

- Times are local date + time per endpoint, as written on the ticket. No conversion, no instants, no computed duration (decision 2, D4.2 A). The zone is an optional free-text label (max 64), not an IANA zone.
- A time needs its date. Order rule (database CHECK `booking_travel_legs_order_check` and Zod, Simone 2026-11-23):
  - **Both zone labels set and different** (case and outer spaces ignored): local clocks are not comparable, so times are not compared and the arrival date may be **up to one day before** the departure date (date-line crossing, e.g. Tokyo 2030-05-02 17:00 → Los Angeles 2030-05-01 10:00). Two or more days earlier is rejected.
  - **Equal labels, or one or both missing** (blank counts as missing): arrival date is not before departure date and, on the same date, arrival time is not before departure time.
- Check-out is never before check-in; same-day check-out is allowed.
- Lengths: mode 50, carrier 200, reference 100, places 300, zone 64, travellers 1000, driver name 200, driver phone 100, notes 2000; stay name 200, address 1000, confirmation 100; document number 64, issuing country 100, holder name 200. Every limit is both a Zod rule (`lib/booking-travel-validation.ts`) and a database CHECK.
- Driver fields moved from the Performance placeholder into legs: the disabled driver inputs and the "Same driver Inbound/Outbound" checkbox are gone from the Performance tab.
- Crew who are not artists: free-text `travellers` on the leg only; their identity documents are not stored.

### Access

- RLS: one `FOR ALL TO authenticated` policy per table, `backbeat_is_active_member(workspace_id)`, like migration 001. Every active workspace member sees and edits everything (decision 5); no role policy.
- Grants: `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`; then `SELECT, INSERT, DELETE` and **column-scoped** `UPDATE` to `authenticated`. `id`, `workspace_id`, `booking_id` / `artist_id` and `created_at` are not updatable, so a row cannot be moved to another booking, artist or workspace. `anon` has no access.
- `bookings` and `artists` RLS, grants and policies are unchanged.

### Privacy (decision 4)

Documents, date of birth, travellers and driver contact are sensitive personal data.

- Read only through explicit projections in `lib/actions/booking-travel.ts` (legs, stays) and `lib/actions/artist-travel-documents.ts` (documents, date of birth). A static test fails if any other module under `lib/`, `app/` or `components/` names these tables or `date_of_birth`.
- Never in list, selector, dashboard or CSV reads: `listArtists` and `getArtist` now use an explicit column list (`ARTIST_COLUMNS`) instead of `*`, so `date_of_birth` never reaches the artists list, the profile DTO or any export built on them. Booking list reads do not embed the child tables.
- Never logged: actions log only the SQLSTATE (`{ code }`), never the provider message or details (a CHECK violation echoes the row).
- Never in error copy: every action returns fixed copy; `23503` → "Booking not found" / "Artist not found", `23514` → a fixed "not accepted" message.
- Not included in any export.
- Retention and deletion rules are an open question for Alberto (HANDOVER, decision register).
- Parallel work: any new artist read must use an explicit projection. The static test `no artist read selects every column` fails if a merged branch (for example a CSV export) adds `from("artists").select("*")`; a new artist column (for example a default commission) must be added to `ARTIST_COLUMNS` by hand.

### Actions

`lib/actions/booking-travel.ts`: `getBookingTravel(bookingId)` (complete reads, rejects on failure), `createTravelLeg`, `updateTravelLeg`, `deleteTravelLeg`, `createBookingStay`, `updateBookingStay`, `deleteBookingStay`.
`lib/actions/artist-travel-documents.ts`: `getArtistTravelProfile(artistId)` (null when the artist is not in the workspace, rejects on failure), `createArtistTravelDocument`, `updateArtistTravelDocument`, `deleteArtistTravelDocument`, `updateArtistDateOfBirth`.

All writes: Zod validation and ID checks before any backend access, session required, scoped to `getCurrentWorkspaceId()`, affected-row witness (`select("id")`, zero rows → "… not found"). Inputs are full replacements (blank → NULL); `.strict()` schemas reject `workspace_id` / `booking_id` / `artist_id` keys.

### UI

- Booking editor: the Travel and Accommodation tabs replace the coming-soon panels. Each lists, adds, edits and deletes its rows with inline forms that save on their own (not through "Update booking"). The tabs stay mounted while hidden, so an unsaved form survives a tab switch. Duplicate submits are ignored, a failed save keeps the draft and shows fixed copy, delete asks for confirmation. A failed read shows "could not be loaded", never an empty list.
- The Travel tab shows the booking artist's date of birth and documents read-only, with "Expires before this booking" when a document expires before the booking date, and a link to edit them on the artist profile.
- Artist profile: a dedicated "Travel documents" section below the tabs (date of birth form, documents list, add, edit, delete).

## Files

| File | Purpose |
|---|---|
| `migrations/009_booking_travel_stays.sql` | Tables, CHECKs, indexes, RLS, grants, `artists.date_of_birth` |
| `ops/supabase/booking-travel/preflight.sql` | Read-only, one SELECT: marker class, prerequisites (005, artists key, RLS), 009 objects absent |
| `ops/supabase/booking-travel/postflight.sql` | Read-only, one SELECT: tables, RLS, policies, grants, FKs, CHECK count, column; first row `POSTFLIGHT OK` |
| `ops/supabase/booking-travel/verify.sql` | Post-apply checks as two real users; every write rolled back; final SELECT is the report |
| `ops/supabase/booking-travel/rollback.sql` | Undo 009 without data loss (park tables and date of birth in `*_rollback_backup`) |
| `ops/supabase/booking-travel/restore.sql` | After re-applying 009: copy parked rows back, drop backups |
| `tests/sql/booking-travel.sql` | Executed SQL contract test (throwaway local PostgreSQL 17) |

Migration 009 is idempotent and refuses to run without `backbeat.booking_travel_target` set to `development` or `hosted:hupkygptbvnzrihrlcxv` (staging), with the same marker binding as 005/006 (exactly one `runtime_environment` row matching the target; a missing marker table, i.e. production shape, is refused). It also requires 005 (`bookings_workspace_id_id_key`), the artists `(workspace_id, id)` key, `backbeat_is_active_member(uuid)` and RLS on `bookings`, `artists`, `workspaces`. A re-run refuses a same-named table with another shape.

## Order

Schema first, then code. Current staging code runs unchanged on the migrated schema: the new tables are unused, and `artists.date_of_birth` does reach the old `select("*")` artist reads, but it stays NULL for every artist until this PR's code (the only writer) is deployed, so keep the window between apply and merge short. The new code on the old schema shows "could not be loaded" in the Travel/Accommodation tabs and travel documents section, and every write fails. **Do not merge before applying 009 on staging.**

Files for the staging SQL editor: `~/Desktop/backbeat-sql-009/` on Simone's machine (copies of the repo files with the staging target line added to 02).

1. `01_preflight.sql` in the staging SQL editor: expect `PREFLIGHT READY`, marker class `staging`.
2. `02_migration_009.sql` (setting line + migration, one run): ends with a summary SELECT.
3. `03_postflight.sql`: expect `POSTFLIGHT OK failing: none`.
4. Create one booking in the app (any status) and have a second account in another workspace, then `04_verify_rls.sql`: expect `BOOKING_TRAVEL_VERIFY ALL PASS: pass=13 fail=0 skip=0`. `INCOMPLETE` means missing test data, `FAILED` means do not merge. Nothing is left behind.
5. Merge the PR to `staging`, verify the deployment commit.

## Rollback

1. Redeploy the previous application version (revert the merge through a PR to `staging`).
2. Run `rollback.sql` with the same target setting. The three tables are renamed to `*_rollback_backup` (indexes renamed, policies dropped, grants revoked; RLS stays on, so the API sees nothing) and `artists.date_of_birth` values are copied to `artists_date_of_birth_rollback_backup` before the column is dropped. No row is deleted. A second run is a no-op.
3. To go forward again: apply 009, then `restore.sql`: it copies parked rows back (rows already present are kept), restores empty dates of birth and drops the backups.

Backups still cascade on booking/artist delete (they keep their foreign keys). To discard them for good: `DROP TABLE public.booking_travel_legs_rollback_backup, public.booking_stays_rollback_backup, public.artist_travel_documents_rollback_backup, public.artists_date_of_birth_rollback_backup;`.

## Tests

- `pnpm test`: validation (`booking-travel-validation`), actions (`booking-travel-actions`: workspace scope, row witness, fixed copy, nothing sensitive logged, explicit projections), static migration and privacy contracts (`booking-travel-migration`), components (`booking-travel`, `artist-travel-documents`), and the artists list projection in `backend-read-contracts`.
- `PG_BIN=<postgresql-17 bin> sh tests/sql/run-local.sh booking-travel`: applies 001–006 and 009 to a throwaway cluster; guard matrix, prerequisites, idempotency, untouched parent rows, CHECKs (including the date-line rule), column-scoped UPDATE, cross-workspace isolation for all three tables and the new column, cascade on booking and artist delete, preflight/postflight/verify, rollback and restore. The `auth` schema is a stub: not proof of hosted Auth or PostgREST behaviour. Not part of CI.
- `tests/integration` and `tests/e2e` need an authorized synthetic stack (NOT_RUN).
