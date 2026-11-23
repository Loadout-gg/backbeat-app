# Booking finance (P2)

P2 of the reference plan `ARCH-20261114-booking-domain` r02, implemented under the staging delegation of 2026-11-21 with Simone's decisions 1–13 of 2026-11-23 (see the [decision register](agents/decision-register.md), row `BOOKING-P2-FINANCE`). Staging only: production apply and promotion to `main` remain Alberto's.

## Contract

### Stored data (migration 007, additive, no backfill)

| Where | Columns | Rules enforced by the database |
|---|---|---|
| `booking_payments` (new) | `id`, `workspace_id`, `booking_id`, `kind`, `amount_minor`, `currency`, `due_on`, `paid_on`, `note`, `created_at`, `updated_at` | `kind` ∈ `deposit`, `balance`, `other`; `amount_minor` 1 to 999999999999; `currency` ∈ EUR, USD, GBP, JPY and equal to the booking fee currency (trigger, `BB004`); `note` ≤ 500 characters; composite foreign key `(workspace_id, booking_id)` → `bookings(workspace_id, id)` `ON DELETE RESTRICT`; `UNIQUE (workspace_id, id)` |
| `bookings` | `commission_type`, `commission_value`, `commission_mode`, `tax_note` | type ∈ `percent`, `fixed`; mode ∈ `on_top`, `included`; the three commission columns are all null or all set; percent value 0–10000 basis points; fixed value 0–999999999999 minor units of the fee currency; an included fixed commission cannot exceed the fee; `tax_note` ≤ 2000 characters; the fee currency cannot change or be cleared while payments exist (trigger, `BB005`) |
| `artists` | `default_commission_type`, `default_commission_value`, `default_commission_mode`, `default_commission_currency` | type, value and mode all null or all set, with the same type, mode and value ranges as a booking; the currency ∈ EUR, USD, GBP, JPY is required when the type is `fixed` (the value is then in minor units of that currency) and null when it is `percent` or unset |

Nothing derived is stored: no totals, no commission amount, no balance, no paid flag.

### Derived values (`lib/booking-finance.ts`, integer minor units)

- commission = `fee × basis points / 10000`, rounded half up to the minor unit, for `percent`; the stored amount for `fixed`. JPY has no decimals, so its minor unit is the yen. The product is computed with BigInt, so it stays exact above `Number.MAX_SAFE_INTEGER`.
- promoter total = fee + commission when the mode is `on_top`, otherwise the fee.
- paid total = sum of the payments that have a `paid_on` date.
- outstanding = promoter total − paid total. A negative value is shown as "Overpaid".
- artist net = fee − commission when the mode is `included`, otherwise the fee.
- A booking without a fee has no totals. Payments in a currency other than the fee currency cannot be stored; if one is ever read it is not summed and the panel says so.

### Rules

- **Paid** means `paid_on` is set by the agency. Nothing collects money, issues an invoice or converts currencies.
- **Currency**: a payment is always in the booking fee currency (application check plus trigger). A booking without a fee cannot take payments. With payments recorded, the fee amount can change and the fee currency cannot (application check plus trigger); clearing the fee counts as a currency change.
- **No coupling with the booking status**: no CHECK or trigger links payments and status. Cancelling a booking and moving its date keep the payments; payments can be recorded in any status.
- **Delete**: a booking with payments cannot be hard-deleted (foreign key, SQLSTATE `23503`); `deleteBooking` returns fixed copy and the editor shows it. The same key blocks the artist cascade for an artist whose bookings have payments. The application has no artist delete action today, so there is no copy to return there.
- **Commission**: per booking, edited in the Financial tab and saved with "Update booking". Per artist, a default on the profile: type, value and mode (decision 13), plus its own currency when the type is fixed (decision 12). Later changes of the default never rewrite existing bookings.
- **Prefill on a new booking**: a percent default is copied by `createBooking` with the artist's mode. A fixed default is in its own currency and a booking is created without a fee, so it cannot be copied at creation: the booking editor prefills it (type, amount, mode) when a booking that never had a saved fee and has no commission gets a fee in the default currency, and it is stored by that "Update booking". With a fee in any other currency nothing is prefilled and the editor shows a neutral notice; nothing is converted and no amount is reinterpreted in another currency's minor units (a EUR default never becomes yen). An untouched prefill is withdrawn if the fee currency is changed again before saving. Once a booking has a saved fee the default is not offered again, so a commission that was removed stays removed. The rule is `defaultCommissionPrefill` in `lib/booking-finance.ts`.
- **Taxes**: one free-text note per booking. No tax is calculated.
- **Visibility**: every active member of the workspace reads and writes payments, commission and tax note. `booking_payments` has the same `FOR ALL` active-member policy and explicit `REVOKE`/`GRANT` as the tables of migration 001; no role-specific policy.
- **Out of scope**: invoicing, online payments, FX, file storage, promoter accounts.

### Known behaviour

- **Deleting a whole workspace cascades through its payments.** The `RESTRICT` key blocks deleting a booking or an artist, not the workspace: the workspace cascade removes bookings and payments in the same statement, before the `RESTRICT` check runs. Accepted by Simone on 2026-11-23; executed in `tests/sql/booking-finance.sql`.
- **No artist delete action exists in the application.** The database blocks deleting an artist whose bookings have payments; there is no application copy for it because nothing in the application deletes artists. Accepted by Simone on 2026-11-23.
- **A fixed artist default reaches a booking through the editor, not at creation**, because bookings are created without a fee (see "Prefill on a new booking").

### Application surface

