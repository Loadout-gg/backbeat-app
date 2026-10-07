# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Music-agency operators manage artists, bookings and events. The supplied Artist reference describes a separate performer-facing mobile experience; that experience is not implemented by the current Agent dashboard.

## Product Purpose

Backbeat is an artist-management CRM for music agencies. The operational job is to keep artist records and performance bookings understandable and editable, with dates, venue and contact information attached to the correct record and workspace.

## Operating Context

The active implementation is Next.js, React, Tailwind and shadcn-style components backed by Radix and Supabase. Development runs in the existing isolated Openship Development stack with marked synthetic data. The online/production app and historical restored data are outside local iteration authority.

## Capabilities and Constraints

- Existing local flows include account/workspace setup, artist create/edit, and booking create/edit/delete.
- Existing bookings support date changes and an optional per-booking fee; the fee is independent of the artist rate and does not confirm or record payment.
- Local M2 supports optional booking venue name/address and primary-contact name/phone/email, including explicit clears, validation and failure/retry behavior.
- Workspace isolation, record IDs, supported field semantics and honest unavailable states must survive presentation changes.
- Booking conversion, extended event details, travel, accommodation, documents, invitations/recovery and performer mobile are separate incomplete capabilities. AI is explicitly work in progress.
- Performance-versus-event metric definitions remain unresolved. Do not present one count as two different business metrics.

## Brand Commitments

Preserve the Backbeat name and existing logo artwork. The operator confirmed continuing with Obra + shadcn as the foundation, with a Backbeat-specific operational interface rather than copying a generic dashboard template. Product UI remains English. A separate visual identity or library migration is not approved.

## Evidence on Hand

Eight hash-verified PDF boards live in `../development/frontend-reference-intake/originals/`. The corresponding comparison and source index are in that intake directory. The current design example is `UI Example (ObraUI)/UI _ Agent - Dashboard.pdf`; flow boards contain behavior notes, including some conflicts with the styled example. The PDFs do not supply an editable token/font contract.

## Product Principles

- Keep the next operational action and relevant record state legible.
- Use real workspace data; never replace it with design-demo values.
- Distinguish functional support from illustrative or disabled controls.
- Preserve working data behavior while improving presentation.
- Treat Agent desktop and performer mobile as different jobs, not one layout at two widths.
