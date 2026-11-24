# Architecture request: GOV-20261123-staging-delegation-revision / r03 / Point-3 decision split on staging

Status: REQUESTED_NOT_APPROVED
Decision owner: Alberto; Simone's explicit assent to the same revision is also required for this proposed working agreement.
Requester: Hermes Agent, delegated to prepare Alberto's local-only governance follow-up.
Task reference: local follow-up to [PR #41](https://github.com/Loadout-gg/backbeat-app/pull/41); not a PR or a request already sent.
Source baseline: `Loadout-gg/backbeat-app`, `staging` at `dfa388ff441f009a302cdae12e44f31d90d68e3e`, tree `4f2f98a1de4020b7a28a69a9624d1c00fc03fc00`; published objects in a fresh bare clone, no checked-out worktree. Source hashes in [EVIDENCE.md](EVIDENCE.md).
Requested authorization: decision on the staging governance split only. No publication, activation, feature implementation, migration, access grant, database operation or release is requested or implied.

## 1. Decision in one sentence

Should Simone decide which roles functionally need to read or write which data and why, within an already-approved staging scope, while Alberto retains explicit pre-activation approval of any new or expanded sensitive access, destructive operation or reserved security change, and owns technical enforcement, verification and application?

## 2. Why this is an architecture question

Adopted r02 point 3 reserves the decisions, verification and application of sensitive changes to Alberto. This counterproposal splits product requirements from security authority. It cannot be inferred from Simone's ordinary product/UX remit or from Alberto's `ok` to merge the r02 head. It changes only point 3, only on staging, and only after the gates below. Points 1, 2, 4 and 5 and the existing workflow and exact stop line remain intact.

## 3. Facts, assumptions and unknowns

| ID | Classification | Statement | Evidence reference / how to resolve |
|---|---|---|---|
| F1 | VERIFIED / OWNER RECEIPT | #41 adopted r02 into `staging`; the exact merge matches the approved head tree. The separate receipt records Alberto's `ok` for that merge, not for r03. | E1–E2 |
| F2 | APPROVED SCOPE, NOT RUNTIME PROOF | Existing active agency members may already read their own workspace's artist travel documents; this is the retained product boundary. No write/delete or external disclosure is inherited. | E3 |
| F3 | GIVEN PRODUCT BOUNDARY | A promoter is external: at most the specifically assigned booking(s), not an agency member, workspace-wide reader or travel-document recipient by implication. This is a ceiling, not a grant or evidence of a deployed promoter identity. | E4 |
| A1 | PROPOSED | Simone can resolve role-by-role functional need without controlling access expansion, technical security design or activation. | Compare the options below; document any boundary case before implementation. |
| U1 | OPEN | Simone's explicit assent and Alberto's explicit decision on this exact r03 revision are not recorded; Alberto's instruction to prepare this follow-up is not adoption. | E4; record decisions separately if given. |
| U2 | NOT VERIFIED | Effective current database/storage access, any scoped runner, the exact field/operation matrix for future sensitive changes and the technical enforcement plan. | E5; obtain only targeted owner-authorized evidence when a specific change is proposed. |

## 4. Options and recommendation

| Option | What changes / stays | Benefit | Tradeoffs and risk |
|---|---|---|---|
| A — keep r02 | Simone proposes sensitive changes; Alberto decides the rule, verifies and applies. No new docs authority or permission. | Clear existing accountability; no transition. | Functional scope questions about sensitive data can still wait for Alberto. |
| B — bounded split | Simone decides functional read/write needs by role within approved scope. Alberto keeps security authority, pre-activation sign-off and enforcement/verification/application. | Product requirements can be settled without delegating security. | A proposed need could be mistaken for a grant or a UI-only change; use the explicit boundary and exact-item gates below. |

Recommendation: B, not approved. The broader r01-style transfer of reserved decisions is not recommended: review evidence cannot substitute for owner authorization or effective enforcement.

### Proposed point 3 (Option B)

1. **Functional decision — Simone.** Within an already-approved product and data scope, specify which role needs which read or write action, which data/object and tenant or booking scope, and the product reason. A requirement is not a grant, implementation authorization or instruction to activate. Ambiguous scope stays blocked; class by effect, not by file type or whether the UI already has a control.
2. **Reserved decision — Alberto before any activation.** New or expanded sensitive access (including a wider audience, fields, object scope or operation), any destructive operation and any reserved security change require Alberto's explicit approval for the exact candidate, staging target, actors, operations, allowed data and rollout order. Reserved changes include Auth, roles and membership, RLS/grants, isolation, sensitive-data exposure/storage, external disclosure, retention/restore, secrets, infrastructure and workflow controls. Alberto's refusal is reasoned and recorded with the affected scope; absence of an answer is not approval. A review, green CI, merged PR, deadline or earlier authorization does not supply consent. If merge/automatic deploy would activate a reserved effect, the approval and owner-controlled application must precede that effect.
3. **Enforcement — Alberto.** Simone may propose a patch; Alberto designs/controls technical enforcement, verifies it on the exact approved target and applies reserved changes. Simone does not receive privileged credentials, an alternate SQL path or authority to bypass approvals. Keep the ordinary-migration exception exactly as in r02 point 2: owner approves exact bytes/target, Simone may trigger only a separately verified constrained path, none certified by this request.
4. **Concrete limits.** Existing active agency members' in-workspace travel-document read scope is unchanged; Simone may decide the representation. Nothing authorizes writes, deletion, new recipients, new external disclosure, retention terms or a storage rollout. A promoter is external and may never be treated as an agency member; any separately approved promoter access is limited to the explicitly assigned booking(s) and approved fields/operations, not the rest of the workspace or travel documents. No finance role, payment grant, runner, changes to Auth/RLS/workflow or migrations `007`/`008`/`009` are approved here. Treat an active access risk independently and immediately through Alberto. `main`, production, credentials, billing, infrastructure ownership and any third environment are out of scope.

## 5. Impact and compatibility

| Concern | A — keep r02 | B — bounded split |
|---|---|---|
| Affected files and callers | None. Existing agent entrypoints continue using `AGENTS.md` and the linked guide/register/workflow. | Separate request files and conditional changes to the root matrix, agent index, architecture classification, Git workflow, decision register and operative handover/backlog. Thin runner bridges unchanged; no proof of loading. |
| Data, tenancy, Auth, RLS and privacy | Preserve current contract; no assumption about current effective access. | No code, schema, role, grant, data, API/DTO, client/server flow or validation change. Membership, exact booking scope and sensitive-data controls still need owner verification on any specific candidate. |
| Runtime, UX, build and dependencies | No change. | No runtime dependency, cost, latency, accessibility, build or user-facing change in the docs candidate; per-feature effects are unknown and not authorized here. |
| Operations and observability | Existing owner-controlled gates. | Record the scope, owner, exact head/digest/target/operation/order and evidence; refusals must be reasoned and recorded. No new operational telemetry or automation. |
| Tests and documentation | No adoption required; verify the r02 record separately. | Static patch/ZIP checks now. Same current-head review and `Quality` gates, plus post-merge exact staging readback if an adoption is later separately authorized. |

## 6. Rollout, rollback and failure states

1. Freeze and review this exact revision and manifest. Keep r02 operative and r01/r02 bytes unchanged. A request-only addition never activates the proposal.
2. Record Simone's and Alberto's explicit assent to the same revision and manifest, or keep r02. Record Alberto's actual scoped decision separately in the prescribed decision record; do not edit this request, invent evidence or treat a refusal/qualified answer as assent. Changed wording or boundaries need a new revision.
3. Recheck live `staging`, the exact adoption content and existing gates. Only after separate authorized publication and Alberto's explicit approval of the exact adoption head may it be integrated into `staging`; verify the merge, exact tree and staging deployment/readback. The local conditional patch is not an authorization or a record of adoption.
4. Missing assent, stale checks, conflicting records, drift, an unverified target or new reserved effect: stop the affected slice and keep r02. If a later adopted policy needs reversal, prepare a separate owner-authorized docs change restoring r02 as current. It is not a rollback of a technical change, which has its own containment and data-preservation plan.

## 7. Acceptance and smallest next step

| Check | Contract / observable outcome | Test or readback | Environment/authority required |
|---|---|---|---|
| AC1 | Request is immutable, separate and still unapproved | Compare manifest sizes/SHA-256, unique ZIP members, CRC and member bytes; r01/r02 unchanged | Local only |
| AC2 | Conditional docs are consistent and cannot substitute for actual assent | Replay exact-tree patch and check stop line, path allowlists and unaffected rules. Review cases: in-scope requirements versus broadened sensitive reads/writes, promoter scope, destructive and other reserved changes, motivated refusal and silence | Local static review; not an authorization enforcement test |
| AC3 | Later adoption switches the point-3 rule only with genuine evidence | Match both confirmations to this revision/hash, an actual decision record, Alberto's exact approved adoption head, current-head `Quality` and review, and exact staging merge/deploy readback | Later, separately authorized staging governance adoption only |
| AC4 | Future technical proposal honors the real access boundary | Actor/operation/data matrix, positive own-workspace/assigned-booking cases and negative unassigned/cross-tenant, broader sensitive projection, write/delete/disclosure cases as applicable; no loss of existing valid reads | Later, exact owner-authorized candidate and synthetic evidence; NOT_RUN here |

Smallest next step after a decision for B: record that decision and reconcile the conditional documentation against the current staging tip. Do not combine adoption with a permission change, feature merge or migration.

## 8. Explicit questions for the decision owners

- Alberto: keep r02 (A), accept this exact bounded point-3 split (B), or record a different scope as a new revision? This is a policy choice only, not permission for publication or activation.
- Simone: if B is chosen, confirm the same exact revision; unresolved implementation details remain outside this agreement.

## 9. Work state and package

Paused: applying or relying on the proposed point-3 rule and any dependent access or security change. Independent authorized work: local r02 adoption record/status correction; ordinary r02 work retains its existing gates, but none is authorized or executed by this request.
Actions already performed: read-only GitHub/source inspection and local documentation preparation only. Unrun: application suite, backend permissions, provider deploy and runner behavior; no target activity is authorized by this request.
Attachments: [EVIDENCE.md](EVIDENCE.md), [package.json](package.json), and `GOV-20261123-staging-delegation-revision-r03.zip`; the conditional docs patch is separately reviewable, not embedded in the request ZIP.
Delivery status: `DELIVERY_INCOMPLETE` to the decision owners. Local handoff only; no external attachment, message or publication has been sent.
