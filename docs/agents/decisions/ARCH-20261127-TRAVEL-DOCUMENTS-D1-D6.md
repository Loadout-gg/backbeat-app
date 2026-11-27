# Decision record: ARCH-20261127-travel-documents / r01, D1–D6

Status: REQUIREMENTS_AND_ARCHITECTURE_DECIDED_BY_ALBERTO. Activation NOT approved.

Request: `ARCH-20261127-travel-documents` r01 (delivered outside the repository; ZIP SHA-256 `53d929f899fca36237c1b56cbf0f941e2bef1b59262b030a920ff7033bcfa913`). The request stays as delivered; this record does not rewrite it.

Decision owner: Alberto (`DerekLoadout`). Source: his comment on PR #36 of 2026-11-27 13:49:41 UTC, marker `<!-- backbeat-travel-documents-owner-decision-12m-signed-v1 -->`, [issuecomment-7219993558](https://github.com/Loadout-gg/backbeat-app/pull/36#issuecomment-7219993558) (body SHA-256 as read through the GitHub API on 2026-11-27: `dd2e063cbac822b8348ecb130dfa2f42ffda1534790954c9214652bdda227ef4`). The comment is the authority; the text below is a summary for readers of the repository. If they differ, the comment wins. Recorded by Claude Code on Simone's instruction; a recording is not an approval.

## What was decided

His specifications replace the corresponding points of the request.

| | Decision |
|---|---|
| D1 | Every active member of the workspace can read, create and edit the data cards, upload and replace scans, delete recoverably and restore. No logistics role, no exclusivity for the artist or booking referent. Nothing extra for promoters, anonymous users, inactive members or other workspaces. The ordinary delete must not destroy the card or the scan, and no ordinary-client path may bypass that. Artist, booking and financial history are not deleted to remove documents. |
| D2 | Option A1: private Supabase Storage. The existing backend verifies user, active membership and the requested document, records the operation automatically, then issues a signed link. Privileged credential on the server only, separate from the user session. No generic client permission to read Storage or sign links. Accepted limit: an issued link can be reused or forwarded and, with Smart CDN, a cached response can outlive the token; archiving stops new issuance from the app, not links already issued or copies already downloaded. The gateway and audit-row-based Storage access are not the chosen path. |
| D3 | Audit in the database, readable by every active member of the workspace, written by the trusted technical path, no ordinary update or delete. Identity, document/version, time and action; booking/event only when really known. **No mandatory written reason**, including any validation that blocks a download without text, and no pre-filled fictitious reason. The audit does not prove saving or forwarding. |
| D4 | Add `nationality` and `issued_on` (nullable), keeping issuing country, expiry and name on the document distinct. Describe `artists.date_of_birth` separately. |
| D5 | Documents stay operational during the relationship. After a deletion or the end of the relationship they stay recoverable for **12 months**, then the document data and files are removed for good, keeping activity history and the audit under its own policy. Restore keeps artist/workspace, does not overwrite newer versions and does not make an expired or superseded document look valid; an expired document stays recoverable and consultable as history with an explicit expired state. The period starts at deletion/archiving and is not extended by reads, retries or a later relationship end. Concurrent restore and final removal must be verified. No contract subsystem is introduced. Database backups do not contain scans. The 12 months are an operational policy, not a legal certification. |
| D6 | Follow #36 and withdraw `ARCH-20261125-booking-logistics` r01 as an active proposal (history kept). One `transport_to_city` on the booking, independent of the means of transport; the means stays on each leg. The exact meaning of who organizes/pays is Simone's. |

The comment's two appendices (technical specification of the selected path, in English; verification plan of 38 selected + 2 conditional upload cases, all `NOT_RUN` when written) are part of the decision and are implemented and tested against by ID. See [travel documents](../../travel-documents.md).

## Left to specify without reopening the decisions

File limits and types, active content, upload path and validation; technical link lifetime and cache behaviour on the plan in use; relationship end/resume operation and the calendar convention of the 12 months; audit retention and emergency backups; hosting plan/data conditions and staging verification with synthetic files. Simone's parameters of 2026-11-27 answer the product side of these: register row `TRAVEL-DOCS-OWNER-PARAMETERS`.

## Not approved by this decision

In his words: this is the decision on requirements and architecture, **not the approval of the current code, of applying 009, of Storage provisioning, of the merge or of the deploy**. Verification and authorization of the reserved operations stay with him (governance [r03 point 3](GOV-20261123-POINT3-R03.md)). No automatic sending of documents with a booking, email, PDF or promoter portal.

Requested next step: bring the criteria into the updated #36 candidate and return the full SHA, the list of changed files, the proposed migrations/operations and the real results of the checks, with `NOT_RUN` kept apart.

A change of assumptions, target, dependency or scope needs a new revision and decision.
