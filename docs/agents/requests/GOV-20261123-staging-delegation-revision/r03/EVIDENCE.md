# Evidence for GOV-20261123-staging-delegation-revision / r03

## Source authority

- Observed on 2026-11-24, Europe/Rome (CET), during the local follow-up. Repository: `Loadout-gg/backbeat-app`; live `staging` and the isolated bare clone both matched `dfa388ff441f009a302cdae12e44f31d90d68e3e` (tree `4f2f98a1de4020b7a28a69a9624d1c00fc03fc00`). GitHub reported default branch `staging`; `main` was `89639affbc6f39354b10eab6627c0f1eab27f97a`. That `main` SHA is ref metadata only; production was not tested or used.
- Worktree state: no checked-out worktree or primary index. Read published Git objects and the named merge receipt; all preparation stays local. Relevant repository paths and their SHA-256 at the above staging commit are below.
- Applicable Alberto decision: the `ok` to merge PR #41 at head `4265c82dcf236084186730bfaac1651b9f3889e5`, limited to staging r02. The approved manifest SHA-256 was `09c542d91eba2dbc0559ce8c0cb50b1db86a7126b193781c352a25bd5e2e3395`. No decision from either party on the exact r03 bytes is recorded.

## Evidence ledger

| ID | Kind | Exact source/anchor | Observation | Limits |
|---|---|---|---|---|
| E1 | GitHub and Git readback | [PR #41](https://github.com/Loadout-gg/backbeat-app/pull/41); `git show -s --format='%H %T %P'` on merge and head; [post-merge Quality](https://github.com/Loadout-gg/backbeat-app/actions/runs/45446301730) | Merged to staging `2026-11-24T17:14:13Z`; second parent equals the approved head, trees match; Quality succeeded on merge SHA. Both branch tips were read through GitHub's matching-refs endpoint. | PR metadata and CI are not proof of what Alberto said, of effective privileges or of approval for this revision. |
| E2 | Owner receipt (supplied source) | *Backbeat \| Adozione della governance r02 su staging* (`esito-merge-pr41-r02.md`) | Records `ok` for the exact head above and reports the staging deploy READY on the merge SHA and a successful unauthenticated login-page GET. The merge did not change database permissions. | Owner-message permalink was not supplied. Vercel, login and database observations were not independently repeated in this follow-up. |
| E3 | Published contract and gate | [r02 REQUEST.md](https://github.com/Loadout-gg/backbeat-app/blob/dfa388ff441f009a302cdae12e44f31d90d68e3e/docs/agents/requests/GOV-20261123-staging-delegation-revision/r02/REQUEST.md), points 1–5 and “Boundaries and remaining gates”; `AGENTS.md`, “Staging decision authority”; `docs/agents/architecture-decisions.md`, “Approval and resumption” | r02 reserves sensitive decisions, verification and application to Alberto. It preserves active agency members' own-workspace document reads and Simone's representation choice. No document write/delete grant, retention window or storage rollout; ordinary migrations retain exact bytes/target approval and independently verified constrained path. | Approved authority and product scope only; not verification of effective access. |
| E4 | Supplied task boundary, not owner adoption evidence | Local governance follow-up brief; no external message reference supplied | Alberto's continuation authorized preparation. Simone had not agreed to the counterproposal. Promoter is an external actor limited to explicitly assigned booking(s) if separately authorized. | No proof an external account, permission, assignment flow or disclosure is deployed or approved. Do not infer either party's assent to r03. |
| E5 | Static inspection and inherited evidence | `docs/agents/architecture.md` → “Session, tenant and role semantics”; `docs/access-foundation.md` → “Implemented contract”; tree of `migrations/`; [r01 EVIDENCE.md](https://github.com/Loadout-gg/backbeat-app/blob/dfa388ff441f009a302cdae12e44f31d90d68e3e/docs/agents/requests/GOV-20261123-staging-delegation-revision/r01/EVIDENCE.md) (historical only) | Active membership is scoped to the selected workspace in the documented source contract; a role label does not grant a full CRUD hierarchy. The pinned staging tree contains migrations `001` through `006`; historical r01 describes concerns on candidate `007`/`009`, not current grants. | No fresh read of open migration-branch source, database, Auth, storage, provider configuration or runner. No conclusion about effective staging 007/008/009 state. |

### Pinned source hashes (SHA-256)

| Repository-relative path | SHA-256 |
|---|---|
| `AGENTS.md` | `3ed4464481e04b756f66571044539841517785bd03085c1387dca0cfffa203e0` |
| `docs/agents/architecture-decisions.md` | `52fb4330e9ebf885df66559faea98ad0c3041aafc105f9cc048c501c50bf4007` |
| `docs/agents/decision-register.md` | `393db41055537ba9a21ae5df50df31116146d3b3c007a96c2e5b25e9951e4cd8` |
| `docs/agents/git-workflow.md` | `4493dbb30932c20f0603f5f8116bc82f3333d0c32ebc9dd32a5c6be5d3e8c573` |
| `docs/agents/requests/GOV-20261123-staging-delegation-revision/r02/REQUEST.md` | `27e77a435b735fd9e37adb3e69e13e43880b7df4418fbe51b93164a4146bc1bc` |
| `docs/agents/requests/GOV-20261123-staging-delegation-revision/r02/EVIDENCE.md` | `5f7a5695c81ef14b661f80cca198d8e23c7e285242365afae5cfae3366b7672e` |
| `docs/agents/requests/GOV-20261123-staging-delegation-revision/r02/package.json` | `09c542d91eba2dbc0559ce8c0cb50b1db86a7126b193781c352a25bd5e2e3395` |

## Existing versus proposed behavior

| Case | r02 in force | r03 proposal, inactive |
|---|---|---|
| Role-by-role work within approved data scope | Simone owns ordinary product/UX; Alberto decides the rule of any sensitive change. | Simone decides functional read/write need within approved scope only; this never grants access. |
| Expanded sensitive read or write, destructive operation or reserved control | Alberto decides, verifies and applies. | Alberto explicitly approves before activation and retains enforcement, verification and application; record the reason for a refusal; silence is not approval. |
| Active agency member reading own-workspace artist travel documents | Retained read scope; Simone owns representation. | Unchanged. No new write/delete/disclosure/retention/storage authority. |
| External promoter | No access created by r02. | Ceiling only: specifically assigned booking(s), no agency membership and no implied travel-document access. |
| Ordinary staging migration, mixed change or batch | Exact-byte/target authorization, verified path, safe intermediate state or exact combined head/order, and owner-controlled reserved activation as applicable. | Unchanged; no runner certified. |

## Verification records

- Observed: successful read-only GitHub PR/ref/CI lookups and Git object inspection of exact heads, parents, trees and r02 manifest bytes. The Quality receipt covers the r02 merge only, not r03 or its documentation patches.
- Package/tree verification is recorded outside this frozen payload, after final bytes are assembled. No build, hosted probe, permissions test, integration suite, runner test or deploy was run for r03: this task allows documentation preparation only.

## Unknowns and decision sensitivity

- No bilateral acceptance, actual r03 decision record or approved staging adoption head exists in the supplied evidence. Therefore r02 remains operative and either outcome in the request is a choice, not a reported decision.
- The contract does not establish effective deployed data access. For a later exact proposal, Alberto must authorize a scoped readback, design and verify positive/negative actor and operation cases with synthetic data, and control any application. Qualification of a constrained ordinary migration runner is a separate gate.
- Retention, real-document write/delete/external disclosure, finance roles and migrations `007`/`008`/`009` are excluded; the proposal does not resolve them or defer an active incident.

## Sanitization and delivery checks

- This evidence uses repository-relative paths and published metadata only, plus the bounded name and summary of the owner receipt. No credentials, customer data, environment-file contents, private absolute paths or logs are included.
- Within the portable ZIP, `REQUEST.md`, `EVIDENCE.md` and `package.json` are at its root. Pinned r01/r02 references are GitHub source links, not additional attachments. Byte and archive integrity are verified in a separate local receipt.
- External delivery: `DELIVERY_INCOMPLETE`; no attachment was delivered to the decision owners and nothing was published or activated.
