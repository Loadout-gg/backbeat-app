# Backbeat handover

Read this first when picking up work, then `AGENTS.md` and `docs/agents/README.md`. Update it at the end of every PR.

## Current state (2026-10-28)

- `main` at `7e0db2b`: Node 24.22.1 runtime (`docs/runtime-node24.md`), pnpm 12.3.4.
- All CI steps pass locally on Node 24.22.1: install, typecheck, lint, 984 unit/component tests on the #14 head (961 on `7e0db2b`), 28 runtime tests, placeholder build, `next start` smoke test, both dependency audits.
- Not run locally: integration and e2e suites. They need an authorized synthetic environment.
- No open issues and no other open PRs when #12 was opened.
- Open stacked PR #13 on `docs/handover-backlog` (#12): R4, R6, R7, R10 in review; 968 unit/component tests on that branch.

## How work flows

1. Pick the next item from `docs/BACKLOG.md`. If its "Needs first" column names a decision, get it from Alberto before coding; architectural decisions use the request package in `docs/agents/architecture-decisions.md`.
2. Branch `fix/<slug>` or `feat/<slug>` from an up-to-date `main`; smallest change; tests; all CI steps locally; docs updated in the same PR.
3. Open the PR to `main` with the handoff from `docs/agents/development.md`: classification, changed files, commands with real outcomes, `NOT_RUN`, open decisions. Right after opening it, comment `@codex review` (`gh pr comment <n> --body "@codex review"`).
4. First-level review by Simone (with Claude) against `docs/agents/architecture.md` contracts, scope, tests, green CI and the Codex verdict. Fix findings in the same PR and comment `@codex review` again after each fix until Codex reports no major issues on the latest commit.
5. Alberto reviews and merges. Contributors never push or merge to `main`.
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
| 2026-10-30 | #17 | V5: Title Case UI labels to sentence case (case only, no copy, aria or structure change; DJ, genre names and example names kept), tests and e2e specs follow the new text; decided by Simone; 991 unit/component tests |
| 2026-10-30 | #18 | V2: unused Geist and Geist Mono `next/font` loaders removed (build no longer emits or preloads them); Source Serif 4 kept because the `--font-serif` token still names it; decided by Simone; 991 unit/component tests; Source Serif 4 removed, `--font-serif` now the system serif stack |
