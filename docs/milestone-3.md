# Milestone 3: local Agent shell and dashboard

## Scope

A bounded presentation and interaction refinement on the existing Obra/shadcn/Radix foundation. No package migration, schema change, production operation, GitHub publication or performer-mobile implementation.

The authenticated server layout now delegates presentation to `DashboardShell`. Existing auth checks and server actions remain unchanged. Desktop navigation is inset; below the large breakpoint it becomes a labelled Radix modal menu with Escape and selection dismissal. The account avatar, Settings and Sign out remain available. Header text reflects list, detail, create and edit routes without adding a duplicate page heading.

The dashboard presents three supported metrics, real stored booking venue/address, semantic lists and useful empty states. It no longer presents an undefined Performance metric as a duplicate Event count or invents an event end time. Existing booking creation uses one dashboard-owned dialog, and shared QuickActions still works standalone. Booking and event rows preserve their existing props and destinations.

## Intentional differences from the example PDF

The supplied Obra board is a visual reference, not authorization to fabricate data or activate every control. Unsupported notification/close controls and unavailable footer destinations are not presented as working actions. Booking View all stays on its existing route while the conflicting flow-board instruction is unresolved. Real creation actions precede work lists in DOM order and move above them in narrow layouts. Short dashboards fill the viewport and anchor their footer; long content scrolls normally.

## Preserved contracts

- M2 booking fields, validation, explicit clears, failed-save draft retention and retry.
- Record IDs, workspace scoping, RLS and existing local-only transport guards.
- Existing artist, booking and event routes and supported creation behavior.
- All service/volume identities and the synthetic Development marker.
- No real data, production credentials, external email, new analytics or public routing.

## Verification entry points

- `tests/component/m3-shell.test.tsx`: accessible navigation/account controls and route context.
- `tests/component/m3-dashboard.test.tsx`: truthful metrics, calendar dates, stored metadata, semantics and existing dialog compatibility.
- `tests/component/m3-layout.test.tsx`: authenticated server-layout integration and redirect/fallback preservation.
- `tests/e2e/agent-shell.spec.mjs`: real isolated Chrome, synthetic fixture, desktop/tablet/mobile layout, keyboard navigation, avatar/account actions and saved M2 data.
- `tests/e2e/core-booking.spec.mjs`: unchanged full artist/booking save, reload, clear, rejection and retry regression.

Execution receipts and rendered evidence live outside the repository under `../development/milestone-3/`. Historical test results are not a substitute for rerunning the current candidate. Use the guarded local runner; do not copy credentials into commands or files.

## Remaining boundaries

This does not implement booking conversion, extended event details/sharing, travel, accommodation, finance, documents, notifications, invitation/recovery flows, performer mobile or AI. The existing dashboard server still conflates some read failures with empty results. Existing artist-edit dialog-description warnings, M2 F15 repeat-write weakness and concurrent-editor protection remain separate hardening/release gates. No claim of full-product responsive or accessibility clearance is made.
