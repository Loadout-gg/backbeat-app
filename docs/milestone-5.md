# Milestone 5: local Artists directory

## Scope and authority

The approved slice turns the existing agency Artists list into an operational search/pagination surface while retaining Obra/shadcn/Radix, the M3 shell and existing artist/profile/edit routes. This document states the contract; consult `../development/milestone-5/` for exact candidate status, execution receipts and review. Documentation alone is not runtime proof.

No production, shared staging, source publication, schema, dependency, auth or artist-write changes are included.

## Directory behavior

- Labelled literal, trimmed, case-insensitive search across displayed/stage name, real name, all genres and location.
- Stable displayed-name A–Z ordering with deterministic tie handling; real 20-row pages and accurate filtered ranges.
- Search and clear reset pagination, clear restores input focus, and a shrinking collection cannot leave an out-of-range empty page. Unavailable pagination boundaries use `aria-disabled` with guarded handlers rather than disabling the focused native button, so keyboard focus remains stable.
- Empty roster and no matches remain distinct. Existing read failures must not become a successful empty directory.
- Existing profile/Add artist routes remain. An artist-specific keyboard menu connects Edit to the existing wizard.
- CSV and list deletion remain explicitly unavailable. Event count is not fabricated. Stored zero fee differs from absence, and missing currency does not invent one.

## Minimal, complete directory reads

The dedicated read is workspace-scoped using the ordinary authenticated server client. Only ID, stage/real-name inputs, genres, location, fee and currency are selected/projected; hidden contacts, documents, notes and health fields are not serialized into directory client props.

An exact count and stable-ID batches establish completeness across an unchanged roster, including providers that cap responses below the requested batch size. Missing/inconsistent counts, duplicate IDs, premature empty responses and final mismatches fail instead of returning a plausible partial directory. This is not a transactional snapshot guarantee under concurrent churn. Existing shared artist readers and write actions retain their semantics.

## Presentation and verification contract

Large desktop is primary. Preserve the page-owned Artists h1, fixed readable CSS type, clear row identity and bounded columns within a centered 100rem surface. Keep necessary horizontal overflow inside a named keyboard-accessible table region; menus must not clip inside that region. Do not hide core columns to pass a narrow screenshot.

The matrix is DPR1 1440×960, 1920×1080, 2560×1440, 2560×1600 and 3840×2160; DPR2 1920×1080 CSS pixels; regression 1024×768, 390×844 and 320×800 DPR1. These are Chrome viewport/density simulations, not physical-device certification.

The real-browser contract seeds more than one server data batch and UI page, enumerates the roster, finds a final-batch artist, verifies two-workspace isolation, tests clear/reset and keyboard controls, and persists an edit before reopening its profile. Full existing unit/component, runtime, HTTP/RLS, core Chrome and synthetic demo gates remain required. Source/runtime equivalence and exact code/finish reviews precede local closure.

## Exclusions and known boundaries

No CSV export, artist-delete activation, new role policy, new business metrics, booking conversion, expanded booking tabs, performer mobile, document storage, general error-boundary refactor or optimistic concurrency. Existing M4 venue-value/time-display polish and artist-edit dialog-description warnings remain separate. A current local GO is not staging or production clearance.
