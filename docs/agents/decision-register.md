# Architecture decision register

This register separates owner policy, observed implementation and proposed changes. It is not a mechanism for agents to approve architecture.

| ID | State | Record | Meaning |
|---|---|---|---|
| GOV-001 | OWNER_DIRECTIVE | Alberto's documentation request, 2026-10-26 | Simone's agents must not make independent architectural choices; when a choice is needed, print `chiedere ad alberto  il piano architetturale` and deliver the decision package in the same handoff. Instruction-file installation and runner loading are separate operational steps, not implied by the existence of this register. |
| BASELINE-001 | OBSERVED_SOURCE | [Architecture snapshot](architecture.md), source `41d124e47fcf2463ff30ce7e53e981a4bd862aa9` | Describes existing local implementation to preserve. Not blanket architectural, production or migration approval. |
| EXAMPLE-VALIDATOR | EXAMPLE_NOT_SUBMITTED | [Filled example](examples/validator-replacement/REQUEST.md) | Demonstrates the required package using real bounded comparison findings. Not an open request, approved decision or instruction to optimize/migrate. |
| STAGING-DELEGATION | OWNER_DIRECTIVE | `AGENTS.md` "Staging delegation (2026-11-21)", stated by Simone | On `staging` and the staging database Simone decides schema, migrations, RLS, auth, roles and contracts. Production and `main` stay Alberto's. |
| BOOKING-D0-P1 | STAGING_ONLY_DECIDED_BY_SIMONE | [Booking lifecycle](../booking-lifecycle.md); reference plan ARCH-20261114-booking-domain r02 (outside the repo, never approved by Alberto); PR `feat/booking-d0-p1` | Taken by Simone on 2026-11-21 under STAGING-DELEGATION, following the r02 recommendations: D0.1 B (child tables, none built yet), D0.2 A (`UNIQUE (workspace_id, id)` on bookings), D0.3 B (app + database trigger), D0.4 B (compare-and-set on status), D0.5 A (all active members, no policy change), D0.6 B deferred to P2, D1.1 B (add `hold`, `option`, no row rewrite), D1.2 graph as proposed, D1.3 B (`hold_expires_on`, expiry derived at read), D1.4 B (derived hold rank), D1.5 A (soft conflict notices), D1.6 A (no history), D1.7 A (manual completion). Not a production approval: Alberto reviews the full diff and the migrations at release and can require changes. |
| BOOKING-D0-P1-DEVIATIONS | STAGING_ONLY_DECIDED_BY_SIMONE | Same PR | Choices beyond or against r02, all reversible, taken by Simone on 2026-11-21: (1) D1.2 "today" reference, which r02 had left to Alberto: strict `date <= today` in the app calendar zone, `date <= CURRENT_DATE + 1` (UTC) as database backstop; (2) D0.7: migrations are idempotent instead of once-only, behind an explicit target setting bound to the matching synthetic marker (`backbeat-dev` / `development` locally, `backbeat-staging` / `staging` on staging; a database without the marker table, such as production, is refused). Observed fact, open for Alberto: 004 is applied on staging although its guard has no path for the staging marker; (3) inserts are restricted to `in_progress`; (4) a completed booking cannot move to a future date; (5) `updateBooking` rejects `status`; (6) booking actions return fixed error copy (backlog R16, previously waiting for Alberto's product-security decision). |
| AGENT-LANGUAGE-EN | DECIDED_BY_SIMONE | [Git and staging workflow](git-workflow.md) "Language"; PR `fix/dashboard-promoters-favicon-tokens` | Decided by Simone on 2026-11-23: agents reply in English only, confirmations and handoffs included; `git-workflow.md` translated to English with no rule change. The `AGENTS.md` stop line stays verbatim. Alberto reviews at release. |

No new application-architecture decision is approved by Alberto in this documentation package. Existing owner-approved plans may exist elsewhere; resolve their actual authority and scope instead of treating their absence here as permission to invent one.

## Add a real request/decision

1. Create a uniquely named revision under `docs/agents/requests/` using the [gate and templates](architecture-decisions.md).
2. Freeze and deliver the request with its manifest/ZIP integrity. Do not rewrite delivered bytes.
3. Record Alberto's genuine decision separately under `docs/agents/decisions/`, with the exact request revision/hash, approval evidence, allowed execution and exclusions. The directories are future output locations; no real requests are pre-created here.
4. Add a row pointing to the actual records. Mark requested, approved, rejected, deferred or superseded only as supported by the owner evidence. A reviewer may advise, not approve on Alberto's behalf.
5. A subsequent change in assumptions, target, dependencies or scope needs a new revision/decision; keep the previous record auditable.

If the supplied decision refers to a different source or several alternatives ambiguously, request the missing clarification before implementation. Never invent a signature or retroactively call an experiment an approval.
