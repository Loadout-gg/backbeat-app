# Booking lifecycle (D0 + P1)

D0.2 and P1 of the reference plan `ARCH-20261114-booking-domain` r02, implemented under the staging delegation of 2026-11-21. Staging only: production apply and promotion to `main` remain Alberto's.

## Contract

Statuses: `in_progress`, `hold`, `option`, `confirmed`, `cancelled`, `completed`. New bookings start `in_progress`.

| From | Allowed targets |
|---|---|
| `in_progress` | `hold`, `option`, `confirmed`, `cancelled` |
| `hold` | `option`, `confirmed`, `cancelled`, `in_progress` |
| `option` | `confirmed`, `cancelled`, `hold` |
| `confirmed` | `cancelled`, `completed` |
| `cancelled` | `in_progress` |
| `completed` | none |

- `completed` = the show was performed. Manual, never automatic, not tied to payment. App rule: booking date ≤ today in `BACKBEAT_CALENDAR_TIME_ZONE` (UTC when unset). Database backstop: date ≤ `CURRENT_DATE + 1` (UTC), so a calendar zone ahead of UTC is never rejected by the database.
- Enforcement: `lib/booking-status.ts` (UI and server action) and the trigger `bookings_enforce_status` (every writer, including raw REST). The trigger evaluates the graph only when the status changes, so other edits of a completed or cancelled booking still pass. A completed booking cannot move to a date after tomorrow (UTC).
- Insert: a known status other than `in_progress` is rejected (`BB001`); unknown values still fail the CHECK (`23514`).
- `updateBookingStatus(id, to, expectedFrom)` is the only application path that changes status. It is a compare-and-set on `expectedFrom`; zero rows is resolved by a second scoped read into "changed elsewhere", "Booking not found" or "not performed yet". `updateBooking` rejects a `status` key.
- `hold_expires_on` (date, nullable) is valid only while status is `hold` and is cleared by the trigger when the booking leaves hold. Expiry is derived at read ("Hold expired"); nothing mutates an expired hold.
- Hold priority is derived at read: order of `created_at`, then `id`, among holds of the same artist and date.
- Same-day conflicts stay non-blocking notices. Dashboard "Bookings in progress" still counts `in_progress` only.
- Booking actions return fixed copy; provider and database messages are logged server-side only.
- RLS, grants and policies on `bookings` are unchanged.

SQLSTATE raised by the trigger: `BB001` initial status, `BB002` transition not in graph, `BB003` completed too early.

## Files

| File | Purpose |
|---|---|
| `migrations/005_booking_workspace_key.sql` | `UNIQUE (workspace_id, id)` on bookings (D0.2), for later child tables |
| `migrations/006_booking_lifecycle.sql` | status CHECK with six values, `hold_expires_on`, trigger |
| `ops/supabase/booking-lifecycle/preflight.sql` | read-only state report |
| `ops/supabase/booking-lifecycle/verify.sql` | post-apply checks as two real users (graph, insert rule, workspace isolation); every write is rolled back |
| `ops/supabase/booking-lifecycle/rollback.sql` | undo 006, with backup of hold/option rows |
| `ops/supabase/booking-lifecycle/restore.sql` | put backed-up values back after 006 is applied again |
| `tests/sql/` | executed SQL contract test for a throwaway local PostgreSQL 17 |

Both migrations are idempotent and refuse to run without `backbeat.booking_lifecycle_target` set to `development` or `hosted:hupkygptbvnzrihrlcxv` (staging). Each target must also match the synthetic marker of the database it names: exactly one row in `public.runtime_environment`, `backbeat-dev` / `development` / `synthetic_only = true` for `development`, `backbeat-staging` / `staging` / `synthetic_only = true` for the staging target. A marker that belongs to the other target, zero or several rows, any other value, or a missing marker table are refused. Production has no marker table (the hosted branch of migration 004 requires its absence), so these files refuse a production-shaped database whatever the setting says. `backbeat_is_active_member(uuid)` and RLS on `bookings` are required as well. The setting is an accidental-target guard, not identity proof. A production apply needs Alberto's decision and a guard change.

The preflight reports the marker class as `development`, `staging`, `invalid` or `absent`; on staging expect `staging`.

## Order

Schema first, then code. Current staging code runs unchanged on the migrated schema (it reads `*`, creates `in_progress`, never writes status from the UI). The new code on the old schema fails on hold/option, so do not merge before applying.

1. Preflight (`preflight.sql`) in the staging SQL editor.
2. Apply 005, then 006: paste `SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';` followed by the file content, in one run each.
3. Run the preflight again, create one test booking in the app, then run `verify.sql`. It always ends with an error, which is the report: expect `BOOKING_LIFECYCLE_VERIFY ALL PASS: pass=9 fail=0 skip=0` and nine numbered lines. `INCOMPLETE` means missing test data, `FAILED` means do not merge. It leaves nothing behind. It picks the `in_progress` booking dated after tomorrow when one exists (newest first), so older bookings do not hide the test booking.
4. Merge the PR to `staging`, verify the deployment commit.

## Rollback

1. Redeploy the previous application version (revert the merge through a PR to `staging`).
2. Run `rollback.sql` with the same target prefix. It copies `(id, workspace_id, status, hold_expires_on)` of every hold/option row into `public.bookings_lifecycle_rollback_backup` (RLS on, no grants, no policies), then sets those rows to `in_progress`, drops `hold_expires_on`, the trigger and the function, and restores the four-value CHECK. The additive unique key stays.
3. To go forward again: apply 006, then `restore.sql`. It restores status and expiry on rows that are still `in_progress` and drops the backup table. Rows changed after the rollback are left as they are.

Without step 3 the backup table stays until dropped by hand: `DROP TABLE public.bookings_lifecycle_rollback_backup;`.

## Tests

- `pnpm test`: transition matrix (36 pairs), compare-and-set, stale versus not found, fixed error copy, status control, hold expiry and priority, static migration contracts.
- `PG_BIN=<postgresql-17 bin> sh tests/sql/run-local.sh`: applies 001–006 to a throwaway local cluster and executes the trigger matrix, insert rule, completed-date rule, untouched pre-existing rows, workspace isolation, rollback and restore. The `auth` schema there is a stub, so it does not prove hosted Auth or PostgREST behaviour. Not part of CI.
- `tests/integration` and `tests/e2e` need an authorized synthetic stack.
