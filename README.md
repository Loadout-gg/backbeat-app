# Backbeat

Next.js application for artist and booking management. This checkout is the **local milestone-1 recovery branch**, not a production release.

## Safety boundary

- Development runs in Openship on the Mac, in the dedicated Lima VM `backbeat-dev`.
- App and fresh Supabase services share **one Openship Development environment**. The root project's Production slot is unused.
- App: <http://127.0.0.1:3101>. Supabase gateway: `http://127.0.0.1:55322`.
- Only synthetic data. No production credentials, restored Auth users, historical database dumps or real outbound email.
- The historical `backbeat-openship` VM and `local-duplicate` directory are protected and are **not** development dependencies.
- No GitHub push, preview, PR, Vercel deployment, production migration, N100 or shared staging is part of this milestone. The local origin push URL is deliberately disabled.

## Open the existing local environment

```sh
open -g -j -a /Applications/Openship.app
limactl list
# Only if the dedicated development VM exists and is stopped:
limactl start backbeat-dev
curl --fail --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3101/auth/login
```

Expected app response: `200`. Openship owns the containers and auto-start tunnels for ports 3101 and 55322. Do not start the historical VM if the development VM is missing. A new machine requires separate environment provisioning; this is not a one-command infrastructure bootstrap.

Use **Backbeat development → Development**, project `proj_Pg3H1x0aJwuwuV1L`, server `ac12e2ec-d412-4cf8-bce2-32b325df031e`. Source is this local directory with `composePath: compose.yaml`. The project's manually configured Supabase services and volumes are retained by Openship; the root Compose file adds only `backbeat` and is **not a standalone full-stack Compose file**. A former separate frontend project is disabled and is not the current app.

Sign up with a synthetic email through the local app, or use the automatic test fixtures below. Do not reuse a production password. Development auto-confirms accounts and routes email to an internal mail sink; production SMTP/OAuth parity is not claimed. Automated fixtures are deleted after each test.

## Local quality gates

Prerequisites: Node **22.23.2**, pnpm **12.3.4**; Google Chrome installed for browser tests.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm run test:runtime
pnpm run typecheck
pnpm run lint
git diff --check
```

Tests and lint must exit 0. Native dependency install scripts remain blocked; images are unoptimized. `pnpm-workspace.yaml` explicitly denies the `sharp` and `unrs-resolver` lifecycle scripts, and the Dockerfile copies that policy before installing. Unknown dependency builds still need an explicit decision; no script is allowlisted. Do not globally approve package build scripts to silence an installation warning.

For a credential-free build-only check, which does NOT prove runtime connectivity:

```sh
env -i HOME="$HOME" PATH="$PATH" TMPDIR="$TMPDIR" NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=build-only-placeholder pnpm run build
```

The real Openship development image additionally sets both development flags and the exact loopback backend URL. `ops/local/start.cjs` verifies those settings before exposing the app. Its loopback TCP adapter forwards server-side requests to `kong:8000`, preserving the same Supabase cookie origin in browser and server. Analytics is disabled in this development environment.

## Integration and Chrome tests against the running development stack

The following bounded process reads only the fresh development gateway's two keys from the local Openship API and injects them into tests. It never prints the keys or writes an env file. The runners independently verify the development marker before mutations. Application assertions use ordinary signed-in users; service-role access is confined to synthetic Auth fixture creation/deletion.

Run from this repository:

```sh
python3 - <<'PY'
import json, os, subprocess, urllib.request
base = 'http://127.0.0.1:58240'
project = 'proj_Pg3H1x0aJwuwuV1L'
headers = {'Content-Type': 'application/json',
           'X-Organization-Id': 'org_c18269ba-8fed-4f35-a66b-a8962edffbfa'}
