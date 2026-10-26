# Architectural decisions: stop, package, ask Alberto

## Ownership

Alberto owns architectural choices. Agents may analyze and recommend, but cannot approve their own proposal. An instruction to implement a feature, a deadline, an automated review or a successful prototype does not grant architectural authority. A task that already names an Alberto-approved plan can proceed only within that plan's exact scope.

## Classification is semantic, not a filename rule

A one-line change can alter a trust boundary. Editing an architecture-related file is not automatically a new architectural decision when it merely implements an already-approved contract. If the needed choice is not determined by an existing contract or Alberto's plan, stop the affected slice.

| Situation | Classification and action |
|---|---|
| Correct copy, spacing, accessibility or a test within existing product/design behavior | Ordinary implementation if the task is authorized and no data/trust/API contract changes |
| Fix a bug to restore an explicitly established contract; preserve external behavior otherwise | Ordinary implementation with a reproducing regression test |
| Small internal refactor or schema reuse with unchanged data, errors, API, boundaries and dependencies | Ordinary implementation only within the assigned scope; prove preservation, do not infer it |
| Implement a specified schema/API change already approved by Alberto | Follow that exact plan and its gates; do not invent the missing details |
| Add/remove/replace a runtime library, framework, backend, ORM, state-management system, mailer, queue or external service | Architectural decision unless the exact change is already approved |
| Major runtime/toolchain change, new build strategy, dependency lifecycle allowance, audit waiver or material CI/release change | Architectural decision; never bypass a failing gate to proceed |
| Routine compatible dependency security patch explicitly assigned, with no new strategy, API or build-policy change | Implementation within that authorization; verify graph, behavior and audits. Escalate any major/API/policy exception |
| Change database schema, tenancy, ownership, RLS/grants, role semantics, identity/Auth flow, provider behavior or data retention | Architectural/data-policy decision unless already specified in Alberto's plan |
| Change a public action/DTO, field meaning, validation acceptance, null/omission semantics, date/money policy or business metric | Contract decision; do not silently choose a new meaning |
| Introduce a new cross-layer pattern, replace server actions with another transport, move privileged work to the client, or widen client data | Architectural/security decision |
| Enable a capability that the product currently marks unsupported | Obtain its product/architecture contract first; a visible control is not implementation authority |
| Need to resolve conflicting source/plan requirements or an unknown target environment | Pause and expose the conflict; do not select a new architecture or recreate a stack by default |

## Mandatory same-handoff behavior

1. Stop implementation, installation and target mutations for the affected choice. Preserve existing unrelated work; do not undo colleagues' changes.
2. Print exactly this line as a standalone line in the agent's human-visible response (and terminal status when applicable):

```text
chiedere ad alberto  il piano architetturale
```

The line is lowercase, has **two ASCII spaces between `alberto` and `il`**, and has no extra punctuation or quotation marks.

3. In that same response, deliver a decision-ready package. Do not stop at the phrase, ask Alberto to rediscover the code, or promise the package later. Preparing the package permits only scoped documentation and read-only investigation; it is not permission for a prototype, install, migration or live test.
4. Name the exact paused work and any independent work that can continue under existing authorization. Work depending on an unapproved choice cannot be relabeled independent.

## Minimal package

Prepare a local folder at `docs/agents/requests/<request-id>/r01/` (a future output path, not an existing open request). Use a unique descriptive ID, for example `ARCH-YYYYMMDD-short-topic`; a changed request gets a new revision. If repository writes are restricted, use an explicitly permitted private output location and say so.

Required files:

- `REQUEST.md`: use [the decision brief template](templates/architecture-request.md).
- `EVIDENCE.md`: use [the evidence template](templates/evidence.md).
- `package.json`: use [the manifest template](templates/package-manifest.json), populated with exact file sizes/hashes. Include both documents and any additional necessary sanitized evidence; do not hash the manifest inside itself.

Create `<request-id>-r01.zip` containing that one revision and verify its membership, unique paths, CRC and per-file hashes. Report the manifest/ZIP hash outside the hashed file itself. Include only the smallest useful evidence, not a repository dump, credentials, environment files, personal paths, database dumps or raw production logs.

**Delivery:** attach the ZIP with the agent's supported artifact mechanism, or provide an authorized accessible equivalent. Include the decision summary inline. A local path that Alberto cannot access is not delivery. If attachment/access is unavailable, keep the architecture blocked, disclose `DELIVERY_INCOMPLETE`, provide the readable brief and identify the exact missing delivery capability. Do not claim an archive exists or was sent without verification. Do not post, email, commit or publish externally merely to deliver it without the required authorization.

## What Alberto must receive

- The user/business outcome and the precise decision needed now.
- Why the existing architecture/plan cannot answer it; exact code and contract anchors.
- Verified facts, hypotheses and unknowns, separately labelled.
- A small option set, normally two or three, including preserving the current approach where viable. If only one option is feasible, explain the evidence rather than inventing alternatives.
- One recommended option with reasons, not an agent-selected implementation.
- For every option: scope, affected layers/files/callers, data/security/privacy effects, compatibility, dependencies, operations, costs/latency evidence or explicit unknowns, migration/cutover and rollback/data-preservation consequences.
- Acceptance tests, the smallest authorized investigation needed to resolve unknowns, and the smallest implementation sequence after approval.
- Exact requested authorization: architecture/specification only, bounded local implementation, or a separately gated external action. Do not bundle deployment or deletion implicitly.

Unknown facts do not permit invented numbers. Label estimates and their basis. A risk without an answer must be visible in the decision, not hidden in an appendix.

## Approval and resumption

Freeze delivered request bytes. Record Alberto's actual decision with [the decision-record template](templates/decision-record.md), referencing the exact request revision and manifest hash. Keep the original request unchanged; append the decision separately and update the [register](decision-register.md) only from authentic owner evidence. Never fabricate a quote, date, approval source or approved status.

An unambiguous explicit approval can be recorded in the owner's own words; do not demand a magic approval phrase. Silence, a reviewer GO, an agent-authored decision draft or an ambiguous acknowledgement among several options is not approval. Clarify only the missing choice/scope.

Before resuming, verify that the source, assumptions and requested scope still match. Architecture approval does not automatically authorize implementation, production access, migration, spending, deletion, publication or deployment. Follow the scope actually granted. If the approval requires a detailed implementation plan and one does not exist, the next action is to obtain that plan, not invent it.

A changed boundary, new dependency or materially different option reopens the gate. Record supersession rather than quietly editing an approved record.

## Completion response format

```text
chiedere ad alberto  il piano architetturale
Status: BLOCKED_ARCHITECTURE
Decision: <one precise question>
Request: <request ID and revision>
Package: <actual attachment or accessible location; otherwise DELIVERY_INCOMPLETE>
Integrity: <verified manifest hash and optional ZIP hash>
Recommendation: <option, explicitly not approved>
Paused: <affected work>
Can continue: <independent authorized work, or none>
Missing evidence: <explicit list, or none>
```

See the [filled validator-replacement example](examples/validator-replacement/REQUEST.md). It is an example, not an open request or an approved migration.
