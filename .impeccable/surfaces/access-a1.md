# Access foundation

Mode: Operate

## Scope and incumbent authority

Routes: `/auth/signup`, `/auth/signup-success`, `/onboarding`. Preserve Backbeat's existing logo, monochrome tokens, typography, shadcn/Radix components and centered bounded access forms. The source-confirmed changes are separate Name/Surname, eight-character password minimum with confirmation, and a six-digit email confirmation dialog. This is not a redesign or a full authentication/recovery/invitation release.

## User success

An independent registrant confirms their real email, retains their name, creates exactly one agency workspace as its Master and reaches the existing dashboard. A user with saved separate identity does not repeat Full Name. Historical accounts without separate names retain their compatibility step.

## Interaction and visual rules

- Show the destination email in the confirmation dialog; wrap long synthetic or real addresses without expanding the viewport.
- Six visible digit slots are one labeled, numeric-input, one-time-code control, not six unlabeled keyboard stops.
- Keep Confirm, Resend and Close available according to request state; a failure preserves a retry path.
- Dialog close returns to registration with email/names only. Never persist or rehydrate the password, OTP or session token in the pending draft.
- Password fields underneath the dialog must be empty. Never capture credentials in automated screenshots, video or traces.
- Keep normal CSS type and bounded forms on large desktop canvases rather than stretching operational content to fill the screen.
- Test 1440×960, 1920×1080, 2560×1440, 2560×1600, 3840×2160, 1024×768, 390×844 and 320×800 at DPR1, plus 1920×1080 CSS at DPR2. Verify native screenshot pixel dimensions as well as DOM DPR.

## Explicit exclusions

No invented legal destinations/disclosures, alternative identity providers, account recovery, invitations, global administrator role, artist-permission completion or event/financial/share semantics. No physical-monitor, cross-browser, full accessibility or usability-validation claims from the automated matrix.
