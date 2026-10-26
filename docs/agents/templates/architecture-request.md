# Architecture request: <request ID> / <revision> / <short title>

Status: REQUESTED_NOT_APPROVED
Decision owner: Alberto
Requester: <agent / human assigning the task>
Task reference: <actual reference or explicitly unavailable>
Source baseline: <repository-relative context, branch, full HEAD, dirty-path summary, relevant file hashes>
Requested authorization: <architecture/specification only OR explicit bounded implementation; external actions separate>

## 1. Decision in one sentence

<The exact choice Alberto must make, and the business/user outcome it enables.>

## 2. Why this is an architecture question

<Existing contract, exact source/approved-plan anchors, the boundary that would change, and why ordinary implementation is insufficient.>

## 3. Facts, assumptions and unknowns

| ID | Classification | Statement | Evidence reference / how to resolve |
|---|---|---|---|
| F1 | VERIFIED | <observed fact, with scope/date> | <EVIDENCE.md anchor> |
| A1 | ASSUMPTION | <not yet established> | <basis / validation> |
| U1 | UNKNOWN | <material missing information> | <owner, smallest authorized probe, decision impact> |

## 4. Options and recommendation

| Option | What changes / stays | Benefit | Tradeoffs and risk | Evidence / unknowns |
|---|---|---|---|---|
| A | <preserve existing approach, if viable> | <specific> | <specific> | <references> |
| B | <bounded alternative> | <specific> | <specific> | <references> |

Recommendation: <one option and rationale; NOT an approval or implementation decision>.
Rejected alternatives: <only those actually examined; why unsuitable>.

## 5. Impact and compatibility

For EACH option cover: affected files/components and real callers; client/server/data-flow boundaries; schema and existing data; tenancy/Auth/roles/RLS; API/DTO/validation contracts; privacy/secrets; runtime/dependencies/build; operations/observability; performance and cost; UI/accessibility; testing and documentation. Use N/A with a reason, not an omitted category. Separate measured values from estimates.

## 6. Rollout, rollback and failure states

<Prerequisites, safe order, compatibility window, exact preservation requirements, failure/ambiguity stop condition, reversible versus irreversible steps. State when rollback is unknown or needs a separate decision. Never propose destructive cleanup as an implicit rollback.>

## 7. Acceptance and smallest next step

| Check | Contract / observable outcome | Test or readback | Environment/authority required |
|---|---|---|---|
| AC1 | <specific> | <exact existing or proposed test> | <local / authorized synthetic / external gate> |

<Smallest implementation or evidence-gathering sequence AFTER the exact approval. No invented PASS.>

## 8. Explicit questions for Alberto

- <Choose an option or provide a different architectural plan.>
- <Only consequential unresolved constraints/policies.>
- <What execution scope, if any, is authorized after the decision?>

## 9. Work state and package

Paused: <exact slice>.
Independent authorized work: <exact slice or none>.
Actions already performed: <read-only analysis/document preparation; disclose any existing changes honestly>.
Unrun checks: <what remains and why>.
Attachments: <EVIDENCE.md, package.json, additional finite files>.
Delivery status: <verified attachment/access or DELIVERY_INCOMPLETE>.