def api(path, payload=None):
    request = urllib.request.Request(base + path, headers=headers,
        data=None if payload is None else json.dumps(payload).encode())
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)
assert api('/api/projects/' + project)['data']['environmentType'] == 'development'
services = api('/api/projects/' + project + '/services')['services']
kong = next(service for service in services if service['name'] == 'kong')
keys = api('/api/projects/' + project + '/services/' + kong['id'] + '/env-reveal',
    {'keys': ['ANON_KEY', 'SERVICE_ROLE_KEY'], 'source': 'effective',
     'environment': 'development'})['environment']
env = {key: os.environ[key] for key in ['HOME', 'PATH', 'TMPDIR'] if key in os.environ}
env.update(CI='1', BACKBEAT_TEST_URL='http://127.0.0.1:55322',
    BACKBEAT_TEST_ANON_KEY=keys['ANON_KEY'],
    BACKBEAT_TEST_SERVICE_ROLE_KEY=keys['SERVICE_ROLE_KEY'])
assert subprocess.check_output(['node', '--version'], env=env, text=True).strip() == 'v22.23.2'
for script in ['test:integration', 'test:e2e']:
    subprocess.run(['pnpm', 'run', script], env=env, check=True, timeout=180)
PY
```

Expected: all HTTP integration subtests and the Chrome journey PASS. The browser test verifies login, onboarding, artist create/edit, booking create/edit, reload persistence and recoverable failed save. Browser traces/video are disabled to avoid credential capture; screenshots contain only synthetic data.

The separate inactive-membership characterization uses the effective PostgreSQL `authenticated` role and rolls back every fixture:

```sh
limactl shell backbeat-dev sudo -n docker exec -i \
  openship-backbeat-dev-supabase-development-db \
  psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
  < tests/integration/inactive-membership.sql
```

Expected final line begins `PASS: inactive membership`. This command is valid only for the named development VM/container; do not substitute a remote database URL.

## Post-M1 demo-flow corrections

- `/dashboard/bookings` now lists the current workspace's saved bookings, including status and links to their existing detail routes. Read errors and a genuinely empty list are distinct states.
- The artist Calendar reads saved bookings and events for that artist. **All upcoming** means today/future `in_progress` and `confirmed` entries; cancelled/completed entries are excluded. Booking links target their real detail pages; no event detail route is invented. Displayed dates are marked on the calendar.
- Clearing an artist's email sends an explicit empty value and persists `null`. This change does not silently alter the semantics of other optional fields.

The separately retained agent-only demo account `hermes.demo@backbeat.test` is not removed by disposable regression tests. On this existing Mac, its repeatable exploratory runner is outside the application repository:

```sh
python3 ../development/qa/run-demo-flows.py
```

It verifies the local environment and exact marked account, rotates only that account's password in memory, and saves a new result directory per run. Exit 0 means every scenario passed, 2 means observed product failures, and 1 means a runner/precondition failure. No password file, recurring schedule or human credential sharing is required. Baseline evidence in `docs/milestone-1.md` remains historical; post-baseline QA evidence and closure live under `../development/qa-fixes/`.

## Schema and release boundaries

`migrations/001_development_schema.sql` is a **fresh-only development bootstrap**, already applied to this local environment. It refuses existing application tables. Do not rerun it, apply `scripts/*.sql` first, or promote it to production. Historical numbered SQL is retained as evidence, not a complete migration sequence.

The bootstrap adds the missing local schema, a read-only synthetic-development marker, active-member RLS, restricted self-bootstrap membership, tenant-consistent foreign keys and nullable artist image metadata. It intentionally is not a verified representation of live production policies.

Venue, lineup, driver and booking contact persistence are outside M1. Financial/travel/accommodation/document features and legal/help pages are not completed by this tranche. Shared staging, source publication and production changes need a separate decision.

See [`docs/milestone-1.md`](docs/milestone-1.md) and `docs/evidence/` for measured baseline, current verification and residual risks. `pnpm audit` is currently nonclean; the advisory report is not a production clearance.
