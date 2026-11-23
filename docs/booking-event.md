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
2. Allowed only when the stored status is `confirmed` or `completed`; otherwise "An event can be created only from a confirmed or completed booking."
3. If an event already exists: "An event already exists for this booking." plus the id of that event (the UI links to it). Nothing is inserted.
4. One `INSERT` into `events`. No RPC, no second write: **the booking status and every other booking field are unchanged.**
5. A unique violation (two requests racing) is resolved to the same "already exists" answer. A foreign-key violation (booking, artist or promoter deleted meanwhile) is "The booking changed while the event was being created. Reload and try again."
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

The gate on the booking status is an application rule. The database enforces one event per booking and the same-workspace link, not the booking status.

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
- New actions return fixed copy; provider and database messages are logged server-side only. New reads use explicit projections and never select `public_token`.

## Files

| File | Purpose |
|---|---|
| `migrations/008_booking_event.sql` | columns, keys, foreign keys, CHECKs, index |
| `ops/supabase/booking-event/preflight.sql` | read-only state report; lists event rows that violate the status CHECK (id and status only) |
| `ops/supabase/booking-event/postflight.sql` | read-only checks after apply, summary in the last row |
| `ops/supabase/booking-event/verify.sql` | behaviour as a member, an outsider and anon; every write is rolled back; summary in the first row |
| `ops/supabase/booking-event/rollback.sql` | undo 008 with a backup table |
| `tests/sql/booking-event.sql`, `tests/sql/run-booking-event.sh` | executed SQL contract test on a throwaway local PostgreSQL 17 |
| `lib/booking-event.ts`, `lib/actions/booking-events.ts` | rules, fixed copy, conversion action, linked-event read |
| `app/dashboard/bookings/[id]/booking-event-link.tsx` | "Create event" control and link to the event |
| `components/dashboard/booking-promoter-select.tsx` | promoter selector used by the create modal and the editor |

Migration 008 is additive and idempotent, with no backfill. It refuses to run without `backbeat.booking_event_target` set to `development` or `hosted:hupkygptbvnzrihrlcxv` (staging), bound to the matching synthetic marker row exactly as 005/006 (see [booking lifecycle](booking-lifecycle.md)); a database without the marker table, such as production, is refused. It requires 005, RLS on the three tables and `UNIQUE (workspace_id, id)` on promoters. It refuses to run while any event row has a status outside the three values (`BOOKING_EVENT_UNEXPECTED_EVENT_STATUS_ROWS`); the preflight lists those rows. Existing single-column CHECKs on `events.status`, if any, are replaced by `events_status_check`.

## Order

Schema first, then code. The current staging code runs unchanged on the migrated schema. The new code reads the new columns, so **do not merge before 008 is applied on staging**.

Paste-ready copies for the staging SQL editor are generated outside the repository (`~/Desktop/backbeat-sql-pr34/`), each ending with one summarizing SELECT:

1. `01_preflight.sql`: expect marker class `staging`, `008 objects present` = `0/13`, no `status_violation` row, last row `READY_FOR_008`.
2. `02_migration_008.sql` (sets the staging target, then the migration): expect `MIGRATION_008_APPLIED`, `13/13 objects`.
3. `03_postflight.sql`: expect last row `SUMMARY | ALL PASS | 14/14`.
4. `04_verify_rls.sql`: expect first row `SUMMARY | ALL PASS | pass=16 fail=0 skip=0`. It needs one artist in a workspace with an active member and one account outside that workspace. `INCOMPLETE` means missing test data, `FAILED` means do not merge.
5. With 008 applied and the old code still deployed, open the bookings list, a booking and the events list on staging: they must still load (the new foreign keys add relationships that PostgREST reads).
6. Merge the PR to `staging`, verify the deployment commit.

## Rollback

1. Redeploy the previous application version (revert the merge through a PR to `staging`). It runs unchanged on the 008 schema.
2. Only to remove the schema: run `rollback.sql` with the same target prefix. It copies the booking link, start time and fee of events and the promoter of bookings into `public.booking_event_rollback_backup` (RLS on, no grants, no policies), then drops those columns, their constraints, the index and `events_status_check`. No event or booking is deleted. `UNIQUE (workspace_id, id)` on events stays.
3. To go forward again: apply 008, then restore by hand (staging only) and drop the backup:

```sql
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
DROP TABLE public.booking_event_rollback_backup;
```

Events whose booking was deleted after the rollback are skipped by the first statement and keep no snapshot.

## Tests

- `pnpm test`: conversion action (scope, gate, field map, retry, race, witness, fixed copy, projections), event read/update with the new fields, booking promoter create/update, "Create event" control, promoter selector in the modal and the editor, event page fields and link, static migration contracts.
- `PG_BIN=<postgresql-17 bin> sh tests/sql/run-booking-event.sh`: applies 001–006 and 008 to a throwaway local cluster and executes one event per booking, the retry, cross-workspace isolation, the status CHECK guard, fee rules, promoter link, deletes that keep the event and the booking, workspace cascade, preflight/postflight/verify, rollback and restore, and the target guard matrix. The `auth` schema there is a stub, so it does not prove hosted Auth or PostgREST behaviour. Not part of CI. It has its own runner so parallel branches do not edit `run-local.sh`.
- `tests/integration` and `tests/e2e` need an authorized synthetic stack.
