# EXAMPLE ONLY: retain Zod or replace the application validator?

**Status: EXAMPLE_NOT_SUBMITTED. This is a filled documentation example, not an open request, assigned task, approval or implementation instruction.**

Request ID/revision: `EXAMPLE-validator-replacement` / `r01`.
Decision owner in the demonstrated workflow: Alberto.
Requester: documentation example, not a claim that Simone assigned this work.
Source: `41d124e47fcf2463ff30ce7e53e981a4bd862aa9`; clean when inspected.
Demonstrated requested authority: architecture decision and, only if separately granted, a bounded application-level investigation. No migration, release or production access.

## Decision in one sentence

For a hypothetical task to reduce validation-related client weight, should the team keep Zod and investigate smaller module/import/construction changes, or prepare an explicitly scoped Valibot migration plan?

## Why Alberto must decide

Replacing the runtime validator changes dependencies, parse APIs, error presentation, inferred types and integration obligations across client/server boundaries. A library benchmark does not authorize that change. Existing source uses Zod 4.6.6; the isolated Valibot prototype is not installed in the app.

## Facts and unknowns

- VERIFIED FOR A FINITE EXPERIMENT: 2,913 synthetic scenarios preserve acceptance and normalized output after a compatibility port. There are600normalized error-copy differences and five booking-output requiredness differences.
- VERIFIED FOR STANDALONE BUNDLES: Valibot is smaller, but import spelling and pure-helper separation are independently important controls.
- VERIFIED FOR LOCAL MICROBENCHMARKS: results depend on workload; optimized Zod beats Valibot on measured valid-artist and collection-heavy paths.
- UNKNOWN: actual affected Next client chunks, production transfer/latency benefit, complete form/server-action integration costs and future maintenance effort. No fabricated time/cost estimate is supplied.

See [EVIDENCE.md](EVIDENCE.md) for exact values, method limits and source hashes.

## Options

| Option | Changes / stays | Value | Risk and evidence gaps |
|---|---|---|---|
| A: retain Zod; investigate smaller changes if authorized | Keep validator and native API. Candidate pilot: isolate existing artist display helpers, reuse nested email schemas and measure actual Next chunks before choosing an import change | Lower compatibility surface; controls show concrete opportunities | Actual app savings unmeasured. Any patch still needs exact caller/type/error regression and a scoped execution plan |
| B: authorize a Valibot migration design, not immediate deployment | New validator dependency/API and compatibility helpers; adapt all actual consumers and forms | Substantial measured standalone footprint reduction | Generic error-copy policy, five type changes, runtime APIs, full integration, native regex/helper maintenance and actual Next benefit remain gates |

**Recommendation for this example:** A. Keep the qualified baseline and obtain actual application evidence before paying migration cost. This is a recommendation, not Alberto's decision. No third option is invented merely to fill a table.

## Impact and preservation

| Area | A | B |
|---|---|---|
| Files/callers | Potentially artist-validation/booking-validation helpers and their direct client imports, with a separately proposed pure-helper module if needed; no edits exist | Validator modules, parse call sites in artist/booking/event actions, client form validation, relevant tests and dependency files; inventory every actual caller before an execution plan |
| Data/DB | No schema, stored data or acceptance-policy change intended | Same intended preservation, but prove exact semantics; no DB migration authorized or justified by library replacement alone |
| Auth/tenancy/privacy | Keep ordinary sessions, workspace guards, scoped writes and DTO projections unchanged | Same hard constraints; no permission/RLS change is part of this option |
| API/types/errors | Exact existing values and errors required | Known normalized error-copy and inferred-type differences need an explicit decision/adaptation; native API objects are not equivalent |
| Dependencies/build | Keep existing runtime dependencies; verify the real bundler rather than infer from esbuild | New dependency and caller integration; Zod still remains in existing ESLint tooling, so this is not removal from the whole graph |
| Performance/cost | Benefit in app unknown; implementation effort not estimated without scoped plan | Standalone size win is measured; app impact and maintenance cost unknown; no universal speed win |
| UI/accessibility | Preserve drafts, focus, retry, visible errors and unavailable states | Same; form resolver/error integration must be exercised, not assumed |
| Operations/docs | No new service/credential/backend; document only actually adopted changes | No new service expected, but dependency monitoring and compatibility documentation change |

## Acceptance and rollback

1. Freeze the actual target revision and enumerate touched consumers.
2. Reproduce acceptance/output/omission/own-undefined and required error behavior on affected contracts. Record permitted differences explicitly before changing them.
3. Run complete caller typechecks and affected form/server-action tests; measure actual Next client chunks in an authorized isolated environment.
4. Preserve Auth/tenancy/DTO/data contracts, current production and all unrelated work.
5. Restore only the pilot's source/dependency changes if the agreed gates fail. No schema destruction, fee-data deletion or production rollback is implied. Actual release/cutover, if eventually desired, needs its own plan and approval.

## Questions that would go to Alberto

- Keep Zod or authorize a Valibot migration-design phase?
- Is a bounded actual-app measurement/optimization pilot authorized, and under which exact plan?
- If B is chosen, which error-copy/type changes are acceptable versus requiring compatibility adapters?

Paused in the hypothetical task: dependency replacement and dependent integration.
Could continue: only unrelated already-authorized work that does not assume either choice.
Already performed here: documentation prepared from existing source/experiment evidence, no app changes or new application test runs.
