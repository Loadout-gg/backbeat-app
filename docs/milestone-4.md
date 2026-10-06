# Milestone 4: local heading and booking-editor refinement

## Scope

Continue the approved Obra/shadcn/Radix Agent workspace without changing production, shared staging, schema, dependencies or booking business flows.

The prerequisite heading correction gives the Artists list a visually hidden page-owned h1 and promotes Settings' existing heading to h1. Three component cases cover actual pages inside the authenticated shell, including empty/populated Artists.

## Existing Performance editor

- Shrinkable, bounded editor surface and wrapping artist summary for large desktop and narrow layouts.
- Responsive date/time, venue, lineup, driver and contact groups; supported input labels for Start time, Duration and Note.
- Named Radix tablist with six existing labels, keyboard Arrow/Home/End navigation and labelled panels. Draft state remains outside the tab panels and survives tab switches. Internal values contain no spaces so generated ARIA ID references remain valid; visible labels are unchanged.
- Sticky desktop action footer; narrow actions remain in flow. Update booking is the supported primary action. Complete and create event remains disabled.
- A stored EUR zero fee displays €0; absent fee remains N/A. This changes display only, not pricing, finance or currency semantics.

Existing update/delete callbacks, payloads, date/time helpers, routes and the M2 booking-save regression tests are preserved. Fixed date, explicit blank clears, returned/thrown errors, retained drafts and retry keep their existing meanings.

## Availability boundary

Event type, expected audience, lineup, driver and secondary contact controls remain disabled and explicitly unsaved. Financial, Travel, Accommodation, Documents and Artist contacts panels remain coming soon. No event conversion, new tab functionality, sharing, unsaved-change interception or concurrency implementation is added.

## Display matrix and verification

Large desktop screens are the primary context. The Chrome matrix covers 1440×960, 1920×1080, 2560×1440, 2560×1600 and 3840×2160 at DPR 1, plus 1920×1080 at DPR 2. Intermediate/narrow regressions use 1024×768, 390×844 and 320×800. These are browser viewport/density simulations, not physical-monitor or real-phone certification.

`tests/e2e/booking-editor.spec.mjs` checks unique viewport coverage, field bounds, bounded readable form width, desktop action reachability, labelled inputs, keyboard tabs, draft retention, invalid-email rejection, retry, persistence/clears/reload and the real heading routes. The existing full booking journey and synthetic demo audit remain separate regression gates.

Receipts, screenshots, runtime/source hashes and independent review records are under `../development/milestone-4/`. Consult those records for the exact verified candidate; this document describes the contract and implementation, not a substitute for execution evidence.

## Known boundaries

Existing server read-error/empty conflation, artist-edit dialog-description warnings, F15 fixed-value repeat-write weakness and missing optimistic concurrency remain separate hardening gates. Existing delete failure behavior is unchanged. No whole-product responsive/accessibility or release readiness claim is made.
