# Backbeat backlog

Single list of known work. Nothing here is approved: an item moves to `Ready` only when its "Needs first" is resolved by Alberto. Architectural items follow `AGENTS.md` (stop line + request package). Effort and impact are zone estimates from a code read at `7e0db2b`, not measurements.

Status values: `Proposed` (not yet discussed) · `Needs decision` · `Ready` · `In progress` · `In review` (PR open) · `Done` · `Dropped`.

## Features

| ID | Item | Effort | Impact | Needs first | Status |
|---|---|---|---|---|---|
| F1 | Booking lifecycle: status control in the editor, transition rules, status filter on the list. Wires the unused `updateBookingStatus` (includes R1) | Medium | High | Transition graph (or explicit "any transition") | Needs decision |
| F2 | Promoter directory: list, create, edit pages; Zod schema for `createPromoter`; `updatePromoter`; "Add promoter" from new event (includes R2) | Medium | High | Validation rules, menu placement, person vs company | Needs decision |
| F3 | Travel and Accommodation tabs: legs and stays as booking child tables | High | High | Request package: schema, zoned date/time contract, travellers | Needs decision |
| F4 | Team and invitations: invite flow, member management, role permission matrix + RLS, multi-workspace selection | Very high | High | Request package: roles, invite channel, production email, data on removal | Needs decision |
| F5 | Booking to event conversion ("Complete and create event") | High | Medium | Conversion rule and booking-event link | Proposed |
| F6 | Secondary contact, driver, lineup, event type, expected audience (fields drawn and disabled in the editor) | Medium | Medium | Schema | Proposed |
| F7 | Artist documents: upload, storage, permissions, preview | High | Medium | Request package: storage service | Proposed |
| F8 | Public event sharing via `events.public_token` | High | Low | Request package: security | Proposed |
| F9 | Artist CSV export and artist deletion (deleting an artist cascades to its bookings today) | Low | Low | Export format, deletion rules | Proposed |

## Code review findings

| ID | Finding | Where | Classification | Needs first | Status |
|---|---|---|---|---|---|
| R1 | Booking status cannot be changed from the UI | `lib/actions/bookings.ts` | Contract | See F1 | Needs decision |
| R2 | Promoters cannot be created; `createPromoter` is unused and unvalidated | `lib/actions/events.ts` | Contract | See F2 | Needs decision |
| R3 | Events and Bookings are missing from the main navigation | `components/dashboard/sidebar.tsx` | Design (`DESIGN.md` fixes three routes) | Design approval | Needs decision |
| R4 | Bookings list passes empty venue/address although they are stored | `app/dashboard/bookings/page.tsx` | `WITHIN_EXISTING_CONTRACT` | Nothing | In review |
| R5 | Artist profile "Latest events" is hard-coded to "No events yet." | `artist-profile-client.tsx` | Product detail | Which events, how many | Needs decision |
| R6 | New event artist selector shows the real name, the rest of the app the stage name | `app/dashboard/events/new/page.tsx` | `WITHIN_EXISTING_CONTRACT` | Nothing | In review |
| R7 | Events page read failure falls back to the generic "Dashboard unavailable" | `app/dashboard/events/page.tsx` | `WITHIN_EXISTING_CONTRACT` | Nothing | In review |
| R8 | `updateProfile` has no name validation and no affected-row witness | `lib/actions/workspace.ts` | Contract | Validation rule | Needs decision |
| R9 | Dashboard counts promoters on every load but never shows them | `lib/actions/dashboard.ts` | Contract (DTO field) | Approval to drop the field | Proposed |
| R10 | Milestone docs are partly stale (milestone 4 says Financial is coming soon; the booking fee lives there) | `docs/milestone-4.md` | Documentation | Nothing | In review |

## Visual consistency and accessibility

| ID | Finding | Classification | Needs first | Status |
|---|---|---|---|---|
| V1 | Favicons in `public/` are v0 placeholders; layout still declares `generator: "v0.app"` | Brand | Backbeat favicon artwork | Needs decision |
| V2 | Geist, Geist Mono and Source Serif 4 are loaded but unused | Design | Approval to remove | Proposed |
| V3 | Raw Tailwind palette colours (`gray-50`, `red-500`, `blue-500`) in artist wizard, new event and login; login error has no `role="alert"` and shows the raw Supabase message | `WITHIN_EXISTING_CONTRACT` | Nothing | Proposed |
| V4 | Focus ring about 2.6:1 on background (target 3:1); `muted-foreground` on solid `muted` 4.3:1 (target 4.5:1) | Design token | Approval to adjust two tokens | Needs decision |
| V5 | Title Case labels ("New Booking", "Quick Actions", "Add Artist", "Full Name") among sentence case | Copy | Approval | Proposed |
| V6 | Dark theme tokens defined but never activated | Product | Product decision | Proposed |

## CI and tooling

| ID | Finding | Classification | Needs first | Status |
|---|---|---|---|---|
| C1 | CI annotation on #12: `actions/checkout`, `actions/setup-node` and `pnpm/action-setup` are pinned to SHAs that target Node 20; GitHub forces them onto Node 24 and is deprecating Node 20 for actions | CI change (`architecture-decisions.md`: material CI change) | Approval to bump the pinned action SHAs | Needs decision |
