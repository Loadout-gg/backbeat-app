---
version: 1
slug: "app-dashboard-bookings-id-event-booking-client-tsx"
primary_target: "app/dashboard/bookings/[id]/event-booking-client.tsx"
related_targets: ["app/dashboard/bookings/[id]/page.tsx"]
---

# Booking Performance editor

Mode: Operate.

## Job and authority
Agency operators inspect a booking and update its supported performance time, duration, venue, primary contact and note without losing a draft or confusing disabled roadmap controls for working functionality.

This is an expansion of the approved neutral Obra/shadcn workspace into an existing editor, not a new visual world. Source: the Performance panel in Agent flow - New Booking.pdf, including the fixed-date and bottom-CTA notes. M3 establishes the shared shell/tokens. Preserve section grouping and product copy; adapt composition to narrow screens rather than reproducing a fixed-width modal inside a page.

## Observed baseline defects
Real isolated Chrome on the M3 deployment recorded a date/time group whose End time container extends beyond the 1024px viewport. At 390 and 320px the document grows to 682px, pushing supported time/contact/note fields offscreen. The baseline also lacks programmatic time/note labels and a true keyboard-operable tablist. A zero stored artist fee displays N/A.

## Direction
Use a shrinkable page surface and summary, responsive form grids, clear section hierarchy, full-contrast active labels and a responsive tab group that wraps at narrow widths. Preserve the six tab destinations and coming-soon panels. Keep Update booking operationally primary; completion remains disabled. Desktop actions remain reachable at the viewport bottom, while narrow layouts can keep actions in-flow to avoid covering fields. No decorative motion or new palette/font.

## Preserve
M2 field identities, explicit clears, validation, save payload, draft retention and retry; fixed booking date; existing start/duration/end-time math; close/back; delete/cancel; disabled fieldsets and driver checkbox. Do not implement unavailable features or redesign booking creation. EUR zero-fee display is a presentation correction only, with a failing test before changing it.

## Verification
TDD for semantics and display corrections; existing M2 tests unchanged. Large desktop layouts are primary: Chrome checks 1440×960, 1920×1080, 2560×1440, 2560×1600 and 3840×2160 at DPR 1, plus 1920×1080 at DPR 2. Keep 1024×768, 390×844 and 320×800 as regressions. Check readable form bounds, normal type sizes, balanced spacing, field bounds, keyboard tabs, draft persistence, save/error/retry/clear/reload, disabled states and action reachability. Include the actual Artists/Settings page-heading correction in the journey. Finish with full regressions, exact source/runtime hashes and independent code/pixel review. No production or shared staging.
