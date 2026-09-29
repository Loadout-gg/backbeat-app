# Milestone 2: booking venue and primary contact

## Scope
The signed-in operator can edit, save and clear five optional values on one booking: venue_name, venue_address, contact_name_main, contact_phone_main and contact_email_main. Existing booking creation remains minimal; old/new bookings may have all five values NULL. Existing UI layout and time/status logic remain in place.

## Persistence contract
- Fields belong to a booking, not a reusable directory or artist profile.
- App updates trim outer whitespace, convert blank to NULL and preserve omitted fields. Phone strings keep their international punctuation and extension format.
- Nonblank email must validate. Length limits: venue name 200, address 1000, primary name 200, phone 100, email 254. App limits count JavaScript UTF-16 code units; database limits count PostgreSQL characters, so the app can be stricter for supplementary Unicode symbols.
- The update schema is the write allowlist. Current user and active workspace resolution, ID/workspace predicates and affected-row confirmation remain mandatory.
- Error handling retains the draft, displays an error and permits retry. Failed writes must not show success or alter stored values.

## Development migration
Migration 002 is additive and transactional: exact synthetic-development marker, existing bookings RLS, absent target-column checks, five nullable text columns and length constraints. It neither resets/imports data nor changes RLS/grants. Email format/trim normalization is the application contract; raw REST is still subject to RLS and database length bounds, not a SQL email-format constraint.

Migration 001 is the historical fresh-only bootstrap and must not be rerun. Migration 002 deliberately fails on repeated or partial prior application; inspect instead of bypassing its guard. The existing Development instance has received 002. A fresh authorized stack requires the two migrations in order. A dry-run transaction with ROLLBACK and a marker-negative rollback-only probe preceded actual application; old booking values, grants and policy metadata were checked unchanged.

Rollback is to the prior compatible app while retaining the additive NULL-capable columns, not destructive column drops. No production migration plan or equivalence is implied.

## Acceptance gate
1. Null/old records open and remain editable.
2. Five values persist and clear after hard reload and independent readback.
3. Omitted server patch fields remain unchanged.
4. Invalid nonblank email and oversized values fail safely.
5. Returned/thrown save failures retain draft and permit retry.
6. Foreign-workspace users cannot read or change new values.
7. Event type/audience, lineup/driver and secondary contact stay disabled with truthful notices.
8. Existing artist, booking/time, calendar and persistent-demo regressions pass.
9. Current runtime hashes match source; independent review precedes local commits.

Current execution evidence and the eventual gate verdict live in `../development/milestone-2/`, not the historical M1 report. RED/GREEN evidence is in execution logs, not standalone failing-test Git commits.

## Exclusions
Secondary contact, event type/audience, lineup, driver/transport, financial/travel/accommodation/document workflows, shared directories, redesign, new dependencies and production/staging/publication are excluded. No concurrency/versioning feature is added. Existing dependency advisories, dialog warnings, footer routes and live production policy verification remain separate. Only the existing isolated Openship Development stack and synthetic fixtures are authorized.
