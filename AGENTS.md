# Backbeat agent instructions

Scope: this repository and its subdirectories, including delegated agents. Alberto owns architectural decisions. Simone's development tasks do not authorize agents to invent or replace the architecture.

## Before implementation

Read [the agent guide](docs/agents/README.md), its architecture and development contracts, and the relevant recorded decision. Inspect the actual checkout and affected callers/tests. Treat source observations, proposals and Alberto-approved plans as different authorities.

Implement an authorized task within existing contracts or an explicitly approved architectural plan. Ordinary implementation details do not need a new architecture decision. Use the [classification rules](docs/agents/architecture-decisions.md) whenever scope is unclear.

## Git and release workflow

Before editing or publishing, read [the Git and staging workflow](docs/agents/git-workflow.md). New independent work starts from `origin/staging`; feature/fix PRs target `staging`. `main` is the live release branch, not the default destination for feature work. Simone may explicitly authorize a checked PR merge into staging; only Alberto can authorize a live release. Preserve existing stacked PRs until their transition is explicitly coordinated.

## Architectural stop

If the task requires an unapproved architectural choice, print this exact line, preserving the two spaces after `alberto`:

```text
chiedere ad alberto  il piano architetturale
```

Stop the affected implementation. In the same handoff, deliver the complete architecture-request package defined in the classification rules: `REQUEST.md`, `EVIDENCE.md`, `package.json`, and their ZIP attachment or accessible equivalent. A bare question, inaccessible path or promise to prepare the package later is insufficient. Report delivery failure honestly and remain blocked.

Explain the decision needed, current contracts, options, recommendation, impacts, risks, verification and rollback. Recommendations are not approval. Continue only genuinely independent, already-authorized work and identify it explicitly. Do not implement the preferred option, install a new dependency or start a spike while waiting.

Resume only against Alberto's explicit decision for the exact request revision and authorized scope. An experiment PASS, reviewer GO, deadline or silence is not architectural approval. Changed assumptions or scope require a new decision.

## Staging delegation (2026-11-21)

Recorded owner decision: Alberto (`DerekLoadout`) granted Simone full autonomy on `staging` (stated by Simone, 2026-11-21). Staging uses a Supabase database separate from production.

- On `staging`, Simone decides and the agent may implement, **without the architecture stop line or request package**: schema, migrations (additive and destructive), RLS, auth, roles and contracts.
- Preconditions are unchanged: PR to `staging`, `Quality` green on the current head, Codex review clean, and every migration versioned in the repository and described in the PR body (what, why, rollback).
- Migrations are applied to the staging Supabase project only, never to production. Production apply and promotion to `main` remain Alberto's alone; he reviews the full diff, migrations included, at release and can require changes before live.
- The stop line and request package still apply to anything touching `main`, the production database, Vercel/GitHub settings, secrets or billing.
- This does not weaken branch protection or the live-release rules. Where other text in these instructions reserves schema, RLS, auth, role or destructive-data changes to Alberto, this section overrides it for `staging` only.

## Non-negotiable boundaries

Preserve tenant isolation, ordinary-session authorization, DTO privacy, validation semantics, data integrity and honest error/unavailable states. Do not weaken tests, security checks or these instructions to obtain approval or a green run.

Never expose credentials or real user data in requests. Architectural approval alone does not authorize infrastructure changes, destructive data operations, external publication or deployment. Do not infer a live environment from historical documentation.

## Handoff

State architecture classification and its basis, changed paths, actual verification results, unrun checks and remaining gates. Follow the guide's delivery checklist. Never report proposed, dispatched or historically passing work as newly completed.
