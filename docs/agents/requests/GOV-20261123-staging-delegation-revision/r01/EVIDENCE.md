# Evidence for GOV-20261123-staging-delegation-revision / r01

## Source authority

- Observed at: 2026-11-23 (local time, Europe/Rome).
- Repository identity / branch / full HEAD: `Loadout-gg/backbeat-app`, `origin/staging` `ac72fec43fbf4def2d5f5640ab5b5b5045bdb168`; working branch `docs/staging-delegation-r2` created from it.
- Worktree state: clean before this change.
- Relevant current files (SHA-256 at `ac72fec`):
  - `AGENTS.md` — `bbfa412317abd8077e686f6f33127d05d0c963748b98d99b97a0e1d799afefaf`
  - `docs/agents/decision-register.md` — `ee34223c4ad3a399e4571ae6d301a50ad2e704901c43971274aa1b06fd5b2ae5`
  - `docs/agents/architecture-decisions.md` — `5eee400993a565604100837ab320c50e9a539c8be181ae8a948f7f2b51a376a3`
  - `docs/agents/git-workflow.md` — `593758c221352633e7f5ae7b7021d04a19abbd8a656caf83fa9a4f383e12e383`
- Applicable Alberto decision: `GOV-STAGING-20261123` (current). No owner record of the 2026-11-23 phone agreement: NONE_FOUND.

## Evidence ledger

| ID | Kind | Exact source/anchor | Observation | Limits |
|---|---|---|---|---|
| E1 | Source inspection | `docs/agents/decision-register.md` at `ac72fec`, "Governance correction and supersession" | `GOV-STAGING-20261123` is `OWNER_DIRECTIVE`; Alberto alone authorizes workflow/policy, roles, Auth/RLS, isolation, sensitive data, destructive operations, infrastructure, production | Documentation, not runtime |
| E2 | Source inspection | `migrations/007_booking_finance.sql` at `origin/feat/booking-p2-finance` `35ab0c1079ae92a723c81cf17e6d38d6ba46caf5` (SHA-256 `a26ab90c6d26ba491a7c486e35216b9db27e84b33bfb93d3cfd48e40af896158`), line 208 | `GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_payments TO authenticated`; `FOR ALL` active-member policy | Open PR, not on staging code; DB apply state reported by Simone only |
| E3 | Source inspection | `migrations/009_booking_travel_stays.sql` at `origin/feat/booking-travel-stays` `aa1d7732cb8df5880552ab90eab98daf911f0983` (SHA-256 `37658c97e45b05d3e022865a7e708ef85eb113b984eb7a018293854c77734de8`) | Creates `artist_travel_documents` with RLS and `SELECT, INSERT, DELETE` grants; case-insensitive search for `reason`, `audit`, `download` returns 0 matches | Text search; application code of #36 not reviewed here |
| E4 | Reported | Simone's task brief, 2026-11-23 | Content R1–R4 of REQUEST.md, agreed by phone with Alberto | Not owner evidence |

## Existing versus proposed behavior

| Area | Current (`GOV-STAGING-20261123`) | Requested (R1–R4) |
|---|---|---|
| Staging schema/migrations | Simone: additive, within approved contracts, no RLS/grants/write-changing triggers | Simone: schema, migrations incl. RLS, grants, policies, triggers, roles, contracts |
| Review gate | `Quality` green, Codex review clean | Plus `@codex security review` clean on current head for schema/RLS/Auth/roles/sensitive/destructive PRs |
| Travel identity documents | Sensitive-data handling: Alberto | Allowed with lazy read, reasoned and logged downloads, active-member visibility; retention open |
| Booking payments | Money visibility: Alberto (r02 U3) | All active members; void instead of hard delete |
| Production, `main`, secrets, infrastructure, billing | Alberto | Alberto (unchanged) |

## Verification records

None executed against any database. Docs-only.

## Unknowns and decision sensitivity

U1 retention, U2 scope of "roles", U3 applicability to open PRs: see REQUEST.md §4. Each changes what a later session may do; none blocks Alberto's yes/no.

## Sanitization and delivery checks

- [x] No credentials, tokens, environment-file contents or real customer data.
- [x] No private absolute machine paths or repository dump.
- [x] Every attached file is necessary.
- [x] Referenced repository sources identified at recorded revisions.
- [x] Manifest hashes computed after the last edit; manifest does not hash itself.
- [x] Delivery: files in the PR on GitHub.
