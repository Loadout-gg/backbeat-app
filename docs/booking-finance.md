# Booking finance (P2)

Unmerged #33 candidate: P2 of the reference plan `ARCH-20261114-booking-domain` r02. The [decision register](agents/decision-register.md) records Simone's proposed behavior, not Alberto's approval. Its [current authority](agents/decision-register.md#governance-correction-and-supersession) controls: migration 007, RLS and financial data access, deletes/cascades and destructive rollback require Alberto's approval even on staging. Production apply and promotion to `main` are separate.

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
- **Currency**: a payment is always in the booking fee currency (application check plus trigger). A booking without a fee cannot take payments. With payments recorded, the fee amount can change and the fee currency cannot (application check plus trigger); clearing the fee counts as a currency change. While the editor holds an unsaved fee currency change, it records no new payment (the payment would be in the saved currency and would then lock the fee currency at the unsaved draft).
- **No coupling with the booking status**: no CHECK or trigger links payments and status. Cancelling a booking and moving its date keep the payments; payments can be recorded in any status.
- **Delete** (owner decision, 2026-11-26): a booking with any payment row, including voided or corrected history, cannot be hard-deleted, only cancelled. The editor disables Delete when the loaded payments list is non-empty and shows the fixed copy next to it; when the payments read failed Delete stays available. The database is the authority: the 007 composite FK is `ON DELETE RESTRICT` (SQLSTATE `23503`), `deleteBooking` maps it to the same fixed copy and the editor shows it, and 010 refuses to apply unless that FK is still `RESTRICT` (`PAYMENT_HISTORY_010_BOOKING_FK_NOT_RESTRICT`). The same key blocks the artist cascade for an artist whose bookings have payments. The application has no artist delete action today, so there is no copy to return there.
- **Commission**: per booking, edited in the Financial tab and saved with "Update booking". Per artist, a default on the profile: type, value and mode (decision 13), plus its own currency when the type is fixed (decision 12). Later changes of the default never rewrite existing bookings.
- **Prefill on a new booking**: a percent default is copied by `createBooking` with the artist's mode. A fixed default is in its own currency and a booking is created without a fee, so it cannot be copied at creation: the booking editor prefills it (type, amount, mode) when a booking that has no saved fee and no saved commission gets a fee in the default currency, and it is stored by that "Update booking". With a fee in any other currency nothing is prefilled and the editor shows a neutral notice; nothing is converted and no amount is reinterpreted in another currency's minor units (a EUR default never becomes yen). An untouched prefill is withdrawn if the fee currency is changed again before saving. While a booking has a saved fee the default is not offered, so a commission removed from a priced booking stays removed. The prefill is never silent: it fills the visible commission fields, shows a notice and can be changed or cleared before saving. The rule is `defaultCommissionPrefill` in `lib/booking-finance.ts`.
- **Fixed commission currency**: a fixed commission is minor units of the fee currency it was entered in. When the fee is not in the same save, `updateBooking` requires `expected_fee_currency` (not a column) and writes only while the saved fee currency still matches; otherwise it returns fixed copy and nothing is written. The editor adopts a saved currency that changed under an unchanged fee draft and asks the member to re-check the amount instead of reinterpreting it.
- **Taxes**: one free-text note per booking. No tax is calculated.
- **Visibility**: active members retain visibility of payments, commission and tax note. For payments the active-member policy is unchanged, with table-level SELECT/INSERT/UPDATE and no ordinary DELETE. No new role, grant, or change to tenant membership rules.
- **Payment history** (migration 010, Simone's functional decision of 2026-11-25; activation reserved to Alberto): no hard delete of payments from the app. A recorded payment is never edited in place: the only in-place change is a first paid date (`updateBookingPayment` accepts `paid_on` only; a paid date is never changed or cleared, `BB006`). **Void** (`voidBookingPayment`, reason required, e.g. "Event cancelled") marks the row `void_kind = 'void'` with the database time; **Correct** inserts a new payment with `replaces_payment_id`, and the same statement marks the original `corrected` (`BB007` for another booking, an already closed original or a second correction). Voided and corrected rows stay listed as history, have no actions and never count in totals; they still lock the fee currency and block the booking hard delete. Without 010 the 007 forward guard (`BB006` on paid rows) is the only history rule.
- **Retry** (lost response, also across a page reload): the new-payment or correction draft keeps one ID (the idempotency key) through tab changes, failure, retry and reload. The tab's `sessionStorage` entry (`backbeat:payment-draft:<booking id>`) binds the draft to the server-verified member, workspace and booking. Recovery requires a matching browser auth snapshot; legacy unscoped drafts are not adopted. Explicit sign-out and observed identity changes clear payment drafts, not unrelated storage; a same-member token refresh does not clear them. A confirmed or cancelled draft is removed. If the payment appears in the reloaded booking with matching details, the draft closes as saved without a second request. On the server, a primary-key conflict (or `BB007` for a replayed correction) confirms success only if the selected workspace and booking contain an exact normalized match under that key. It never overwrites another row, and two distinct drafts can have identical amounts. A new tab, cleared storage or a distinct ID is not deduplicated.
- **Restored draft currency**: the currency stays with the draft. If it no longer matches the saved booking currency (including a cleared fee), the editor shows the original denomination and blocks submission. Cancel the draft and enter a new payment deliberately; the amount is not converted or carried over.
- **Out of scope**: invoicing, online payments, FX, file storage, promoter accounts.

### Known behaviour

- **Deleting a whole workspace cascades through its payments.** The `RESTRICT` key blocks deleting a booking or an artist, not the workspace: the workspace cascade removes bookings and payments in the same statement, before the `RESTRICT` check runs. Accepted by Simone on 2026-11-23; executed in `tests/sql/booking-finance.sql`.
- **No artist delete action exists in the application.** The database blocks deleting an artist whose bookings have payments; there is no application copy for it because nothing in the application deletes artists. Accepted by Simone on 2026-11-23.
- **A fixed artist default reaches a booking through the editor, not at creation**, because bookings are created without a fee (see "Prefill on a new booking").
- **"No saved fee" is the current state, not history.** No column records that the default was already offered. If the fee of a booking is cleared and saved, the booking is again without a fee, and choosing the default currency prefills the fixed default again, including on a booking whose commission had been removed earlier. A durable "offered once" rule needs a new column on `bookings`; open question for Simone.

### Application surface

| Piece | Behaviour |
|---|---|
| `lib/actions/booking-payments.ts` | Scoped read, create (also corrections via `replacesPaymentId`), mark paid and void. Legacy `deleteBookingPayment` denies without a read or write. Validation and row witnesses precede success. Provider messages are not returned to the client |
| `lib/actions/bookings.ts` | `updateBooking` accepts the commission triple and `tax_note`, refuses a fee currency change while payments exist, and maps `BB005` and the commission-within-fee CHECK to fixed copy; `deleteBooking` maps the named payment FK (`23503`/`23001`) to fixed copy; `createBooking` reads the artist inside the workspace and copies a percent default commission with its mode; `getBooking` also returns the artist's default commission for the editor prefill |
| `lib/actions/artists.ts` | `updateArtistDefaultCommission(id, { type, value, mode, currency } \| null)` |
| Booking editor, Financial tab | fee, commission, tax note and totals from saved values. Payments: add, mark paid, Correct and Void; voided and corrected rows shown as history. No delete, unmark or in-place edit control |
| Artist profile, Pricing card | default agency commission: type, value, mode, and for a fixed amount its currency (EUR preselected); the amount is entered in the minor units of the chosen currency, so JPY takes whole numbers |

SQLSTATEs: `BB004` invalid payment currency for this booking, `BB005` fee currency changed or cleared while payments exist, `BB006` attempted overwrite of payment history or identity, `BB007` invalid correction or a void on insert (010).

### Ready for the next PR: payment receipts

"Paid only with an uploaded bank receipt" is the next PR (Supabase Storage). Nothing of it is built here. What is prepared: `booking_payments` has `UNIQUE (workspace_id, id)`, so a receipt record can use the same-workspace composite foreign key `(workspace_id, payment_id)`; `paid_on` is a plain nullable date, so a later rule "paid_on requires a receipt" can be added as a trigger without changing this table's meaning; the payment update allowlist is a single schema (`updatePaymentSchema`).

## Files

| File | Purpose |
|---|---|
| `migrations/007_booking_finance.sql` | clean install only, with no DELETE grant. Refuses existing or partially installed finance relations/columns |
| `ops/supabase/booking-finance/007-forward-payment-history.sql` | separate forward candidate: adds an invoker guard to an existing 007 with DELETE already denied. No grants, DML, or changes to cascade |
| `ops/supabase/booking-finance/preflight.sql` | read-only state report before applying (one SELECT) |
| `ops/supabase/booking-finance/postflight.sql` | read-only catalog checks after applying (one SELECT, last row is the summary) |
| `ops/supabase/booking-finance/verify.sql` | development fixtures only; 22 checks as a member, an outsider and `anon`, rolling back its writes. Never run on hosted |
| `ops/supabase/booking-finance/rollback.sql` | removes the 007 schema after copying its data to two backup tables |
| `tests/sql/booking-finance.sql` | optional SQL contract for a throwaway PostgreSQL 17 fixture, not CI |
| `migrations/010_booking_payment_history.sql` | additive payment history (void, correction, no in-place edit). Requires 007; refuses a DELETE/TRUNCATE grant to `authenticated` and a `booking_payments_booking_fkey` that is not an `ON DELETE RESTRICT` FK; no grant, role, policy or RLS change. Not applied anywhere. 008/009 belong to #35/#36 |
| `ops/supabase/booking-finance/010-rollback.sql` | removes the 010 shape; refuses while any payment is voided, corrected or a correction, so it never drops history |
| `tests/sql/booking-payment-history.sql` | optional SQL contract for 010 and its rollback (throwaway PostgreSQL 17), not CI |

The target must have the corresponding synthetic marker; production is refused. The forward file additionally verifies staging's exact cluster identity, the 007 shape and effective payment ACL, and aborts transactionally if a prerequisite is missing. It does not repair drift or repeat the existing containment. Versioned separately in `ops` to avoid occupying the next product migration number.

## Proposed rollout order; not execution authorization

- **Already deployed 007 (including staging)**: never run either version of 007 again. Use read-only catalog evidence for the existing 007 and DELETE containment. Only the separate forward file is a candidate for owner-authorized application; confirm its catalog postconditions before enabling the matching frontend. Do not run `verify.sql` on hosted.
- **010 (reserved, not applied anywhere)**: after 007 (and, where present, the forward file) and a read-only run of postflight check 10 on the target expecting `confdeltype = 'r'`, with `SET backbeat.booking_payment_history_target = 'hosted:hupkygptbvnzrihrlcxv'`, only after Alberto approves its exact bytes, target and order. 010 must be applied before the app version of #33 is deployed: that version reads the 010 columns and otherwise shows "Payments could not be loaded".
- **Fresh synthetic database**: preflight requires `0/11` and `READY_FOR_007`. Use corrected 007 once, then the forward file, then catalog postflight (`15/15`). Behaviour verification is development-fixture only (`22` passes, zero fail/skip). Do not treat this sequence as authorization to create or modify an environment.

## Rollback

1. Prefer qualifying a frontend revert to the pre-#33 staging code while retaining the schema, history guard and DELETE containment. Do not revert to the unsafe intermediate finance tree.
2. `rollback.sql` is destructive and not a default reversal. It backs up rows and drops payment schema, trigger functions and finance columns. The backups' declared privileges do not prove technical/inherited access boundaries; absent or now-blank rows may leave older backup values. There is no restore script. Retention, audit access, verified restoration and any destructive authorization remain separate gates.

## Tests

- `pnpm test`: commission and totals math (JPY, half-up rounding, values above `Number.MAX_SAFE_INTEGER`), currency rule, parsers and formatters, Zod allowlists, server actions (scope, witness, fixed copy, fee currency lock, delete mapping, default prefill), the default prefill rule (currency match, mismatch, JPY), the Financial tab and the artist default commission, static contracts of 007 and its ops files.
- `tests/sql/run-local.sh` is an optional socket-based PostgreSQL 17 runner, not part of CI. The local review instead used in-memory PostgreSQL WASM and a synthetic Auth stub. Neither replaces target catalog readback or proves hosted Auth or PostgREST behaviour.
- `tests/integration` and `tests/e2e` need an authorized synthetic stack.
