# Backbeat agent instructions

Scope: this repository and its subdirectories, including delegated agents. Alberto owns architectural decisions. Simone's development tasks do not authorize agents to invent or replace the architecture.

## Before implementation

Read [the agent guide](docs/agents/README.md), its architecture and development contracts, and the relevant recorded decision. Inspect the actual checkout and affected callers/tests. Treat source observations, proposals and Alberto-approved plans as different authorities.

Implement an authorized task within existing contracts or an explicitly approved architectural plan. Ordinary implementation details do not need a new architecture decision. Use the [classification rules](docs/agents/architecture-decisions.md) whenever scope is unclear.

## Architectural stop

If the task requires an unapproved architectural choice, print this exact line, preserving the two spaces after `alberto`:

```text
chiedere ad alberto  il piano architetturale
```

Stop the affected implementation. In the same handoff, deliver the complete architecture-request package defined in the classification rules: `REQUEST.md`, `EVIDENCE.md`, `package.json`, and their ZIP attachment or accessible equivalent. A bare question, inaccessible path or promise to prepare the package later is insufficient. Report delivery failure honestly and remain blocked.

Explain the decision needed, current contracts, options, recommendation, impacts, risks, verification and rollback. Recommendations are not approval. Continue only genuinely independent, already-authorized work and identify it explicitly. Do not implement the preferred option, install a new dependency or start a spike while waiting.

Resume only against Alberto's explicit decision for the exact request revision and authorized scope. An experiment PASS, reviewer GO, deadline or silence is not architectural approval. Changed assumptions or scope require a new decision.

## Non-negotiable boundaries

Preserve tenant isolation, ordinary-session authorization, DTO privacy, validation semantics, data integrity and honest error/unavailable states. Do not weaken tests, security checks or these instructions to obtain approval or a green run.

Never expose credentials or real user data in requests. Architectural approval alone does not authorize infrastructure changes, destructive data operations, external publication or deployment. Do not infer a live environment from historical documentation.

## Handoff

State architecture classification and its basis, changed paths, actual verification results, unrun checks and remaining gates. Follow the guide's delivery checklist. Never report proposed, dispatched or historically passing work as newly completed.
