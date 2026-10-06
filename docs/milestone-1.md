# Milestone 1: local Backbeat recovery

## Scope and status

Alberto authorized a local Openship demo on the Mac, without shared staging: login → workspace onboarding → artist create/edit → booking create/edit, persistence after reload, visible save errors and workspace isolation. Existing UI structure remains the authority. No production, GitHub publication, Vercel, N100, real email or historical restored-data changes are authorized.

**Current gate: final Node 22 quality checks, HTTP integration, inactive-member RLS and extended Chrome journey PASS; independent review pending.** This execution contract supersedes the earlier Phase 0-only plan. Passing a build is not completion.

## Current environment

| Surface | Current identity |
|---|---|
| Source baseline | `59b2c0b5405e435dfebac5acf24411418d4dc958`, `Loadout-gg/backbeat-app` |
| Local branch | `chore/recovery-baseline`, no upstream; origin push URL `disabled://backbeat-local-only` |
| Openship API / organization | `http://127.0.0.1:58240` / `org_c18269ba-8fed-4f35-a66b-a8962edffbfa` |
| Dedicated VM / server | `backbeat-dev` / `ac12e2ec-d412-4cf8-bce2-32b325df031e`, SSH 127.0.0.1:53169 |
| VM allocation | 2 vCPU, 4 GiB RAM, sparse 30 GiB disk; no host directory mounts |
| Active stack | Development environment `proj_Pg3H1x0aJwuwuV1L`, local directory source, explicit `composePath: compose.yaml` |
| App / backend | `http://127.0.0.1:3101` / `http://127.0.0.1:55322`, loopback bindings and Openship tunnels |
| Data | Fresh Docker volumes, generated keys, synthetic fixtures only; local mail sink |
| Protected history | VM `backbeat-openship` remains Stopped; `local-duplicate` and `openship-local` untouched |
| Protected Openship IDs | `c67be796-5270-40b6-b490-ff99da38d355`, `proj_uBrhUWj__b3rSNWN`, `proj_yF70KFxgn7eWIXoh` |

The app and all backend services now share one native Openship project network. The app receives only an anon key, never service-role or database credentials. The development launcher rejects wrong flags, backend URLs or mismatched key bindings; its container-local TCP adapter preserves the same Supabase origin for browser and server cookies.

The root draft `proj_pHcZzM2EGOA8mTIS` has not been deployed. A former separate frontend Development project `proj_iguUmZ5aSIZoIqZR` is retained with its app service disabled/stopped; it is not the canonical runtime. Its parent draft `proj_Vv_tVbVlst_0WlVW` is also unused. No deletion or production-slot deployment was performed.

### Why consolidation was necessary

A credentials-only Openship connection injected the anon key but did **not** join project networks. The first frontend could render login but its server could not reach Kong, so login returned to the login page. A successful provider `ready` receipt did not prove the app flow. Consolidating the app into the Development backend project preserved all existing service IDs/volumes and provided the supported native network; actual inside-container backend health then returned 200 and Chrome passed onboarding.

## Baseline actually measured

Recorded 2026-09-29, Europe/Rome, before application repairs:

| Check | Actual result |
|---|---|
| Source | Clean at baseline SHA |
| Runtime tools | Node 22.23.2, pnpm 12.3.4 |
| Frozen install with scripts blocked | PASS; no manifest/lock drift or generated workspace config |
| TypeScript | FAIL: invalid comparison to booking status `pending` |
| Lint | FAIL: ESLint not installed |
| Build with nonfunctional loopback credentials | PASS but explicitly skipped type validation |
| Build side effects | Next changed JSX mode to `react-jsx` and added `.next/dev/types/**/*.ts` |
| Production / historical restored DB | NOT ACCESSED |

The historical schema-only catalogs showed missing bootstrap tables and unsafe membership policies. No row exports, password hashes or live production policies were inspected.

## Delivered implementation

- Pinned Node/pnpm and test tooling; Next 16.3.6, React/ReactDOM 19.2.8, Supabase JS 2.93.1. Removed `ignoreBuildErrors`; typecheck is independent of build.
- Shared booking status and validated booking IDs/date/time/duration/status inputs.
- Authoritative workspace resolution requires active membership. Booking mutations are workspace-scoped and verify an affected row.
- Artist creation retains distinct real/stage names; stage-only edits no longer overwrite real name.
- Booking create/update show accessible errors for both returned and thrown failures, preserve edits and restore the Save button.
- Booking time now has one authoritative 24-hour value; morning/evening, midnight/noon and overnight rollover regressions pass. Unsaved venue/lineup/driver/contact controls retain their layout but are disabled with an explicit notice.
- Booking modal initialization tracks open/artist identity rather than object identity. This fixes an observed real-browser defect: server revalidation returned a new artist object and erased the successful booking state/draft.
- Analytics disabled only for development, preserving existing non-development behavior.
- Fresh-only transactional schema with signup hooks, marker, restricted membership bootstrap, active-member RLS and composite tenant-safe foreign keys. No historical restore or production migration.

