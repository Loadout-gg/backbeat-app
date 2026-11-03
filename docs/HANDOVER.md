# Backbeat handover

Read this first when picking up work, then `AGENTS.md` and `docs/agents/README.md`. Update it at the end of every PR.

## Current state (2026-10-28)

- `main` at `7e0db2b`: Node 24.22.1 runtime (`docs/runtime-node24.md`), pnpm 12.3.4.
- All CI steps pass locally on Node 24.22.1: install, typecheck, lint, 984 unit/component tests on the #14 head (961 on `7e0db2b`), 28 runtime tests, placeholder build, `next start` smoke test, both dependency audits.
- Not run locally: integration and e2e suites. They need an authorized synthetic environment.
- No open issues and no other open PRs when #12 was opened.
- Open stacked PR #13 on `docs/handover-backlog` (#12): R4, R6, R7, R10 in review; 968 unit/component tests on that branch.

## How work flows

1. Pick the next item from `docs/BACKLOG.md`. Resolve its "Needs first" with the responsible owner: Simone for non-security product/UX/copy/visual scope; Alberto for product security and architecture-reserved choices. Architectural decisions use the request package in `docs/agents/architecture-decisions.md`.
2. Follow [the approved Git and staging workflow](agents/git-workflow.md): new independent `fix/<slug>` or `feat/<slug>` branches start from up-to-date `origin/staging`. Preserve and coordinate existing PR stacks; no automatic rebase or retarget. Keep changes small, run applicable checks, and update docs in the same PR.
3. Open feature/fix PRs explicitly to `staging`, with the handoff from `docs/agents/development.md`: classification, changed files, real command outcomes, `NOT_RUN`, open decisions. After opening, request `@codex review`; request a fresh review after corrective pushes.
4. Simone (with Claude) checks scope, architecture contracts, tests, Quality and the Codex verdict on the current head. A green check or review is not merge authorization. Staging integration requires explicit authorization under `docs/agents/git-workflow.md` and a post-merge deployment check.
5. Only Alberto can authorize a release toward `main`/live. Follow the approved release and reverse-synchronization procedure; no direct pushes or CI bypasses.
6. Update `docs/BACKLOG.md` status and this file.

Decision owners (from 2026-10-30): Alberto reviews product security; Simone decides UX, copy, visual and other non-security product scope. Architecture-reserved decisions in AGENTS.md stay with Alberto.

## Open questions for Alberto

- First task: one small PR with R4, R6, R7 and R10?
- Who reviews PRs, and are there requirements beyond green CI?
- Order for R1-R3, R5, R8, R9 and for the candidate features in the backlog.
- Is the hosted Supabase project referenced by migration 004 (`jttrznlbbjyufzyqmzzs`) staging or production?
- Fix V1-V3 now, or leave visual consistency for later?

## Log

| Date | PR | What changed |
|---|---|---|
| 2026-10-28 | #12 | Added `docs/BACKLOG.md` and `docs/HANDOVER.md` from a full code read at `7e0db2b`; C1 added from the CI annotation on #12 |
| 2026-10-28 | #13 | R4, R6, R7, R10: bookings list shows stored venue, new-event artist list shows stage names, events read failure shows its own alert, dated Financial notes in milestone-4 and currency-display docs; R11 added to the backlog (events list artist name, needs a read-projection decision); Codex review step added to the workflow; review fixes: redirects propagate, retry action on events error |
| 2026-10-28 | #14 | V3: artist wizard, new event and login use theme tokens instead of raw palette colours; login errors are announced with fixed copy and never show the provider message; V7 added (remaining raw black/white); V7 folded in (panels bg-card, toast primary tokens); review fix: login → confirmation keeps the entered email |
| 2026-10-29 | #15 | R12: bookings list and artist profile calendar let the `/onboarding` redirect propagate instead of showing their read error (`unstable_rethrow`, as R7); 987 unit/component tests; R13 added (no retry action on those two error states) |
| 2026-10-30 | #16 | R13: bookings list and artist profile calendar read errors get a retry button that re-runs the server reads, through a shared `RetryButton` the events page now uses too (same label); decided by Simone; decision owners line added to "How work flows"; 991 unit/component tests |
| 2026-10-30 | #17 | V5: Title Case UI labels to sentence case (case only for visible text and the Quick actions accessible name; roles, associations, structure and logic unchanged; DJ, genre names and example names kept), tests and e2e specs follow the new text; decided by Simone; 991 unit/component tests |
| 2026-10-30 | #18 | V2: all three unused next/font loaders (Geist, Geist Mono and Source Serif 4) removed; --font-serif now uses the system serif stack, sans unchanged; decided by Simone; author-reported build/preload evidence in PR #18 and 991 unit/component tests |
