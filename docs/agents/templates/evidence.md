# Evidence for <request ID> / <revision>

## Source authority

- Observed at: <actual date/time and timezone>.
- Repository identity / branch / full HEAD: <actual values, no private absolute machine path>.
- Worktree state: <clean or exact relevant changed/untracked paths; do not discard unrelated work>.
- Relevant current files: <repo-relative path, symbol/section, SHA-256>.
- Applicable Alberto decision: <exact reference, or NONE_FOUND; do not infer one>.

## Evidence ledger

| ID | Kind | Exact source/anchor | Observation | Limits |
|---|---|---|---|---|
| E1 | Source inspection | <path at commit : symbol / section> | <what the code actually does> | <not runtime proof> |
| E2 | Executed check | <command, environment, time, exit, artifact> | <actual output / bounded result> | <coverage exclusions> |
| E3 | Official contract | <exact URL/version, retrieval date, supported passage> | <decision-bearing behavior> | <not tested in app unless executed> |

Omit unused kinds. For NEEDED but unrun checks, write NOT_RUN with reason and required authorization. A proposed command or self-reported worker result is not an executed result. Do not copy stale package/API facts without rechecking the relevant source.

## Existing versus proposed behavior

<Small dependency/data-flow map and a before/after contract table. Distinguish target design from implementation that exists today.>

## Verification records

<Only exact scoped results. Record failure as failure. Never sum overlapping cases, treat file existence as working behavior, or turn an isolated benchmark into application-level performance.>

## Unknowns and decision sensitivity

<What is missing, why it matters, whether a conclusion depends on it, and the smallest safe way to resolve it.>

## Sanitization and delivery checks

- [ ] No credentials, session tokens, passwords, OTPs, private keys, environment-file contents or real customer data.
- [ ] No private absolute machine paths, unrelated research, raw production logs or repository dump.
- [ ] Every attached file is necessary and within authorized source scope.
- [ ] Relative package links resolve; referenced repository sources are identified at the recorded revision.
- [ ] Manifest file hashes and ZIP members were checked after the last edit; manifest does not hash itself.
- [ ] Actual delivery/attachment/access was verified, or failure is explicitly reported.
