# Node 26 runtime policy

Alberto approved the bounded Node 26 alignment and Next security correction on
2026-11-17: “settiamo 26 come versione e pèer il resto si”. This supersedes the
[Node 24 policy](runtime-node24.md) for the new source candidate, not its historical
qualification evidence. No publication, hosting setting change, deployment,
database operation or new application environment is included.

## Major policy versus reproducible qualification

- `package.json` selects **26.x**, excluding Node 27 and older majors. This is the
  owner-selected major policy, not a claim that every Node 26 patch is secure.
- `.node-version`, CI and the Docker declaration pin **26.13.1**, the current
  official Node 26 LTS security release (Lithium, 2026-11-10).
- The exact-runtime test intentionally requires this patch in local/CI/container
  qualification. An ambient 26.13.0 does not satisfy that test.
- Node declarations are exactly **26.6.6**; pnpm remains **12.3.4**.
- Next and eslint-config-next are exactly **16.4.5**, the first patched release
  for [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h).
  This is a package-floor correction, not proof of an application exploit.

Official references: [Node releases](https://nodejs.org/dist/index.json),
[Next 16.4.5](https://github.com/vercel/next.js/releases/tag/v16.4.5),
[Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Preserve frozen installs, denied lifecycle scripts, both fail-closed audits and
`Quality`. The original staging correction retained the minimatch compatibility
patch. The main-to-staging realignment adopts main's qualified lock instead:
legacy ESLint consumers resolve callable minimatch 3.1.5 and the TypeScript parser
resolves the named API on 11.0.9; the staging patch is no longer required. No broader
upgrade, framework redesign, React/Zod/Tailwind change or audit waiver is approved.
The existing Tailwind loader and typography regressions remain required.

## Qualification and release boundaries

Use a scoped official runtime rather than replacing host binaries. A build-only
check must use an empty credential environment and the explicit CI placeholders
from `.github/workflows/ci.yml`; it does not prove backend connectivity.

For this correction, only source checks, unit/component tests, non-listener runtime
cases and build are authorized locally. Do not invoke the complete runtime glob:
its native-fetch and proxy-forwarding cases open listeners. Do not start Next,
Docker/Compose, integration/E2E fixtures or a replacement local backend. Those
cases remain required in an authorized qualification lane; exclusions here do not
remove them from CI or change their assertions.

Vercel manages minor/patch versions within a selected major. `26.x` is not a
provider patch pin or proof of project configuration. Before release, require
current-head Quality including Linux/container and HTTP smoke, independent review,
existing-staging acceptance with authorized synthetic fixtures, and separate build
and request-time runtime observations. Read the private `backbeat.runtime` event
from `instrumentation.ts` after an ordinary authorized request, bound to the exact
deployment/revision. Compare the actual runtime with the security floor above.
A green local build or historical Node 24 CI cannot replace these gates.

Retain the previous successful deployment for a separately authorized rollback.
A local Git change alone neither changes nor restores a serving application.