| Piece | Behaviour |
|---|---|
| `lib/actions/booking-payments.ts` | `getBookingPayments` (workspace-scoped complete read, explicit columns, rejects on failure), `createBookingPayment`, `updateBookingPayment` (allowlist without currency, booking or workspace), `deleteBookingPayment`. Zod validation before any backend access, affected-row witness, fixed error copy; provider and database messages are logged server-side only |
| `lib/actions/bookings.ts` | `updateBooking` accepts the commission triple and `tax_note`, refuses a fee currency change while payments exist, and maps `BB005` and the commission-within-fee CHECK to fixed copy; `deleteBooking` maps `23503` to fixed copy; `createBooking` reads the artist inside the workspace and copies a percent default commission with its mode; `getBooking` also returns the artist's default commission for the editor prefill |
| `lib/actions/artists.ts` | `updateArtistDefaultCommission(id, { type, value, mode, currency } \| null)` |
| Booking editor, Financial tab | fee (currency locked while payments exist), commission control, tax note, totals (booking fee, agency commission, promoter total, paid, outstanding or overpaid, artist net), payments list with add, edit, mark as paid today / not paid and delete with confirmation. Totals use saved values only |
| Artist profile, Pricing card | default agency commission: type, value, mode, and for a fixed amount its currency (EUR preselected); the amount is entered in the minor units of the chosen currency, so JPY takes whole numbers |

SQLSTATE raised by the triggers: `BB004` payment currency differs from the booking fee currency or the booking has no fee, `BB005` fee currency changed or cleared while payments exist.

### Ready for the next PR: payment receipts

"Paid only with an uploaded bank receipt" is the next PR (Supabase Storage). Nothing of it is built here. What is prepared: `booking_payments` has `UNIQUE (workspace_id, id)`, so a receipt record can use the same-workspace composite foreign key `(workspace_id, payment_id)`; `paid_on` is a plain nullable date, so a later rule "paid_on requires a receipt" can be added as a trigger without changing this table's meaning; the payment update allowlist is a single schema (`updatePaymentSchema`).

## Files

| File | Purpose |
|---|---|
| `migrations/007_booking_finance.sql` | columns, `booking_payments`, triggers, RLS, grants, policy |
| `ops/supabase/booking-finance/preflight.sql` | read-only state report before applying (one SELECT) |
| `ops/supabase/booking-finance/postflight.sql` | read-only catalog checks after applying (one SELECT, last row is the summary) |
| `ops/supabase/booking-finance/verify.sql` | 22 behaviour checks as a member, an outsider and `anon`; every write is rolled back; the result is the final SELECT |
| `ops/supabase/booking-finance/rollback.sql` | removes the 007 schema after copying its data to two backup tables |
| `tests/sql/booking-finance.sql` | executed SQL contract test for a throwaway local PostgreSQL 17 |

The migration and the rollback are idempotent and refuse to run without `backbeat.booking_finance_target` set to `development` or `hosted:hupkygptbvnzrihrlcxv` (staging). The target must match the synthetic marker of the database it names, exactly as for 005/006 (see [booking lifecycle](booking-lifecycle.md)): a missing marker table (production shape), a marker of the other target, zero or several rows are all refused. 004 and 005 are required. The setting is an accidental-target guard, not identity proof. A production apply needs Alberto's decision and a guard change.

## Order

Schema first, then code. The current staging code runs unchanged on the migrated schema. The new code reads `booking_payments` and the new columns, so it must not be merged before 007 is applied on staging.

1. Preflight: expect marker class `staging`, `007 objects present` = `0/11`, last row `READY_FOR_007`.
2. Apply 007: `SET backbeat.booking_finance_target = 'hosted:hupkygptbvnzrihrlcxv';` followed by the file content, in one run.
3. Postflight: last row `SUMMARY | ALL PASS | 15/15`.
4. Verify: first row `SUMMARY | ALL PASS | pass=22 fail=0 skip=0`. `INCOMPLETE` means missing test data (a booking without payments in a workspace with an active member, and an account outside that workspace); `FAILED` means do not merge.
5. Merge the PR to `staging`, verify the deployment commit.

The SQL editor shows only the result of the last statement; each file ends with one summarizing SELECT for that reason.

## Rollback

1. Redeploy the previous application version (revert the merge through a PR to `staging`). It runs unchanged on the 007 schema, so this step alone is a complete application rollback and loses nothing.
2. Only to remove the schema as well: run `rollback.sql` with the same target prefix. It copies every payment to `public.booking_payments_rollback_backup` and every booking commission, tax note and artist default to `public.booking_finance_rollback_backup` (RLS on, no grants, no policies), then drops `booking_payments`, the two trigger functions and the eight columns. A repeated rollback overwrites the backup of a row that still exists with its current values. The lifecycle schema of 005/006 is untouched.
3. To go forward again: apply 007. There is no restore script; the backup tables keep the removed values until they are copied back or dropped by hand.

## Tests

- `pnpm test`: commission and totals math (JPY, half-up rounding, values above `Number.MAX_SAFE_INTEGER`), currency rule, parsers and formatters, Zod allowlists, server actions (scope, witness, fixed copy, fee currency lock, delete mapping, default prefill), the default prefill rule (currency match, mismatch, JPY), the Financial tab and the artist default commission, static contracts of 007 and its ops files.
- `PG_BIN=<postgresql-17 bin> sh tests/sql/run-local.sh`: applies 001–007 to a throwaway local cluster and executes the guard, idempotency, untouched existing rows, postflight and verify, currency rule, fee currency lock, delete rules, commission and tax note CHECKs, workspace isolation, inactive membership, `anon`, rollback and re-apply. The `auth` schema there is a stub, so it does not prove hosted Auth or PostgREST behaviour. Not part of CI.
- `tests/integration` and `tests/e2e` need an authorized synthetic stack.
