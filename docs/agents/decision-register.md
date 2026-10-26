# Architecture decision register

This register separates owner policy, observed implementation and proposed changes. It is not a mechanism for agents to approve architecture.

| ID | State | Record | Meaning |
|---|---|---|---|
| GOV-001 | OWNER_DIRECTIVE | Alberto's documentation request, 2026-10-26 | Simone's agents must not make independent architectural choices; when a choice is needed, print `chiedere ad alberto  il piano architetturale` and deliver the decision package in the same handoff. Instruction-file installation and runner loading are separate operational steps, not implied by the existence of this register. |
| BASELINE-001 | OBSERVED_SOURCE | [Architecture snapshot](architecture.md), source `41d124e47fcf2463ff30ce7e53e981a4bd862aa9` | Describes existing local implementation to preserve. Not blanket architectural, production or migration approval. |
| EXAMPLE-VALIDATOR | EXAMPLE_NOT_SUBMITTED | [Filled example](examples/validator-replacement/REQUEST.md) | Demonstrates the required package using real bounded comparison findings. Not an open request, approved decision or instruction to optimize/migrate. |

No new application-architecture decision is approved by this documentation package. Existing owner-approved plans may exist elsewhere; resolve their actual authority and scope instead of treating their absence here as permission to invent one.

## Add a real request/decision

1. Create a uniquely named revision under `docs/agents/requests/` using the [gate and templates](architecture-decisions.md).
2. Freeze and deliver the request with its manifest/ZIP integrity. Do not rewrite delivered bytes.
3. Record Alberto's genuine decision separately under `docs/agents/decisions/`, with the exact request revision/hash, approval evidence, allowed execution and exclusions. The directories are future output locations; no real requests are pre-created here.
4. Add a row pointing to the actual records. Mark requested, approved, rejected, deferred or superseded only as supported by the owner evidence. A reviewer may advise, not approve on Alberto's behalf.
5. A subsequent change in assumptions, target, dependencies or scope needs a new revision/decision; keep the previous record auditable.

If the supplied decision refers to a different source or several alternatives ambiguously, request the missing clarification before implementation. Never invent a signature or retroactively call an experiment an approval.
