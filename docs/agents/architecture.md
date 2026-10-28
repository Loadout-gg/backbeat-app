# Backbeat architecture and preserved contracts

## Status and source

**Descriptive source baseline, not a new architectural approval.** Inspected at `41d124e47fcf2463ff30ce7e53e981a4bd862aa9` on 2026-10-26. This document maps the existing application and its preservation boundaries. It does not certify current production, database state, feature completeness or a release. See [the decision gate](architecture-decisions.md) before changing a boundary.

## Stack as observed

| Layer | Existing implementation | Source |
|---|---|---|
| Web application | Next.js App Router 16.4.1, React 19.2.8, TypeScript (lock resolves 5.9.3) | [package](../../package.json), [lock](../../pnpm-lock.yaml), [app](../../app/layout.tsx) |
| UI | Existing Tailwind 4/shadcn-style Radix components and Obra-aligned Backbeat design; UI copy in English | [design](../../DESIGN.md), [product](../../PRODUCT.md), [components](../../components/ui/button.tsx) |
| Validation/forms | Zod 4.6.6; React Hook Form lock 7.71.1 and resolver 5.2.2 | [package](../../package.json), [artist schema](../../lib/artist-validation.ts), [booking schema](../../lib/booking-validation.ts) |
| Application backend boundary | Existing Next server actions plus Supabase SSR/browser clients | [workspace actions](../../lib/actions/workspace.ts), [server client](../../lib/supabase/server.ts), [browser client](../../lib/supabase/client.ts) |
| Identity/data | Supabase Auth and Postgres contracts, with RLS/constraints/RPC described by repository migrations | [access contract](../access-foundation.md), [migrations](../../migrations/003_access_foundation.sql) |
| Quality/runtime policy | Node 22.23.4, pnpm 12.3.4, Vitest, runtime-policy tests, Playwright Chrome; existing secret-free CI Quality job | [CI](../../.github/workflows/ci.yml), [package policy](../../pnpm-workspace.yaml), [browser configuration](../../playwright.config.ts) |

Versions are the observed baseline, not a claim that they are the latest or a license to upgrade/downgrade. No Valibot migration or new infrastructure is present in this baseline.

## Existing flow and responsibility boundaries

```text
Auth UI -> provider-native Auth flow
Request -> session/cookie proxy (routing, not business authorization)
Server page/action -> session-bound Supabase client
Workspace-scoped action -> authenticated selected workspace + active membership
Read/write -> explicit scope, projection/validation and business contract
Postgres -> complementary RLS, constraints and specialized bootstrap RPC
Response -> relevant DTO/data or honest error -> client draft/loading/retry UI
```

Business actions live under `lib/actions/`; client/server helpers are deliberately distinct under `lib/supabase/`. Pure validation/formatting lives in the existing `lib/*` modules. Do not introduce a new transport, repository layer, ORM or service extraction merely to reorganize a feature.

### Session, tenant and role semantics

`getCurrentWorkspaceId` authenticates the user, reads that actor's selected workspace from onboarding state, then checks an **active membership in that exact workspace**. No selection routes to onboarding; failed membership rejects rather than selecting a convenient alternative. Business actions derive/filter workspace ownership on the server. Never trust a caller-supplied workspace as authority. [Source: workspace actions](../../lib/actions/workspace.ts).

The proxy refreshes/verifies sessions and preserves refreshed/cleared cookies through redirects. Its onboarding routing is not active-membership authorization. Only the exact static signup-template path has its special Auth bypass. Preserve that narrow scope. [Source: updateSession](../../lib/supabase/proxy.ts).

RLS and application scoping complement each other. Repository business-table policies use active membership; they do not themselves select the user's current workspace or define a complete `master/admin/member` CRUD hierarchy. Creator workspace update/delete policy also exists. Do not invent role-specific permissions from role names. Actual deployed policies/grants require authorized target verification. [Sources: bootstrap policies](../../migrations/001_development_schema.sql), [access migration](../../migrations/003_access_foundation.sql).

The inspected Supabase helpers use the configured public URL/key and ordinary session cookies. This is not proof that live credentials are correctly configured. Never substitute a service-role application client to bypass an authorization failure.

### Workspace creation is a separate atomic contract

