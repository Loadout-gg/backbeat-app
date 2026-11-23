# Architecture request: GOV-20261123-staging-delegation-revision / r01 / Revision of GOV-STAGING-20261123 agreed by phone

Status: REQUESTED_NOT_APPROVED
Decision owner: Alberto (GitHub `DerekLoadout`)
Requester: Claude Code agent, task assigned by Simone on 2026-11-23 ("GOV Backbeat" session)
Task reference: docs-only governance PR to `staging` in `Loadout-gg/backbeat-app` (this request's PR)
Source baseline: branch `docs/staging-delegation-r2` from `origin/staging` `ac72fec43fbf4def2d5f5640ab5b5b5045bdb168`, worktree clean before this change. File hashes in EVIDENCE.md.
Requested authorization: governance/policy decision only. No code, migration, apply, merge or production action is requested or implied.

## 1. Decision in one sentence

Does Alberto confirm in writing the revision of `GOV-STAGING-20261123` that Simone reports was agreed by phone on 2026-11-23 (points R1–R4 below), so that it can replace the current staging authority?

Approving the PR that carries this request is Alberto's written confirmation of the phone agreement. Until then the request grants nothing and `GOV-STAGING-20261123` stays controlling.

## 2. Why this is an architecture question

`GOV-STAGING-20261123` (decision register, `AGENTS.md` "Staging delegation", `git-workflow.md` and `architecture-decisions.md` "Decision authority on staging") reserves to Alberto workflow/policy, roles and permissions, Auth/RLS and isolation, sensitive-data handling, destructive operations, infrastructure and production, on staging too. The reported agreement moves part of that set back to Simone on staging, adds a review gate and sets two data-handling policies. Only Alberto can change workflow/policy and those reserved areas; a phone call reported by Simone is not owner evidence (`AGENTS.md`: "A reported statement ... does not establish owner approval").

## 3. Content reported by Simone (the points to confirm)

R1. Staging authority. On the `staging` branch and the staging database Simone decides schema, migrations including RLS, grants, policies, triggers, roles and contracts again. Production, `main`, secrets, infrastructure, billing and any production database stay with Alberto.

R2. Review condition (added by Alberto). Every PR that touches schema, RLS, Auth, roles, sensitive-data handling or destructive operations must have, on its current head, both a clean `@codex review` and a clean `@codex security review` before Simone merges it or applies its migration on staging.

R3. Artist travel identity documents may be stored in the app, with these guarantees:
- never sent with the booking; read only when the documents view is opened;
- every download requires a written reason and is recorded with who and when;
- visible to active workspace members.
- Retention period: OPEN. Simone proposes document expiry plus a margin; Alberto to confirm the rule and the margin.

R4. Booking payments. All active agency members keep full visibility (Simone's product decision). No hard delete from the app: a payment is voided and the original stays traceable.

## 4. Facts, assumptions and unknowns

| ID | Classification | Statement | Evidence reference / how to resolve |
|---|---|---|---|
| F1 | VERIFIED | Current register row `GOV-STAGING-20261123` is `OWNER_DIRECTIVE` and reserves RLS, roles, Auth, sensitive data, destructive operations to Alberto on staging | E1 |
| F2 | VERIFIED | Open PR #33 (`feat/booking-p2-finance`, head `35ab0c1`) migration 007 grants `SELECT, INSERT, UPDATE, DELETE` on `booking_payments` to `authenticated` with a `FOR ALL` active-member policy | E2 |
| F3 | VERIFIED | Open PR #36 (`feat/booking-travel-stays`, head `aa1d773`) migration 009 creates `artist_travel_documents`; the migration text contains no download-reason or access-log object | E3 |
| A1 | REPORTED_BY_SIMONE | The phone agreement of 2026-11-23 contains R1–R4 as written above | Alberto's approval of this PR resolves it |
| U1 | UNKNOWN | Retention rule and margin for travel identity documents (R3) | Alberto |
| U2 | UNKNOWN | Whether R1 "roles" includes workspace role/membership semantics and Auth configuration on staging, or only database roles/grants | Alberto; R2 names Auth separately |
| U3 | UNKNOWN | Whether R2 applies to PRs already open (#33, #36) on their next head | Alberto |

## 5. Options and recommendation

| Option | What changes / stays | Benefit | Tradeoffs and risk | Evidence / unknowns |
|---|---|---|---|---|
| A | Approve R1–R4 as written: new row becomes owner-confirmed, supersedes `GOV-STAGING-20261123` for staging only | Matches the reported agreement; unblocks staging schema/RLS work under R2 | Security-relevant staging changes decided by Simone, gated by two Codex reviews; production still Alberto's at release | F1, U1–U3 |
| B | Approve with changes (e.g. narrower R1, explicit retention, answers to U2/U3) | Closes the unknowns before anyone relies on it | Needs a new request revision r02 | U1–U3 |
| C | Reject: `GOV-STAGING-20261123` stays controlling | No change in reserved areas | #33 and #36 reserved parts keep waiting for Alberto's individual decisions | F1–F3 |

Recommendation: B only if U2/U3 matter to Alberto; otherwise A, with U1 left open and R3 storage not usable until the retention rule is set. Not an approval.

## 6. Impact and compatibility

- Files: governance docs only (`docs/agents/decision-register.md`, this request, `AGENTS.md` pointer, `docs/HANDOVER.md`, `docs/BACKLOG.md`). No code, migration or CI change.
- Schema/data, tenancy/RLS, DTO, runtime, build, UI: N/A for this PR; R1 changes who may decide them on staging.
- Privacy: R3 and R4 set data-handling policies; existing PRs #33 (F2: hard `DELETE` granted) and #36 (F3: no download reason/log) do not yet meet them. They are not changed here.
- Operations: production apply and promotion to `main` remain Alberto's; he reviews full diffs and migrations at release.

## 7. Rollout, rollback and failure states

After approval: record Alberto's decision under `docs/agents/decisions/` with this revision and manifest hash, flip the register row from requested to owner-confirmed, mark `GOV-STAGING-20261123` superseded for staging, update `AGENTS.md` "Staging delegation" accordingly. Each step is a docs change, reversible by a later owner decision. No step rolls back data.
If Alberto requests changes: new revision r02; r01 stays frozen.

## 8. Acceptance and smallest next step

| Check | Contract / observable outcome | Test or readback | Environment/authority required |
|---|---|---|---|
| AC1 | Alberto (`DerekLoadout`) approves the PR carrying r01 | GitHub review state `APPROVED` by `DerekLoadout` on the PR head | Alberto |
| AC2 | Decision record references r01 and manifest hash | file under `docs/agents/decisions/` | follow-up docs PR |

## 9. Explicit questions for Alberto

- Approve R1–R4 as written (A), approve with changes (B), or reject (C)?
- R3 retention: confirm "document expiry plus margin" and the margin.
- U2: does R1 "roles" cover workspace roles/membership and Auth configuration on staging?
- U3: does R2 apply to the next head of already-open PRs #33 and #36?

## 10. Work state and package

Paused: nothing implemented; no session may rely on R1–R4 until approval.
Independent authorized work: none created by this request.
Actions already performed: read-only inspection, this docs-only PR.
Unrun checks: none required beyond docs lint/typecheck.
Attachments: EVIDENCE.md, package.json.
Delivery status: delivered as files in the PR carrying this request (accessible to Alberto on GitHub).
