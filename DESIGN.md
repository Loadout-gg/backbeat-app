---
name: Backbeat Agent
description: Obra-aligned operational UI on the existing shadcn and Radix foundation.
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
  page-heading:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
rounded:
  control: "calc(0.625rem - 2px)"
  navigation: "0.625rem"
  surface: "calc(0.625rem + 4px)"
spacing:
  compact: "0.5rem"
  row: "0.75rem"
  page: "1.5rem"
---

# Design System: Backbeat Agent

## Overview

Use the operator-confirmed Obra/shadcn foundation as an operational component language, not a new visual identity or a literal dashboard template. The supplied reference establishes white content, inset pale navigation, restrained depth and legible compact lists. The existing logo and neutral palette remain authorities.

This record covers the bounded Agent workspace refinements: M3 shell/dashboard, followed by M4 heading corrections and presentation/accessibility alignment of the existing booking Performance editor. M4 does not authorize new booking capabilities, auth changes or the performer experience. Previously verified M3 geometry remains the shared foundation; editor-specific geometry must pass its own desktop/mobile checks.

## Colors

The frontmatter preserves the existing normative CSS colors from `app/globals.css`. Use background and muted surfaces to separate work areas. Primary actions and selected navigation use neutral foreground/background contrast. Error, focus, disabled and loading semantics must remain distinguishable without color alone. No new brand accent is invented.

## Typography

Retain the existing system UI sans stack used by Tailwind's `font-sans`; do not claim the Type3 PDF fonts identify an exact typeface. Use a tighter operational hierarchy, sentence-case labels and tabular numerals for counts/dates. No new font downloads or typography dependencies.

## Layout

Agent desktop has an inset navigation rail at 15rem, a route-aware header and a flexible main work area. Navigation switches to a modal below 1024px; the dashboard's action rail moves above the work lists below 1280px. Creation actions also precede the lists in DOM reading order. The summary uses three columns from 640px and stacked rows below. Outer gutters use 1rem below 640px and 1.5rem above. A flex-filled content column anchors short-page footers without adding a second viewport height. Long pages scroll naturally. The performer mobile design remains separate.

## Elevation & Depth

Use quiet tonal grouping and existing small neutral shadows for interactive rows or selected controls. Avoid simultaneous heavy borders and broad shadows. No decorative gradients, animated entrances or invented status indicators.

## Shapes

Use the existing radius vocabulary: controls use the control radius, navigation the base radius, and larger groups/rows the surface radius from the frontmatter. This aligns the supplied Obra example without introducing unrelated corner values on each screen.

## Components

- Navigation retains existing Dashboard, Artists and Settings routes. Active location is exposed with `aria-current`; mobile navigation supports keyboard dismissal and focus return.
- Header shows route context and the existing account menu/avatar. Do not present unimplemented notification/close actions as operational controls.
- Metrics expose three supported concepts: events in progress, bookings in progress and artists. An undefined Performance metric must not duplicate the Event count.
- Booking rows show stored venue/address when present and retain Continue setup links and record IDs. Event rows must not invent an end time.
- Empty states explain existing creation paths. Loading and unavailable states are honest; no static demo records are inserted.
- The booking creation dialog remains the established implementation, with its supported fields and persistence behavior unchanged.
- The existing booking editor uses a bounded desktop form, responsive summary/field groups and a wrapping Radix tab group. Preserve supported labels, unavailable controls and draft state across panels. Its supported Update booking action is primary; desktop actions stick to the viewport bottom while mobile actions remain in flow.

## Do's and Don'ts

- Do preserve the approved foundation and real workflows while improving density and hierarchy.
- Do verify desktop, narrow layouts, keyboard/focus, empty/populated states and long content.
- Do retain explicit unavailable notices for unsupported capabilities.
- Don't change data schema, authentication policy, business metric definitions or production configuration in a presentation pass.
- Don't infer a future capability from a screenshot or introduce controls with no behavior.
- Don't make the agent dashboard stand in for the performer mobile product.
