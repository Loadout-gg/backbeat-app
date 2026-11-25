# Booking to event conversion and booking promoter (P5)

P5 of the reference plan `ARCH-20261114-booking-domain` r02 (D0, D5), implemented under the staging delegation of 2026-11-21 with Simone's decisions of 2026-11-23 (decision register `BOOKING-P5-EVENT`). Staging only: production apply and promotion to `main` remain Alberto's.

## Contract

### One event per booking

- `events.booking_id` (uuid, nullable) names the booking an event was created from. `UNIQUE (booking_id)` allows at most one event per booking; events without a booking are unlimited.
- The link is a composite same-workspace foreign key `(workspace_id, booking_id)` → `bookings (workspace_id, id)`, `ON DELETE SET NULL (booking_id)`. Deleting the booking (directly or through the artist cascade of migration 001) keeps the event and clears only `booking_id`; `workspace_id` is never touched.
- `events` gets `UNIQUE (workspace_id, id)`, like artists, promoters and bookings.
- Deleting the event frees the booking: it can be converted again.

### Conversion

`createEventFromBooking(bookingId)` in `lib/actions/booking-events.ts`:

1. Reads the booking inside the selected workspace with an explicit projection.
2. Reads the event already linked to the booking. If there is one, the call succeeds with that event (`existing: true`) and the UI opens it: a double click, a retry after a lost response or a second tab never creates a second event and never shows an error. This holds whatever the booking status is now (for example cancelled after conversion). If the link read fails, the answer is the generic failure copy, never "already exists".
3. Without a linked event, allowed only when the stored status is `confirmed` or `completed`; otherwise "An event can be created only from a confirmed or completed booking." A booking cancelled before conversion therefore never gets an event.
4. One `INSERT` into `events`. No RPC, no second write: **the booking status and every other booking field are unchanged.**
5. The database repeats the status rule (below); its SQLSTATE `BB008` is answered with the same copy as step 2. A unique violation (two requests racing) re-reads the link: the winner's event is returned as `existing: true` only when that read returns a valid event id; otherwise the answer is "Unable to confirm whether the event was created. Reload the booking before retrying." A foreign-key violation (booking, artist or promoter deleted meanwhile) is "The booking changed while the event was being created. Reload and try again."
6. Success requires the created row back, in the selected workspace and linked to this booking.

Field map (a snapshot taken at conversion; later edits on either side do not flow to the other):

| Event | Source |
|---|---|
| `title` | `<artist stage name, else name> @ <venue_name>`; the artist name alone when the booking has no venue name |
| `date` | booking `date` |
| `location` | booking `venue_name` (null when blank) |
| `artist_id` | booking `artist_id` |
| `promoter_id` | booking `promoter_id` when set |
| `status` | `confirmed` |
| `start_time` | booking `start_time` |
| `fee_amount_minor`, `fee_currency` | booking fee pair, or both null |

### Status gate in the database

The trigger `events_enforce_booking` (`BEFORE INSERT OR UPDATE OF booking_id, workspace_id` on `events`, function `backbeat_enforce_event_booking()`, SECURITY INVOKER, not executable by `PUBLIC`, `anon` or `authenticated`) applies the gate to every writer, raw REST included:

- When `booking_id` is not null, the linked booking of the same workspace must be `confirmed` or `completed`; otherwise the write fails with SQLSTATE `BB008` (`BB001`–`BB003` belong to migration 006, `BB004`–`BB005` to 007).
- The booking row is locked `FOR SHARE`, so its status cannot change before the event write commits.
- It is evaluated only when a link is set or changed. Unlinking and linking again is a new link and is checked.
- A booking that does not exist or that the writer cannot see is left to the foreign key and RLS (`23503` / `42501`).

### Cancellation (Simone, 2026-11-25)

