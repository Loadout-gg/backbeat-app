# Node 26 runtime policy

The reproducible local/CI/container candidate is Node 26.12.1. The engine range is
`>=26.12.1 <27`; the package manager remains pnpm 12.3.4. Node declarations are
pinned to 26.6.5. Read `.node-version`, `package.json`, the lockfile and CI rather
than assuming a developer's ambient Node is the project runtime.

This is a source policy, not proof of an active hosting configuration. Vercel
manages minor/patch versions within a supported major. A build log containing
`node --version` proves the build runtime only. For the server runtime, check the
private structured log event `backbeat.runtime` emitted by `instrumentation.ts`
after an ordinary preview request. It contains only the Node version, no secrets
or request data. Record the actual deployed revision and version separately.

Keep dependency lifecycle scripts denied, retain frozen installs and both
fail-closed security audits, and preserve the `Quality` check name. Do not
substitute a broad engine range to make a provider silently choose another major.
Do not enable Sharp optimization, change module formats, change hosting provider,
or upgrade Next/React/Zod as part of this runtime policy.

Tailwind and its PostCSS plugin are pinned to 4.3.3 for Node 26 compatibility.
The publisher's 4.3.1 release introduced synchronous module hooks in place of
the deprecated registration API. The runtime test exercises the actual PostCSS
consumer's loader with deprecation tracing, rather than assuming a version pin
alone proves compatibility. Keep the existing sans font stack explicit in
`app/globals.css`: the typography test compiles the real stylesheet and guards
against an unintended change to Tailwind's newer default stack.

Inspect diagnostic build logs as well as exit codes: a native panic can occur
even when the build exits successfully. Passing local compiler/runtime checks
does not establish rendered CSS parity, real-backend compatibility or hosting
support; those remain separate release gates.

The original Node 22 qualification remains historical evidence. Requalify both
the unchanged control and this candidate; compare test identities and behavior,
not just process exit or total test counts. Browser-only pending-signup state must
never use Node's process-wide Web Storage. Native loopback fetch tests do not
certify real Auth/PostgREST HTTPS, RLS or browser interaction.

Before production, require supported Node 26 hosting, the approved LTS policy,
exact-head Quality, an independent review, successful preview runtime evidence,
and authorized synthetic Auth/workspace/booking journeys. Preserve the previous
successful production deployment and revert the scoped migration if rollback is
needed. Configuration changes require a new deployment; a Git revert alone is
not proof of a restored serving runtime.
