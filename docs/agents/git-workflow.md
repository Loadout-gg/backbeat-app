# Backbeat Git and staging workflow

These instructions apply to Claude and to every other agent working with Simone. Simone describes the product outcome; the agent verifies the branch, permissions, tests and destination within the authorized scope. Only Alberto authorizes changes to workflow, policy or roles.

Language: terse technical English is the handoff convention with Simone, not an owner-approved English-only policy (see `AGENT-LANGUAGE-EN` in the [decision register](decision-register.md#governance-correction-and-supersession)). The architecture stop line in `AGENTS.md` is a fixed string and stays verbatim.

## Approved flow

One repository: `Loadout-gg/backbeat-app`. No forks or additional repositories. The repository default branch is `staging`; `main` remains the live release branch. The GitHub default does not change the Branch Tracking of the Vercel projects.

| Branch | Purpose | Vercel project | URL |
| --- | --- | --- | --- |
| `staging` | Shared acceptance testing, not production | `backbeat-staging` | https://backbeat-staging.vercel.app |
| `main` | Approved live version | `backbeat-app` | https://app.backbeat.show |

Normal path: `feat/*` or `fix/*` -> PR to `staging` -> check on staging -> release PR `staging` -> `main`, only after Alberto's explicit authorization. The Production name in Vercel is relative to a single project: on its own it does not identify the live site.

A Vercel link and a green build do not prove that staging is usable. Before declaring a deploy successful, verify project, commit, branch, URL and backend. Do not declare an unverified automation as working.

## First Claude session and existing checkouts

A new clone starts from `staging`. Existing checkouts and old PRs do not switch branch on their own.

Before the first task under these rules, check `origin`, branch and `git status --short`. With uncommitted changes, stop without stash/reset. In a clean checkout, run `git fetch origin` and read the current guide with `git show origin/staging:docs/agents/git-workflow.md`.

For a new task, create the working branch from `origin/staging`: it will contain `AGENTS.md`, `CLAUDE.md` and the current guide. Start a new Claude Code session from the root of that checkout and use `/memory` to check the loaded files; ask Claude to summarize PR base, environment and merge authority before writing code.

For an old PR, do not switch branch or pull in all of `staging` automatically: also read `git show origin/staging:AGENTS.md`, give Claude the current instructions explicitly and coordinate the chain update with Alberto. If Claude is used without loading the project files, attach the current guide and `AGENTS.md` explicitly; do not assume a link has been read.

## Before modifying any file

1. Read `AGENTS.md`, this guide and the applicable contracts in `docs/agents/`.
2. Inspect the checkout without modifying or publishing anything:

```sh
git remote get-url origin
git status --short
git branch --show-current
git rev-parse HEAD
```

3. Check that `origin` identifies exactly `Loadout-gg/backbeat-app`. The usual HTTPS and SSH forms of the same repository are accepted. If the repository differs, stop.
4. If there are changes that are not yours, stop and tell Simone which files are involved. Do not delete, overwrite, commit or stash other people's work.
5. For a new independent task in a clean checkout: run `git fetch origin`, check that `origin/staging` exists and create a new `feat/<description>` or `fix/<description>` branch from `origin/staging`. Do not work directly on `main` or `staging`.
6. When continuing an existing PR, first read head, base and dependencies with `gh pr view <number> --repo Loadout-gg/backbeat-app`. Do not change base branch, rebase, cherry-pick or PR chains automatically. Dependent PRs already open are coordinated with Alberto.
7. Summarize for Simone, in English: requested outcome, working branch, PR base and what will NOT be changed.

## Implementation and checks

Stay within the assigned task. Do not introduce libraries, upgrades, redesigns or architectural changes to make the task easier. The architecture contract and its escalation remain those in `AGENTS.md`.

Read the current pins in `.node-version`, `package.json`, the lockfile and CI. Do not use versions remembered from an old chat. To install already planned dependencies, when authorized: `pnpm install --frozen-lockfile --ignore-scripts`. Do not regenerate the lockfile or enable scripts to work around an error.

Run the focused tests for the change and the applicable checks:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:runtime
git diff --check
```

The `Quality` CI also runs build, the `next-start` smoke test, container qualification and dependency audits, as defined in `.github/workflows/ci.yml`. The local checks above do not replace the full CI and do not authorize a merge with `Quality` failed or missing.

A check that was not run is reported as `NOT_RUN`, with the reason. Do not disable checks or rewrite tests to get green. For builds and tests with a backend follow `docs/agents/development.md`; never use production as a test environment.

## Commit, push and PR

- Authorization to develop is not automatically authorization to publish. For work within her scope, Simone may explicitly authorize pushing the working branch and opening its PR to `staging` only. For reserved work, obtain Alberto's explicit authorization for the action; otherwise ask before publishing.
- Check `git diff` and add only the files of the change. Do not use `git add .` blindly.
- Do not commit `.env*` with secrets, tokens, passwords, admin keys, dumps, real data, `.vercel/` or credentials of other environments. Keep any secret-free example templates the repository already provides.
- Push explicitly to your own branch and create the PR with explicit base `staging`; never rely on the `main` default.
- To create a PR use `gh pr create --repo Loadout-gg/backbeat-app --base staging --head <working-branch> --title <title> --body-file <description-file>`; then re-read URL, head and base with `gh pr view`.
- Describe the visible result, changed files, real tests, limits and acceptance steps for a non-technical person.
- Wait for the GitHub `Quality` check on the current commit. A green check on an earlier commit does not count.
- Do not merge on your own, do not enable auto-merge and do not approve your own work. **Simone may explicitly authorize a merge to `staging` only within her scope below.** Alberto authorizes reserved changes, including this governance sync. Show the PR link, expected result, current-head Codex review and `Quality` green. Ask the applicable decision owner: "This merge updates staging only, not production. Confirm merging the PR above?". A "yes" applies to that PR, not to other tasks. After consent, re-check head/base/checks and merge pinned to the verified head; do not use `--admin` or bypasses. Authorization to create a PR does not include the merge. A reported statement, green CI, review or merged PR does not establish owner approval.

## Staging and release

After an authorized merge into `staging`, verify the deploy of the `backbeat-staging` project on the same commit. Do not use Previews of the live project as a substitute. Staging is shared: coordinate tests before replacing a candidate. The project has a build filter for the `staging` branch: do not assume that a manual deploy from another branch is an available alternative, and do not remove the filter to unblock it.

### Verify the deploy without Vercel admin access

Take the merge commit on `staging` from the PR; do not use the previous head of the working branch. With the GitHub access already available, read that commit's statuses and deployments:

```sh
# STAGING_SHA must be the exact merge commit read from the merged PR.
: "${STAGING_SHA:?Set the verified merge commit of the PR}"
gh api "repos/Loadout-gg/backbeat-app/commits/$STAGING_SHA/status"
gh api "repos/Loadout-gg/backbeat-app/commits/$STAGING_SHA/check-runs"
gh api "repos/Loadout-gg/backbeat-app/deployments?sha=$STAGING_SHA"
```

If a deployment record exists, read `repos/Loadout-gg/backbeat-app/deployments/<deployment-id>/statuses`. Verify SHA, project `backbeat-staging` and staging URL from the provider record/link: a generic green Vercel check or the Production label is not enough, because two projects share the repository. The current version on `origin/staging` may have moved on in the meantime: do not attribute an earlier candidate's tests to it.

If GitHub does not expose enough evidence, report `DEPLOY_NOT_VERIFIED` and ask Alberto to verify the deployment, without requesting tokens or admin access. Visiting the protected site needs separate access; its absence does not prevent preparing the PR. Do not declare login or application paths verified from a deployment status alone.

A push or merge to `main` can update the live site immediately. Do not create a PR to `main`, merge, or run a live deploy/promotion without Alberto's explicit authorization for the candidate being released. A generic request from Simone such as "finish", "publish" or "put it online" does not authorize production: make clear that the proposed action concerns staging.

For an authorized release, the base is `main` and the head is `staging`; verify the full diff, current checks, required migrations and Alberto's product review. Only the `DerekLoadout` account can update `main`; keep PR and `Quality` required, without requiring a second GitHub approval that would block the owner's own PRs. This configuration does not replace Alberto's authorization of the specific release.

Between the two permanent branches use a **merge commit**, not squash or rebase, and do not delete `staging`.

### Standard realignment after every release

The `staging` -> `main` merge creates a commit on `main` that `staging` must acquire. Realignment is part of the authorized release, not a new architectural choice:

1. Verify the merged release PR, the `main` SHA and the actual state of the live site; do not start a new release if the current one is not qualified.
2. Check divergence between the branches. If `main` is already an ancestor of `staging`, do not create a pointless PR.
3. Otherwise open a PR with **head `main`, base `staging`**, dedicated to the realignment. Do not add features and do not push directly to protected branches.
4. Wait for `Quality` green on the PR and verify there are no conflicts or unexpected changes. Complete the merge commit as part of the already authorized release. With conflicts or ambiguous concurrent work, stop and ask Alberto; no blind resolutions.
5. After `git fetch origin`, verify `git merge-base --is-ancestor origin/main origin/staging` (exit 0). The realignment may trigger a new staging deploy; record the new SHA. Do not make a second merge to `main` just to chase the realignment commit.

The rule also applies after an authorized live hotfix. New independent tasks start from the realigned `staging`.

### One-time conflict resolution for the post-#24 sync

For this sync only, Alberto authorized an integration branch to resolve the conflicts and carry the governance correction, with `staging` (`9299c71ed2c63f0d623be6e7f68eafd8c2c0e996`) as first parent and `main` (`89639affbc6f39354b10eab6627c0f1eab27f97a`) as second parent. The branch is a technical exception to using `main` itself as the PR head, not a permanent alternative. No feature work belongs in it.

The correction and candidate preparation are local only. If Alberto separately authorizes publication and integration, use a PR from that integration branch to `staging`, normal current-head review and `Quality`, a merge commit that preserves both parents' ancestry, and the usual post-merge ancestry/deployment checks. If either pinned branch moves, stop and ask Alberto before reusing the exception. No direct push, squash, rebase, protection change or bypass. Future syncs still use head `main`, base `staging`; conflicts go to Alberto.

## Decision authority on staging

Follow the [staging decision matrix](../../AGENTS.md#staging-decision-authority). Simone may merge ordinary product/UX after required checks without an owner batch. Alberto approves exact migration bytes and target; Simone may trigger only a verified path bound to both, never generic SQL. An additive SQL statement that changes behavior, access, isolation or existing data is not eligible.

Only Alberto authorizes workflow/policy, roles and permissions, Auth/RLS and isolation, sensitive-data handling changes, destructive operations, infrastructure and production. Staging does not exempt these cases. Use the architecture stop line and request package for unapproved reserved choices. Keep normal PR, current-head `Quality` and Codex review; version each migration and describe its what, why and rollback. Neither PR readiness nor an environment guard grants execution authority.

## Boundaries that are not bypassed

- No direct push to `main`/`staging`, force push, `reset --hard`, `git clean`, branch deletion or history rewriting to unblock work.
- Do not change branch protection, CI workflows, agent instructions, Git/Vercel links, domains, environment variables, plan or permissions as part of an ordinary feature.
- Simone collaborates on GitHub; no Vercel admin invitation is needed. If Hobby blocks a deploy, report the error: do not change commit author/email, share accounts, add tokens or bypass the block.
- Use only synthetic staging accounts and data. Live credentials and database are not a fallback.
- Database changes must be versioned and described in the PR. Do not apply SQL or migrations automatically: running them on the backend requires a target-specific authorization. A code deploy does not apply migrations.
- Do not modify Auth, email confirmation, RLS, roles or membership to make a test pass. Application account, access to the protected site and admin membership are distinct permissions.

## Handoff to Simone

Always provide, in English:

1. What changes for the user, in a few lines.
2. PR link, base branch and verified commit.
3. Tests PASS/FAIL/NOT_RUN, with no invented results.
4. Staging URL and the commit actually deployed, or why the deploy is not verified.
5. Simple steps to try the result and what to expect.
6. What remains to be approved. Always state whether the live site is unchanged.

The instructions guide the agent but do not replace the GitHub checks. Do not claim that Claude loaded or followed them without verification in the session Simone actually used.
