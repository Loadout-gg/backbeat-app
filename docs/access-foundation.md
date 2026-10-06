# A1 registration and workspace access foundation

## Implemented contract

Public registration collects separate Name and Surname, email, a password of at least eight characters and matching confirmation. Passwords are sent unchanged. Names are trimmed and bounded to 100 Unicode code points without control characters, matching the nullable profile columns.

Email confirmation uses the provider's six-digit email OTP (`verifyOtp`, type `email`); resend stays in the signup flow. The dialog supports keyboard input, dismissal to registration, re-entry, tab-scoped resume, missing-email recovery and retry after delivery/transport errors. Pending draft storage contains only email and names, never a password, OTP or session token.

New registrants with persisted separate identity proceed to Workspace Name without re-entering Full Name. The legacy Full Name step remains for accounts without separate identity metadata. This does not guess a first/last split of historical names.

`createWorkspace` calls `public.backbeat_bootstrap_workspace(text)` using the ordinary authenticated session. The database checks confirmed email, validates the name, serializes per actor and atomically creates the workspace, an active Master membership and completed onboarding. Retrying does not rename or duplicate a workspace. A selected active workspace is reused; with no selection, exactly one active membership is reused without role promotion. Invalid nonnull selection, ambiguous memberships, inactive/pending-only membership and orphan ownership fail closed.

Master is the workspace owner, not a global Backbeat administrator. Existing active self-creator Admin memberships are aligned to Master by the guarded local migration. Role-specific artist authorization, invitations, account recovery and public/shared access remain outside A1.

## Local migration and provider configuration

`migrations/003_access_foundation.sql` is additive and deliberately Development-only. It requires the exact synthetic singleton marker and existing RLS, refuses partial/repeated application and preserves old profile values. It removes direct client workspace/member insertion and onboarding completion/selection updates, while retaining existing authorized profile changes and creator workspace rename/delete behavior.

The existing local GoTrue service uses:

- `GOTRUE_MAILER_AUTOCONFIRM=false`
- `GOTRUE_PASSWORD_MIN_LENGTH=8`
- `GOTRUE_MAILER_OTP_LENGTH=6`
- `GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://backbeat:3101/auth/signup-confirmation.html`
- Existing private SMTP catcher `mailpit:1025`

The static template uses `{{ .Token }}`. Its exact public path bypasses Auth session initialization to prevent an Auth-to-template-to-Auth fetch cycle. No broad auth-route bypass was added. The template must be reachable from the Auth container before configuring its URL; caught real mail is the delivery proof, not a saved environment variable.

Existing rate/expiry behavior is preserved. Installed GoTrue v2.189.0 defaults email OTP expiry to 86400 seconds when no override is supplied. This is the measured local provider default, not a separately approved production expiry policy. No production configuration was modified or certified.

The application Compose file is not a standalone replacement for the manually managed Development backend services. Do not recreate the stack or replay migrations 001/002.

## Verification surfaces

- `tests/component/access-a1-*.test.tsx` and `tests/unit/access-*.test.ts`: local mocked component/action boundaries, not real provider evidence.
- `tests/integration/access-a1.test.mjs`: real ordinary-session HTTP bootstrap and authorization contract checks, disposable guarded fixtures.
- `tests/e2e/access-a1.spec.mjs`: real public signup, actual caught email, incorrect/expired code rejection, resend, transport failure, dismissal, keyboard, reload, profile persistence and Master workspace creation. Explicit safe captures cover the declared CSS/DPR matrix; passwords and valid codes are never captured.
- Existing core, shell, artist directory, booking editor and currency tests retain their business assertions. Only obsolete direct-provisioning fixture setup moves to the RPC.
- Operational evidence, migration rollback/fault probes, deployment/config readbacks, cleanup and independent reviews live outside the application repository under `../development/access-a1/`.

A database claim simulation is a defense-in-depth SQL probe, not a provider-issued session. An admin-confirmed fixture is not public-registration evidence. Viewport/DPR checks are not physical-monitor, screen-reader or comprehensive WCAG certification.

## Rollback and release boundary

No push, PR, shared staging or online release is part of A1. The old sequential provisioning action is incompatible with the revoked client grants: do not claim a simple old-image rollback restores signup. Retain the new RPC action or explicitly restore the scoped old provisioning contract under a separate approved rollback. No database reset, populated-column removal or volume deletion is authorized.

The original wireframe audit remains immutable. A1 changes coverage only through a separate evidence overlay; complete access parity, Financial, event lifecycle, sharing and performer workflows remain unclaimed.
