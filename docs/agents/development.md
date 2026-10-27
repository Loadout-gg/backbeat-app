# Development and verification contract

## Start from the actual task and checkout

Read the [entry guide](README.md) and classify the task with the [architecture gate](architecture-decisions.md). Establish the actual branch/HEAD, dirty paths, relevant callers/tests and owner-approved scope before editing. Preserve other agents' work. Do not start from a sibling checkout or silently import an old patch because its tests once passed.

Read-only checks from the intended repository root:

```sh
git status --short
git rev-parse HEAD
git branch --show-current
node --version
pnpm --version
```

The documented source baseline is `41d124e47fcf2463ff30ce7e53e981a4bd862aa9`. A different HEAD is not automatically wrong: verify the relevant approved changes and current contracts. If the target predates/removes the documented remediation or materially contradicts it, report the discrepancy before work. Do not upgrade the checkout, merge the remediation or discard changes by assumption.

## Make the smallest authorized change

1. State the observable acceptance criterion and affected contracts.
2. For a bug, reproduce the intended failure; for unchanged behavior, label a passing test characterization rather than inventing RED.
3. Implement the minimum within the existing architecture. Preserve imports/public APIs, normalized data, configured errors and draft/retry semantics unless an approved plan explicitly changes them.
4. Run focused tests and affected callers, then the appropriate project gates. Retain actual commands, exit codes, environment scope and unrun checks.
5. Inspect the diff and update the relevant documentation. Do not rewrite history or instructions to hide changed scope. Never weaken security assertions, skip failures, add audit suppression or enable package scripts to obtain green.

Use existing components/helpers and server-action patterns before introducing an abstraction. Do not choose a new library or global architecture from personal preference. Do not optimize by dropping validation, error construction, privacy projections or completeness checks.

## Toolchain and local gates

Read [package.json](../../package.json), [the lockfile](../../pnpm-lock.yaml), [.node-version](../../.node-version), [the package policy](../../pnpm-workspace.yaml) and [CI](../../.github/workflows/ci.yml). The inspected baseline qualifies Node 22.23.4 and pnpm 12.3.4. Package ranges and actual lock resolutions are different facts; the lockfile contains multiple YAML documents, so do not assume its first packages map is the application graph.

Only after execution/setup is authorized, the exact toolchain is available and the workspace/cache ownership and resource bounds are known:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run test:runtime
git diff --check
```

Run commands individually or with fail-fast shell behavior; preserve each real outcome. A missing tool/runtime is a setup gate, not permission to install globally, change versions or regenerate the lock. The package policy denies `sharp` and `unrs-resolver` builds and has no general script allowance. Retain its guarded overrides unless the assigned approved change specifically alters them.

For an authorized **build-only** gate, use a credential-free isolated checkout/environment and the placeholder environment in the existing CI workflow, then `pnpm run build`. Verify no real environment file or credential inheritance can be loaded; environment-variable placeholders alone do not establish that isolation. A placeholder build proves compilation, not backend connectivity.

Dependency changes need applicable behavior checks plus these existing fail-closed audits, when network/audit execution is authorized:

```sh
pnpm audit --prod --audit-level=low
pnpm audit --audit-level=low
```

An advisory result is time/graph-bound. Do not describe an old clean receipt as a current audit or an old README warning as a newly reproduced vulnerability. Do not auto-fix, waive or lower the gate.

## Test surfaces and their limits

| Surface | Existing paths/commands | What it does not prove |
|---|---|---|
| Unit/component | `tests/unit/`, `tests/component/`; `pnpm test` | Actual hosted Auth, database policies, network or physical-browser behavior |
| Runtime policy | `tests/runtime/`; `pnpm run test:runtime` | Deployment, current hosted CI execution or full vendor security |
| Type/lint/build | Existing scripts and CI | Runtime data authorization or application availability |
| HTTP/database integration | `tests/integration/`; `pnpm run test:integration` | Safe target identity by itself; fixture runners can mutate data |
| Chrome journeys | `tests/e2e/`, [Playwright configuration](../../playwright.config.ts); `pnpm run test:e2e` | Permission to use any live account or reset an environment |

Integration, SQL and browser runs require an explicitly authorized, independently identified synthetic environment, supported credential injection, fixture ownership and cleanup. Do not execute the historical README key-retrieval or migration commands merely because they are present. A loopback URL, local VM, development flag or SQL guard is not sufficient proof of disposable data. Do not substitute a remote target or service-role application access when a test fails.

The repository's Compose/local scripts are not a standalone full Supabase bootstrap. Do not recreate the backend, replay historical SQL, rotate identities, delete workspaces or weaken Auth/RLS to unblock testing. Missing real-backend evidence remains an explicit gate.

## Focused regression map

| Changed concern | Relevant existing tests to inspect first |
|---|---|
| Session/workspace selection | `proxy-session-security`, `access-workspace`, `workspace`, `a1-template-proxy` unit tests |
| Artist boundaries/metadata | `artist-validation`, `artist-boundary-security`, `artist-directory`; `artist-metadata-security`, `artist-edit`, `artist-fee` component tests |
| Booking validation/save/date/money | `bookings`, `booking-fee`, `zod-migration-compatibility`, `event-date-display`; booking component tests and `event-date-rendering` |
| Complete reads/error states | `complete-collection`, `backend-read-contracts`; `dashboard-read-errors`, `creation-recovery` |
| Async dialog/session behavior | `booking-modal-session`, `booking-feedback`, `booking-safety`, `creation-recovery` |
| UI/design | Existing M3/M4/M5 tests, relevant source surface and authorized Chrome journeys |

These names identify files in the existing unit/component directories; inspect exact cases and real callers rather than blindly selecting a label. A growing pass count is not full wireframe or release coverage.

## Required completion handoff

- Task and architecture classification, with preserved-contract or Alberto-decision reference.
- Changed files and the actual behavior delta; no unrequested architecture changes.
- Actual tests/checks, exact outcomes and relevant source revision.
- Explicit `NOT_RUN`, failures and coverage/environment limitations.
- Data/security/privacy and compatibility checks relevant to the change.
- Remaining owner decisions and external activation/release gates.
- If architecture is blocked: the exact mandatory phrase, verified request package and affected/independent work.

A local commit, passing unit suite or review GO is not a production release. Commit/push/PR/deploy only within the actual granted scope; branch creation or a draft PR can have automation effects. Do not enable or alter repository automation as part of documentation or routine feature work.

## Runtime policy after the source snapshot

The current runtime candidate and its release boundaries are documented in
[Node 24 runtime policy](../runtime-node24.md). Read the current runtime pins and
qualification evidence; the older Node 22 snapshot above is historical, not an
instruction to undo an approved upgrade.