Core worker patch `ed518040530e1e630d13527cea993d56f373ca66b84145ab57f89593890ad283` was hash-checked before integration. Later parent fixes/tests are separate from that patch identity; its worker verdict is not proof for the current full diff.

## Verification evidence

| Surface | Evidence / current result |
|---|---|
| Final Node 22 quality gates | 61 unit/component tests across 7 files, frozen install, typecheck, lint and build PASS; `quality-node22-ui-final.json` is authoritative over earlier checks and the incidental Node 26 run |
| Local transport | 3 tests PASS after observed RED for guard/forwarder/launcher |
| Real REST/Auth/DB suite | 11 substantive subtests plus parent test, TAP total 12 PASS; ordinary-user JWTs |
| Actual inactive-member RLS | PASS as PostgreSQL `authenticated`; privileged fixture setup only; transaction rolled back |
| Chrome journey | PASS against `dep_j9lMOf-NTAZanbOE`: UI login/onboarding, artist create/edit, booking create/update/reload, synthetic 503 failure, unchanged stored data, retry, evening-to-morning/time-duration edits and reload; unavailable fields disabled |
| Runtime/source parity | 77 runtime source/config/assets matched SHA-256 between checkout and running container; `runtime-source-ui-final.json` |
| README command | Exact documented bounded key-injection/test snippet executed: integration PASS and Chrome PASS |
| Cleanup | Auth users and workspaces independently checked at zero after tests |
| Dependency audit | Nonclean: 9 high, 5 moderate, 0 critical advisories; see `dependency-audit-m1.json` |
| Final snapshot review | PENDING; no commits, pushes or release claims yet |

Evidence is under `docs/evidence/`; committed text logs have trailing whitespace normalized only, with raw originals retained outside the repository in the local development evidence directory. `integration-browser-ui-final.txt` is the current combined runtime result. A visually clipped native time control was reproduced with a failing browser geometry check, given sufficient width, and visually rechecked after the final PASS. Early failing browser logs are retained as history, not current results. The first timeout also exposed a harness cleanup issue; the one tagged fixture was explicitly identified and removed, then zero counts verified. The harness now tolerates a disposed browser during diagnostics and waits for confirmed SPA navigation before reload.

TDD provenance is specific: worker unit regressions, transport guard/forwarder, analytics behavior, modal reset, time conversion and unavailable controls were observed RED before fixes. The integration suite first observed the absent development marker; that single failure does not establish individual RED evidence for every schema assertion. The inactive-membership SQL is a post-implementation characterization, not claimed test-first. No fake RED output is used.

## Release exclusions and residual risks

- **Possible production authorization exposure remains unverified.** Historical membership INSERT policies only checked the current user ID. The local schema closes that pattern, but no claim is made about live production. Production policy inspection/fix requires a separately approved read-only/live change scope.
- Residual audit advisories concern lodash, ws, PostCSS, nanoid, browserslist and baseline-browser-mapping. No broad transitive update was included; a local demo is not production security clearance.
- Local schema adds nullable `artists.profile_image_url` to satisfy existing joins. This is a deliberate development contract delta, not proof that production has the column.
- Signup SMTP/OAuth parity, invitations/team administration, billing, complete events, artist calendar data, financial/travel/accommodation/document workflows and full responsive/a11y audits are outside M1.
- Existing footer/help and `/dashboard/bookings` links can prefetch 404 routes. The tested core journey uses artist profiles and booking detail URLs; the missing routes are not silently marked fixed.
- This remains a local operator demo, not staging or production. Provisioning another machine and promoting schema/app code need separate plans.
- An attempted AGENTS.md write was blocked by protected-file approval timeout. It was not retried or bypassed, and no AGENTS.md was created.

## Completion gate

Application/runtime verification is complete for the named M1 flows. Remaining: independent current-diff review → focused local commits → concise handoff with local URL. No push, PR, merge or shared environment is implied.
