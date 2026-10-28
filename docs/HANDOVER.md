# Backbeat handover

Read this first when picking up work, then `AGENTS.md` and `docs/agents/README.md`. Update it at the end of every PR.

## Current state (2026-10-28)

- `main` at `7e0db2b`: Node 24.22.1 runtime (`docs/runtime-node24.md`), pnpm 12.3.4.
- All CI steps pass locally on Node 24.22.1: install, typecheck, lint, 961 unit/component tests, 28 runtime tests, placeholder build, `next start` smoke test, both dependency audits.
- Not run locally: integration and e2e suites. They need an authorized synthetic environment.
- No open issues; #12 (this handover and backlog) is the first contributor PR.

## How work flows

1. Pick the next item from `docs/BACKLOG.md`. If its "Needs first" column names a decision, get it from Alberto before coding; architectural decisions use the request package in `docs/agents/architecture-decisions.md`.
2. Branch `fix/<slug>` or `feat/<slug>` from an up-to-date `main`; smallest change; tests; all CI steps locally; docs updated in the same PR.
3. Open the PR to `main` with the handoff from `docs/agents/development.md`: classification, changed files, commands with real outcomes, `NOT_RUN`, open decisions.
4. First-level review by Simone (with Claude) against `docs/agents/architecture.md` contracts, scope, tests and green CI. Fix findings in the same PR.
5. Alberto reviews and merges. Contributors never push or merge to `main`.
6. Update `docs/BACKLOG.md` status and this file.

## Open questions for Alberto

- First task: one small PR with R4, R6, R7 and R10?
- Who reviews PRs, and are there requirements beyond green CI?
- Order for R1-R3, R5, R8, R9 and for the candidate features in the backlog.
- Is the hosted Supabase project referenced by migration 004 (`jttrznlbbjyufzyqmzzs`) staging or production?
- Fix V1-V3 now, or leave visual consistency for later?

## Log

| Date | PR | What changed |
|---|---|---|
| 2026-10-28 | #12 | Added `docs/BACKLOG.md` and `docs/HANDOVER.md` from a full code read at `7e0db2b` |
