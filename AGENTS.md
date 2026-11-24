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

## Staging decision authority

On staging, follow [r02](docs/agents/decisions/GOV-20261123-STAGING-REVISION-r02.md) for points 1, 2, 4 and 5. For point 3 follow [Alberto’s r03 decision](docs/agents/decisions/GOV-20261123-POINT3-R03.md). Neither r01 nor #25 is current authority.

- Simone owns ordinary product/UX and may merge those PRs after current-head Quality and the required clean review, without waiting for an owner batch. Classify by effect, not file type. Keep normal PRs to `staging`, green `Quality` and clean current-head Codex review. Version each migration in the repository and describe what, why and rollback in the PR.
- For ordinary, non-destructive migrations within existing contracts, Simone may prepare the script. Alberto authorizes its exact bytes and staging target. Simone may trigger only a verified path bound to both. No such path is certified here; no manual SQL or privileged credentials for this purpose.
- For sensitive work, use the [point 3 rule below](#point-3-functional-visibility-and-security). Production apply and promotion to `main` remain Alberto’s alone. Branch protection and the architecture stop remain in force.
- Split mixed PRs only if each intermediate state is safe. Otherwise Simone may merge the combined PR only after Alberto clears the exact commit and rollout order; a merge by Simone cannot substitute for owner-controlled application of a reserved change.
- Batch ready reserved items by PR/head, migration digest and target where applicable, owner, operation and order. Changed inputs invalidate that item's clearance. Address active risks immediately. This policy approves no feature PR, migration or release.

### Point 3: functional visibility and security

- Simone decides functional read/write needs by role within an already-approved scope: actor, data, operation, tenant or booking scope, and product reason. This is not permission to implement a reserved change, broaden access or activate it.
- Alberto retains explicit approval **before activation** of new or expanded sensitive access, any destructive operation and any reserved security change (including Auth, roles/membership, RLS/grants, isolation, sensitive-data exposure/storage, external disclosure, retention/restore, secrets, infrastructure and workflow). Bind approval to exact candidate, actors, data and operations, staging target and order; a reserved effect of merge or automatic deployment is not exempt. Alberto records the reason for a refusal; silence is not approval.
- Simone may propose a patch. Alberto controls technical enforcement, verifies the exact candidate and applies reserved changes. No credentials, generic SQL or runner are conferred. The ordinary-migration and mixed-PR/batch rules above and the architecture stop line still apply.
- Preserve existing in-workspace travel-document reads for active agency members and Simone's choice of representation. No document write, deletion, new disclosure, retention term or storage rollout is approved. A promoter is external, not an agency member: any separately approved access is limited to the specifically assigned booking(s) and approved fields/operations, without implied travel-document access. No finance roles, payment grants, migrations `007`/`008`/`009`, `main` or production activity are authorized.

## Non-negotiable boundaries

Preserve tenant isolation, ordinary-session authorization, DTO privacy, validation semantics, data integrity and honest error/unavailable states. Do not weaken tests, security checks or these instructions to obtain approval or a green run.

Never expose credentials or real user data in requests. Architectural approval alone does not authorize infrastructure changes, destructive data operations, external publication or deployment. Do not infer a live environment from historical documentation.

## Handoff

State architecture classification and its basis, changed paths, actual verification results, unrun checks and remaining gates. Follow the guide's delivery checklist. Never report proposed, dispatched or historically passing work as newly completed.