`createWorkspace` calls `backbeat_bootstrap_workspace`, not several client-controlled inserts. The migration's RPC validates the confirmed-email actor, serializes per actor, and atomically resolves/creates workspace membership and onboarding selection. It reuses a valid selected workspace or sole active membership; ambiguous, inactive/pending-only and orphan-owned states fail rather than inventing recovery. New permitted ownership is an active Master membership. The migration revokes old direct insertion/onboarding-update paths. [Sources: action](../../lib/actions/workspace.ts), [RPC and grants](../../migrations/003_access_foundation.sql), [tests](../../tests/unit/access-workspace.test.ts).

Profile updates and workspace bootstrap have their own user/RPC contracts. Do not add a prerequisite existing selected workspace to the bootstrap path, which would prevent onboarding. Changing provisioning, recovery or role policy goes to Alberto.

## Contract map

| Area | Preserve | Source / regression anchors |
|---|---|---|
| Artist writes | Runtime allowlist; unknown ownership/ID/timestamp/alias/image-write fields are stripped. Supported omitted/undefined updates stay unchanged. Contact edits preserve the stored note body | [schemas and helpers](../../lib/artist-validation.ts), [createArtist/updateArtist](../../lib/actions/artists.ts), [boundary tests](../../tests/unit/artist-boundary-security.test.ts) |
| Client privacy | Directory and selector DTOs project explicit fields rather than spreading database rows. Full profile readers are separate and are not universally redacted | [directory](../../lib/actions/artist-directory.ts), [getArtists](../../lib/actions/artists.ts), [listPromoters](../../lib/actions/events.ts), [read-contract tests](../../tests/unit/backend-read-contracts.test.ts) |
| Booking updates | Persist `validation.data`, not every property in the wider TypeScript patch interface. Supported venue/main-contact text trims; blank clears to null; omission stays unchanged | [update schema](../../lib/booking-validation.ts), [updateBooking](../../lib/actions/bookings.ts), [booking tests](../../tests/unit/bookings.test.ts) |
| Successful writes | Artist update and booking update/status/delete require an affected row in the authoritative workspace, not just absence of a provider error | [artist update](../../lib/actions/artists.ts), [booking mutations](../../lib/actions/bookings.ts) |
| Completeness | Collection reads advance by actual rows received, use exact counts and deterministic ordering with ID tie-breaks, reject drift/missing/duplicate/inconsistent pages, and finish only at the count. A short nonempty page is not EOF | [readCompleteCollection](../../lib/read-complete-collection.ts), [directory reader](../../lib/actions/artist-directory.ts), [tests](../../tests/unit/complete-collection.test.ts) |
| Failure versus empty | Failed required collections/counts remain failures, not fake empty lists or zeros. `getBookings.failOnError` is compatibility-only; failures reject regardless | [bookings](../../lib/actions/bookings.ts), [dashboard counts](../../lib/actions/dashboard.ts), [page](../../app/dashboard/page.tsx), [tests](../../tests/component/dashboard-read-errors.test.tsx) |
| Metadata links | Defensive view parsing and safe navigation are separate from stored values. Do not rewrite/delete legacy metadata as a rendering fix | [parseSocialLinks/parseDocuments/artistMetadataHref](../../lib/artist-validation.ts), [tests](../../tests/component/artist-metadata-security.test.tsx) |
| Async UI | Preserve drafts, visible failure/retry states, duplicate-submit protection and dialog/session ownership across delayed completions | [creation modal](../../components/dashboard/new-booking-modal.tsx), [booking editor](../../app/dashboard/bookings/[id]/event-booking-client.tsx), [modal regression](../../tests/component/booking-modal-session.test.tsx), [creation recovery](../../tests/component/creation-recovery.test.tsx) |

These are specific contracts, not claims of universal coverage. `updateProfile` does not have the same affected-row witness, `createPromoter` does not currently have a runtime schema, and single-record readers may return null for errors. Do not document every action as uniformly validated/redacted/error-distinguishing. New behavior or hardening must follow its assigned scope, not silently impose a new application-wide contract.

Checked multi-page reads are **not transactional database snapshots**. Stable counts and unique IDs cannot detect every concurrent replacement/reordering. Do not promise snapshot isolation without a separately designed contract.

## Domain semantics that are not implementation preferences

### Money

Artist fee/base rate and booking fee are distinct. Artist `fee` is a finite nonnegative numeric field; derived `base_rate` is not a new stored amount. Zero is real; currency can be legacy/null/free-form text, with USD default only when omitted during creation. No automatic unit or currency conversion is performed. [Source: artist actions](../../lib/actions/artists.ts).

