# Decision record: GOV-20261123-STAGING-REVISION

Status: APPROVED_BY_ALBERTO
Request ID / revision: [`GOV-20261123-staging-delegation-revision` / `r02`](../requests/GOV-20261123-staging-delegation-revision/r02/REQUEST.md)
Request manifest SHA-256: `09c542d91eba2dbc0559ce8c0cb50b1db86a7126b193781c352a25bd5e2e3395`
Source baseline: `Loadout-gg/backbeat-app`, `staging` before adoption `b0c33f9c475fb1dda952078a2476fbff5efa5053`; approved PR head `4265c82dcf236084186730bfaac1651b9f3889e5`.
Decision owner: Alberto
Recorded by: Hermes Agent (documentation delegate; not the approver)
Decision date: 2026-11-24
Approval evidence: Alberto replied `ok` to the explicit merge confirmation for [PR #41](https://github.com/Loadout-gg/backbeat-app/pull/41) at the head above. Source: owner confirmation as recorded in the local handoff receipt, *Backbeat | Adozione della governance r02 su staging* (`esito-merge-pr41-r02.md`). No public permalink for the owner message was supplied. GitHub corroborates the merge, not the wording of the confirmation.

## Owner decision

The confirmation approved the exact r02 documentation adoption into `staging` only. It did not approve r01, confirm any later point-3 counterproposal, or establish bilateral assent to a new delegation. The scope below is the recorder's summary of the adopted text, not additional words attributed to Alberto.

## Authority granted

- Architecture/specification: staging governance r02 only. Simone owns ordinary product/UX within existing contracts. Alberto retains decisions, verification and application for sensitive changes under point 3.
- Local implementation: no feature, migration or runner implementation was newly authorized by this confirmation. The standing r02 procedure lets Simone prepare ordinary non-destructive migrations within approved contracts; Alberto authorizes exact bytes and the staging target. Simone may trigger only a verified constrained path; none is certified here.
- External operations / spending / destructive changes / publication / deployment: the exact PR #41 merge into `staging`; the ordinary automatic staging deploy is recorded as an effect of that merge, not a standalone authorization. No feature merge, credential grant, database write, destructive operation, production apply or promotion to `main` was authorized.
- Conditions before work: existing branch protection, current-head `Quality` and clean required Codex review remain. The r01 extra code/security-review proposal is not an adopted replacement gate. Mixed work is split only when safe; otherwise exact head and rollout order require Alberto's clearance and owner-controlled application. Recheck any changed head, digest, target, operation or order in the reserved-item batch; address active risks without waiting for the batch.

## Contract and verification

GitHub records [PR #41](https://github.com/Loadout-gg/backbeat-app/pull/41) merged into `staging` at `2026-11-24T17:14:13Z` as `dfa388ff441f009a302cdae12e44f31d90d68e3e`. Its second parent is the approved head and both have tree `4f2f98a1de4020b7a28a69a9624d1c00fc03fc00`. [Post-merge Quality](https://github.com/Loadout-gg/backbeat-app/actions/runs/45446301730) succeeded on that exact merge. The handoff receipt records the staging deploy READY on that SHA and the login page reachable without authentication; this record does not independently requalify application behavior, effective permissions or runner loading. No database mutation or permission change was part of adoption.

Existing active agency members' access to their workspace's travel documents is a retained read boundary, not a new write/delete grant, external disclosure, retention term or storage rollout. No finance role, effective grant or migration `007`/`008`/`009` was approved. Any later policy supersession must be recorded; a documentation correction is not a data rollback.

## Change control

Supersedes: `GOV-STAGING-20261123` for staging authority only. The broader delegation reported in PR #25 remains superseded; r01 is historical and unapproved.
Reopens if: the approved boundary, assumptions, target, permission scope or execution path changes. A later revision requires its own evidence and exact approval.
Unresolved decisions: any new point-3 split; sensitive access expansion, destructive operations and retention/disclosure terms; finance or travel permission/delivery specifics; verification/authorization of a constrained migration path. None is resolved by PR #41 or by silence.
