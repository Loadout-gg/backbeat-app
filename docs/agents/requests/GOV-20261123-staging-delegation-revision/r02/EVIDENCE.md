# Evidence for GOV-20261123-staging-delegation-revision / r02

## Authority and source

Observed 2026-11-24T13:56:31+01:00. Repository: `Loadout-gg/backbeat-app`; proposal branch: `docs/staging-delegation-r2` at `e4befe7a327bcda16fbf2f14cf6cf08397fa491e`; target branch: `staging` at `b0c33f9c475fb1dda952078a2476fbff5efa5053`. Published Git objects only; this package does not use the local working tree. This package describes a request, not a decision record. The operating split was agreed with Alberto; activation on staging still requires his approval of the exact adoption commit and a merge. Proposal r01 remains historical. No existing request file is rewritten.

## Evidence and limits

| Source | Observation | What it does not establish |
|---|---|---|
| `AGENTS.md` (architecture-request gate) and `docs/agents/architecture-decisions.md` (delivery and decision records) | Each request must be delivered with evidence and a manifest; the later decision references the revision and manifest hash. | A complete package is not approval. |
| `docs/agents/decision-register.md` (governance correction) and `r02/REQUEST.md` at the source above | Before adoption, the existing staging directive applies. After adoption, Simone can merge ordinary product/UX after checks. For ordinary migrations Alberto approves exact bytes and target; for sensitive changes Alberto decides, verifies and applies. Mixed work and batch ordering have distinct gates. | No privileged runner is certified, no feature PR or migration is approved, and production is excluded. |
| Static diff `staging...e4befe7a32` | Eleven documentation paths, no executable application or database delta. r02 adds no database grants or credentials. | Not a runtime permissions test. |
| [Quality run 45397197694](https://github.com/Loadout-gg/backbeat-app/actions/runs/45397197694) and [Codex finding](https://github.com/Loadout-gg/backbeat-app/pull/41#discussion_r4680272168) | CI passed at the reviewed source; Codex correctly found that r02 had only REQUEST.md. This package adds r02-specific evidence and manifest without changing the reviewed request text. | Neither result qualifies a future commit containing these additional files. |

## Source file integrity at the reviewed commit (SHA-256)

- `AGENTS.md`: `3ed4464481e04b756f66571044539841517785bd03085c1387dca0cfffa203e0`
- `docs/agents/architecture-decisions.md`: `52fb4330e9ebf885df66559faea98ad0c3041aafc105f9cc048c501c50bf4007`
- `docs/agents/decision-register.md`: `393db41055537ba9a21ae5df50df31116146d3b3c007a96c2e5b25e9951e4cd8`
- `docs/agents/git-workflow.md`: `4493dbb30932c20f0603f5f8116bc82f3333d0c32ebc9dd32a5c6be5d3e8c573`
- `docs/agents/requests/GOV-20261123-staging-delegation-revision/r02/REQUEST.md`: `27e77a435b735fd9e37adb3e69e13e43880b7df4418fbe51b93164a4146bc1bc`

## Delivery and decision boundaries

The accompanying ZIP contains exactly `REQUEST.md`, `EVIDENCE.md` and `package.json` at its root. The manifest hashes the two documents, not itself. It carries no credentials, environment data, personal paths, raw production logs or customer data. The next repository verification is review and Quality on the commit that adds the missing files. Record actual adoption separately only after Alberto authorizes the exact head. If that never happens, the current staging directive continues to apply.