Booking fee is the nullable integer-minor-unit pair `fee_amount_minor` / `fee_currency`. Supported currencies are EUR/USD/GBP with two fractional digits and JPY with none; the technical maximum is 999999999999 minor units. Both fields omitted means unchanged, both null means clear, and an incomplete pair rejects. Excess precision is rejected, not rounded. Do not backfill from artist rate or notes. This is not invoicing, payment, FX or booking confirmation. [Sources: fee helper](../../lib/booking-fee.ts), [update schema](../../lib/booking-validation.ts), [fee migration](../../migrations/004_booking_fee.sql).

### Dates, identifiers and statuses

Booking dates/times are separate calendar-date/time values, not a newly chosen zoned-instant model. `calendarDay` receives an explicit zone; `eventDateParts` constructs UTC dates to preserve the stored calendar day in display. These helpers do not define a general workspace-timezone product policy. Event creation rejects year 0000; do not silently unify its policy with every date schema. [Sources: calendar day](../../lib/calendar-day.ts), [date display](../../lib/event-date-display.ts), [event schema](../../lib/actions/events.ts).

The current UUID-shaped identifier policy deliberately uses `z.guid` where needed for legacy compatibility; replacing it with stricter UUID validation changes acceptance. Preserve normalized output, omission/own-undefined behavior and configured errors, not just happy-path acceptance. [Sources: booking schemas](../../lib/booking-validation.ts), [compatibility tests](../../tests/unit/zod-migration-compatibility.test.ts).

Booking statuses are `in_progress`, `confirmed`, `cancelled`, `completed`; creation starts in_progress. Event creation has its own three-value status contract. These validators do not implement a comprehensive transition graph. Booking creation maps duration zero to null while update preserves zero and supports null; do not normalize that asymmetry as an unsolicited cleanup. [Sources: statuses](../../lib/booking-status.ts), [booking actions](../../lib/actions/bookings.ts), [event actions](../../lib/actions/events.ts).

### Product and UI scope

Preserve the existing Agent desktop foundation, English UI, brand/logo and real workspace data. Performer mobile is a separate incomplete product experience. A disabled control, design illustration or TypeScript field is not proof of supported persistence. Driver/secondary-contact/event-type placeholders are not admitted by the booking write schema. Documents/uploads, extended event lifecycle, invitations/recovery, accounting/payments, public sharing and AI must not be inferred complete from surrounding UI. Use the current [product](../../PRODUCT.md), [design](../../DESIGN.md) and actual schema/action contracts.

`getDashboardStats.bookingsInProgress` is a compatibility zero; the UI derives booking count from its checked list. Do not turn it into a measured statistic or invent a distinct Performance metric from an Event count. [Source](../../lib/actions/dashboard.ts).

## Database, environment and release boundaries

| Repository artifact | Observed meaning | Not permission to do |
|---|---|---|
| [001](../../migrations/001_development_schema.sql) | Fresh synthetic development bootstrap; refuses existing application relations | Replay on a populated or hosted database |
| [002](../../migrations/002_booking_venue_primary_contact.sql) / [003](../../migrations/003_access_foundation.sql) | Guarded, once-only additive development migrations | Assume target identity or repeat/repair partial application by improvisation |
| [004](../../migrations/004_booking_fee.sql) | Explicit target setting, separate development and allowlisted hosted branches, booking RLS and no-existing/partial-column checks | Treat a hosted branch or setting as approval, identity proof or evidence the migration ran |
| Historical `scripts/*.sql` | Historical SQL, not the current safe bootstrap sequence | Compose a new migration sequence or replay them by filename |
| [local runtime](../../ops/local/start.cjs) / [README](../../README.md) | Environment-specific local setup and guards | Recreate a stack, use historical credentials or infer current infrastructure from a local URL |

Actual hosted schema, policies/grants, migration history, Auth/email configuration, storage, release ownership, rollback and production revision were not inspected for this documentation package. Do not claim parity or certification. Schema/source approval, execution authorization and production release remain separate gates.

See [development](development.md) for safe verification and [the architecture request protocol](architecture-decisions.md) whenever a new choice is required.

## Runtime policy after the source snapshot

The current runtime candidate and its release boundaries are documented in
[Node 24 runtime policy](../runtime-node24.md). Read the current runtime pins and
qualification evidence; the older Node 22 snapshot above is historical, not an
instruction to undo an approved upgrade.
