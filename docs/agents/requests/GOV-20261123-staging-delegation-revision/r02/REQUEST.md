# GOV-20261123-staging-delegation-revision / r02

Decision owner: Alberto. Scope: Backbeat staging branch and its staging database only. This replaces the proposal in r01, not the operative register entry. Preserve r01 unchanged. Do not approve the r01 head as confirmation of this narrower decision.

## Division of authority

1. Product and UX: Simone owns the choices and may merge his staging PRs after the checks and reviews required by the existing workflow, without waiting for an owner batch, provided there is no reserved effect. Classify by effect, not file type: a UI change that sends additional sensitive fields to the browser is not UI-only.
2. Ordinary migrations: Simone may prepare a non-destructive migration that does not change access or sensitive-data handling. Alberto approves the exact migration for staging. Simone may trigger only an execution path bound to those approved bytes and that target, without general SQL or privileged credentials. A changed script or target requires new approval. Until a constrained execution path is verified, Simone must not apply the migration manually.
3. Security: Simone may propose a patch. Alberto's side decides the rule, verifies the patch and applies the sensitive change. Reserved: Auth, workspace roles and membership, RLS and grants, tenant isolation, sensitive-data exposure and storage, retention and restore, destructive operations, secrets, infrastructure and workflow controls. Automated review is evidence, not delegated authority.
4. Mixed PRs: split only when each part is safe to deploy independently in the proposed order. Otherwise Simone may merge the combined PR after Alberto clears the exact commit and rollout order. If merge or automatic deployment would itself execute a reserved change, do not use Simone's merge as a substitute for owner-controlled application. Missing or stale checks block the merge.
5. Batches: review ready reserved work together. Record PR, exact commit, migration identity and digest if applicable, target, owner, order and permitted operation (merge, trigger or apply). Changed inputs invalidate the affected item. An active risk is addressed immediately outside the batch; unrelated ordinary product PRs continue.

## Boundaries and remaining gates

No change to main, production, secrets, billing or infrastructure ownership. No third environment. This revision grants no database credentials, approves no feature PR or migration (007/008/009), and does not certify that a restricted migration runner exists. Existing workflow checks remain in force. The extra exact-head Codex code/security review condition proposed in r01 is not a substitute for owner sign-off; record its applicability explicitly before treating it as an operative new gate.

For travel documents, active members may read documents belonging to their workspace; the representation is Simone's product choice. No real-document retention period, write/delete grant, or storage rollout is approved here. For payments, governance approval does not change effective database grants. Handle the previously observed staging DELETE permission separately from approval of the finance PR.

## Adoption

Reconcile #41 with current staging. Update its title/body, register and pointers so approval can never be read as approving r01. Align all operative workflow instructions with the owner-reviewed r02 in the adoption diff; preserve the historical r01 package. Review the exact reconciled head before activation. No feature merge, migration application or production promotion is part of this document.
