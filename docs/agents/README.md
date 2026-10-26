# Backbeat development guide for agents

## Purpose and authority

This guide gives Simone's agents implementation context without delegating architectural authority. **Alberto decides architecture. Agents implement an authorized task inside an existing contract or an Alberto-approved plan.** An unresolved architectural decision requires a complete decision package, not an improvised implementation.

These documents describe source inspected at `41d124e47fcf2463ff30ce7e53e981a4bd862aa9` on 2026-10-26. That is an accepted local remediation baseline, not evidence that a remote branch or production deployment has those bytes. Read the current checkout before each task. Later approved changes can supersede individual contracts; this commit is provenance, not a permanent pin against legitimate development.

## Read in this order

1. [Architecture and preserved contracts](architecture.md).
2. [Development and verification](development.md).
3. [Architecture decision gate](architecture-decisions.md).
4. [Decision register](decision-register.md), then any approved plan relevant to the task.
5. Existing [product](../../PRODUCT.md), [design](../../DESIGN.md) and affected source/tests, with the historical-document caveats below.

The repository-root `AGENTS.md` is the entry point when its exact text has been approved and installed. Verify that the agent runner actually loads it and the linked documents. Documentation is a behavioral control, not an access-control mechanism; reviewers and repository permissions remain separate controls.

## One authority per concern

| Concern | Authority | Not an authorization substitute |
|---|---|---|
| Architectural choice | Alberto's explicit decision bound to a request revision and scope | Agent recommendation, reviewer GO, framework preference, deadline |
| Existing implementation | Current source and affected tests, interpreted against approved contracts | A stale milestone paragraph or screenshot |
| Product/design intent | Current approved product/design records and task requirements | Invented capabilities, demo data, unrelated UI patterns |
| Effective database/Auth/hosting state | Exact authorized target readback and applicable release evidence | TypeScript types, SQL filenames, localhost, historical setup instructions |
| Execution/publication | Explicitly authorized task and environment/action scope | Architecture approval alone |

If code, task and a recorded decision conflict, identify the exact conflict and pause that slice. Do not silently choose the most convenient source or turn a historical note into current permission. A source defect can be fixed within an approved contract; an unresolved contract change goes to Alberto.

## Documentation caveats

- The root README contains historical local-environment commands and IDs. Do not assume that stack exists, is disposable, or is the target for this task.
- Its old statement that the dependency audit is nonclean is not a current audit result. Audit outcomes are tied to a command, dependency graph and time; rerun only within authorized execution scope.
- Older currency/milestone text describes the Financial area as unavailable. The inspected source now supports a bounded optional booking fee; it does not implement invoicing, payments or the whole Financial product.
- Existing local A1 documentation supersedes older local auto-confirm descriptions. Neither establishes current hosted Auth configuration.
- Source outside the repo, referenced by historical documents, is not silently part of a fresh agent checkout. Report missing evidence rather than fabricating it or recreating an environment.

## Required task-opening statement

State the task, actual branch/HEAD and worktree state, relevant source/decision, proposed file scope, and one classification:

- `WITHIN_EXISTING_CONTRACT`: authorized implementation, no architecture change.
- `WITHIN_APPROVED_PLAN`: identify Alberto's decision and exact allowed scope.
- `BLOCKED_ARCHITECTURE`: produce the request package before implementation.
- `BLOCKED_CONTEXT_OR_ACCESS`: identify missing baseline/environment/access without inventing it; if resolving it requires architecture, use the architectural gate too.

Do not require a new plan for every variable, test or cosmetic correction. Do not disguise a new backend, data policy or dependency strategy as a small refactor.