- **Cancelled before conversion:** no event is ever created (the status gate above, in the action and in the database).
- **Cancelled after conversion:** the trigger `bookings_cancel_event` (`AFTER UPDATE OF status` on `bookings`, function `backbeat_cancel_booking_event()`) sets the linked event of the same workspace to `cancelled` in the same transaction. Only `status` changes: the event keeps its booking link, title, date, start time, fee snapshot and promoter, stays editable, and is never deleted.
- **No reactivation:** the trigger `events_keep_cancelled` (`BEFORE UPDATE OF status, booking_id` on `events`, function `backbeat_keep_cancelled_event()`) refuses, with SQLSTATE `BB010`, moving the event of a cancelled booking out of `cancelled` or clearing its link; `updateEvent` answers "This event was cancelled with its booking and cannot be reopened. Create a new booking to rebook." A converted booking cannot leave `cancelled` (006 allows `cancelled` → `in_progress` otherwise): SQLSTATE `BB009`, answered by `updateBookingStatus` with "This booking has an event and was cancelled, so it cannot be reopened. Create a new booking to rebook."
- **Rebooking** is a new booking, converted to a new event; the cancelled event is untouched.
- Both functions are SECURITY INVOKER with an empty `search_path`, not executable by `PUBLIC`, `anon` or `authenticated`. They run under the writer's RLS; the existing `FOR ALL` active-member policies give the same writers both tables, so no policy or grant changes.
- Not changed: deleting a booking still keeps its event and clears only `booking_id` (foreign key `SET NULL`), whatever its status; deleting an event by hand is still allowed. An event without a booking, or whose booking is not cancelled, changes status freely.
- SQLSTATEs: `BB008` status gate, `BB009`, `BB010` (`BB001`–`BB003` are 006, `BB004`–`BB005` 007, `BB006`–`BB007` #33's 010). 008 used `BB006` for the gate before 2026-11-25; it was renumbered in place because #33 uses `BB006`.

### Event start time, fee and status

- `events.start_time` (time, nullable), `events.fee_amount_minor` (bigint, nullable), `events.fee_currency` (text, nullable). The fee follows the booking fee rules of migration 004: integer minor units 0…999999999999, currency EUR/USD/GBP/JPY, both set or both null.
- `getEvent` returns them with `booking_id`; `updateEvent` accepts `start_time` and the fee pair as optional fields (omitted = unchanged, null = cleared, incomplete pair rejected). `booking_id` is not writable through `updateEvent`.
- The event page shows and edits start time and fee, and links back to the booking. The new-event form is unchanged.
- `events.status` has the database CHECK `in_progress`, `confirmed`, `cancelled` (`events_status_check`), matching the application schema. The event page's "not supported" state for other stored values stays as a defensive read.

### Promoter on a booking

- `bookings.promoter_id` (uuid, nullable), composite same-workspace foreign key to `promoters (workspace_id, id)`, `ON DELETE SET NULL (promoter_id)`: deleting a promoter keeps the booking.
- Optional selector from the promoter directory in the create modal and in the editor (Contact info). In the editor it is saved with "Update booking" and sent only when changed. The free-text main contact is separate and unchanged.
- `createBooking` accepts `promoterId`; `updateBooking` accepts `promoter_id` (omitted = unchanged, null = cleared). A promoter that was deleted or belongs to another workspace is refused by the foreign key and answered with "The selected promoter no longer exists. Choose another promoter."
- A failed directory read is shown as "could not be loaded"; the booking can still be saved and the stored promoter is left unchanged.

### Visibility and errors

- RLS, grants and policies on `events`, `bookings` and `promoters` are unchanged: one `FOR ALL` active-member policy each, no role-specific policy. Every active workspace member sees and edits everything.
- New actions return fixed copy; provider and database messages are logged server-side only.
- Every read of `events` names its columns (BACKLOG R17): `listEvents` and `listEventsInProgress` select `id, title, date, location, status, artist_id, promoter_id, workspace_id, created_at` plus the artist and promoter embeds, `getEvent` its detail list. `public_token` never leaves the server. `tests/unit/event-read-projection.test.ts` fails on `select("*")`, a bare `select()` or `public_token` in any events read under `lib/`, `app/` or `components/`.

## Files

| File | Purpose |
|---|---|
| `migrations/008_booking_event.sql` | columns, keys, foreign keys, CHECKs, index, status-gate trigger |
| `ops/supabase/booking-event/preflight.sql` | read-only state report; lists event rows that violate the status CHECK (id and status only) |
| `ops/supabase/booking-event/postflight.sql` | read-only checks after apply, summary in the last row |
| `ops/supabase/booking-event/verify.sql` | behaviour as a member, an outsider and anon; every write is rolled back; summary in the first row |
| `ops/supabase/booking-event/rollback.sql` | undo 008 with a backup table |
| `tests/sql/booking-event.sql`, `tests/sql/run-booking-event.sh` | executed SQL contract test on a throwaway local PostgreSQL 17 |
| `lib/booking-event.ts`, `lib/actions/booking-events.ts` | rules, fixed copy, conversion action, linked-event read |
| `app/dashboard/bookings/[id]/booking-event-link.tsx` | "Create event" control and link to the event |
| `components/dashboard/booking-promoter-select.tsx` | promoter selector used by the create modal and the editor |

Migration 008 is additive and idempotent, with no backfill. It creates 15 objects: 5 columns, 8 constraints, 1 function, 1 trigger (plus one index). It refuses to run without `backbeat.booking_event_target` set to `development` or `hosted:hupkygptbvnzrihrlcxv` (staging), bound to the matching synthetic marker row exactly as 005/006 (see [booking lifecycle](booking-lifecycle.md)); a database without the marker table, such as production, is refused. It requires 005, RLS on the three tables and `UNIQUE (workspace_id, id)` on promoters. It refuses to run while any event row has a status outside the three values (`BOOKING_EVENT_UNEXPECTED_EVENT_STATUS_ROWS`); the preflight lists those rows. Existing single-column CHECKs on `events.status`, if any, are replaced by `events_status_check`.

## Order

Schema first, then code. The current staging code runs unchanged on the migrated schema. The new code reads the new columns, so **do not merge before 008 is applied on staging**.

**Reserved (r03 point 3):** applying 008 on staging is not authorized. Alberto approves the exact file bytes and the staging target, and applies it; no agent or manual SQL path runs it. The PR body lists file, sha256, actors, operations, data and rollout order. The copies in `~/Desktop/backbeat-sql-008/` predate the cancellation triggers and the `BB008` renumbering: they are obsolete and must not be used.

Expected results of the repository files, in order:

1. `preflight.sql`: expect marker class `staging`, `008 objects present` = `0/19`, no `status_violation` row, last row `READY_FOR_008`.
2. `migrations/008_booking_event.sql`, prefixed with `SET backbeat.booking_event_target = 'hosted:hupkygptbvnzrihrlcxv';`: completes with `COMMIT`; preflight then reports `19/19`.
3. `postflight.sql`: expect last row `SUMMARY | ALL PASS | 19/19`.
4. `verify.sql`: expect first row `SUMMARY | ALL PASS | pass=20 fail=0 skip=0`. It needs one artist in a workspace with an active member and one account outside that workspace. `INCOMPLETE` means missing test data, `FAILED` means do not merge.
5. With 008 applied and the old code still deployed, open the bookings list, a booking and the events list on staging: they must still load (the new foreign keys add relationships that PostgREST reads).
6. Merge the PR to `staging`, verify the deployment commit.

## Rollback

1. Redeploy the previous application version (revert the merge through a PR to `staging`). It runs unchanged on the 008 schema.
2. Only to remove the schema: run `rollback.sql` with the same target prefix. It copies the booking link, start time and fee of events and the promoter of bookings into `public.booking_event_rollback_backup` (RLS on, no grants, no policies), then drops the status-gate and cancellation triggers and functions, those columns, their constraints, the index and `events_status_check`. No event or booking is deleted. `UNIQUE (workspace_id, id)` on events stays.
3. To go forward again: apply 008, then restore by hand (staging only) and drop the backup. The status gate is switched off for the restore only: these links existed before, and the gate applies when a link is created, not to a booking that changed status afterwards.

```sql
BEGIN;
ALTER TABLE public.events DISABLE TRIGGER events_enforce_booking;
UPDATE public.events AS e
  SET booking_id = k.booking_id, start_time = k.start_time,
      fee_amount_minor = k.fee_amount_minor, fee_currency = k.fee_currency
  FROM public.booking_event_rollback_backup AS k
  WHERE k.source = 'event' AND e.id = k.id AND e.workspace_id = k.workspace_id
    AND (k.booking_id IS NULL OR EXISTS (SELECT 1 FROM public.bookings AS b
      WHERE b.id = k.booking_id AND b.workspace_id = k.workspace_id));
UPDATE public.bookings AS b SET promoter_id = k.promoter_id
  FROM public.booking_event_rollback_backup AS k
  WHERE k.source = 'booking' AND b.id = k.id AND b.workspace_id = k.workspace_id
    AND EXISTS (SELECT 1 FROM public.promoters AS p
      WHERE p.id = k.promoter_id AND p.workspace_id = k.workspace_id);
-- Same rule as bookings_cancel_event: the event of a booking cancelled meanwhile is cancelled.
UPDATE public.events AS e SET status = 'cancelled'
  FROM public.bookings AS b
  WHERE b.id = e.booking_id AND b.workspace_id = e.workspace_id
    AND b.status = 'cancelled' AND e.status IS DISTINCT FROM 'cancelled';
ALTER TABLE public.events ENABLE TRIGGER events_enforce_booking;
DROP TABLE public.booking_event_rollback_backup;
COMMIT;
```

Events whose booking was deleted after the rollback are skipped by the first statement and keep no snapshot.

## Tests

- `pnpm test`: conversion action (scope, gate, field map, retry reopens the linked event, race resolved only to a verified event, cancelled-after-conversion reopens, witness, fixed copy, projections), `BB009`/`BB010` copy, event read/update with the new fields, booking promoter create/update, `BB008` mapping, static guard on events read projections, "Create event" control, promoter selector in the modal and the editor, event page fields and link, static migration contracts.
- `PG_BIN=<postgresql-17 bin> sh tests/sql/run-booking-event.sh`: applies 001–006 and 008 to a throwaway local cluster and executes one event per booking, the retry, the status gate (a raw insert of an event linked to an `in_progress` booking is rejected with `BB008`, all six statuses), cancellation (before conversion no event; after conversion the event is cancelled, kept, linked and editable, cannot be reactivated or unlinked, the booking cannot leave cancelled, a rebooking gets a new event, the owner is bound too), cross-workspace isolation, the status CHECK guard, fee rules, promoter link, deletes that keep the event and the booking, workspace cascade, preflight/postflight/verify, rollback and restore, and the target guard matrix. The `auth` schema there is a stub, so it does not prove hosted Auth or PostgREST behaviour. Not part of CI. It has its own runner so parallel branches do not edit `run-local.sh`.
- `tests/integration` and `tests/e2e` need an authorized synthetic stack.
