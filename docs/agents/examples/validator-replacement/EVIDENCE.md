# Evidence for EXAMPLE-validator-replacement / r01

**EXAMPLE_NOT_SUBMITTED.** Values below come from a completed isolated experiment; this document does not claim a new test run or a current production result. The experiment's full archive remains separately retained by Alberto; it is not bundled into this documentation overlay.

## Source authority

Inspected application commit: `41d124e47fcf2463ff30ce7e53e981a4bd862aa9`.
Source inspection date: 2026-10-26. These hashes identify actual source, not a deployed revision.

| Repository path | SHA-256 at documented baseline |
|---|---|
| [package.json](../../../../package.json) | `f4d7c3993ef095b5f52a4b267e48c99b41b9011a5e615b4c13e0a4e29eae81ba` |
| [lib/artist-validation.ts](../../../../lib/artist-validation.ts) | `83dda9e7aaf6e34548b922b5f83ac00673f1fab91c0bbb2b6283bf7a3ccc78e8` |
| [lib/booking-validation.ts](../../../../lib/booking-validation.ts) | `1c2308859763cf8ee1092b3c81478dff86ce1fb4c737d0fe542718f0a359cbf6` |
| [lib/booking-fee.ts](../../../../lib/booking-fee.ts) | `1c729524c2bbe45c921cd914e358cd6d24879be154a7f68c0b659fcb39e68f52` |
| [lib/event-date-display.ts](../../../../lib/event-date-display.ts) | `93c3e2c1c6d6dcc27ac03380d48c834349bd37dd26ef4340c0945381e95581d9` |
| [lib/actions/artists.ts](../../../../lib/actions/artists.ts) | `5e4bec956b7185034c8bcaab0290fe5e6f8340cf6a333997f13e8548354a7b9c` |
| [lib/actions/bookings.ts](../../../../lib/actions/bookings.ts) | `95b9bf9e06bc1452c888e1bc97620d9fdf7e34b692e4153dcda6b7c319ba20a1` |
| [lib/actions/events.ts](../../../../lib/actions/events.ts) | `be83cf2a574ab0861fd16abc15303b434d79de25de1b2f8d8d5bc25e799b5cda` |
| [app/dashboard/artists/[id]/edit/page.tsx](../../../../app/dashboard/artists/[id]/edit/page.tsx) | `c70f8605f7892154d132d99fccf74eb039a8f5dd2748c0b8cd945bdebdeda4bd` |
| [app/dashboard/artists/[id]/artist-profile-client.tsx](../../../../app/dashboard/artists/[id]/artist-profile-client.tsx) | `b626cc21e2a828a8abed0455e4acd0fb6396ef3150b70d575def6b9951cb50a1` |
| [app/dashboard/bookings/[id]/event-booking-client.tsx](../../../../app/dashboard/bookings/[id]/event-booking-client.tsx) | `dacd2c862a70a6849b073b2e778a711635a3e232cee77212fb61586072e40656` |
| [tests/unit/zod-migration-compatibility.test.ts](../../../../tests/unit/zod-migration-compatibility.test.ts) | `50a9a7786c63e82369a9fe40360759e728581b2b56d9cabdb54eb2bc3d7719c9` |

Relevant anchors: `createArtistSchema`, `updateArtistSchema`, `parseSocialLinks`, `parseDocuments`, `artistMetadataHref`, `createBookingSchema`, `updateBookingSchema`, `parseBookingFee`, action `.safeParse` call sites and the existing migration-compatibility tests.

## Recorded experiment evidence

- Versions: Zod 4.6.6, Valibot 1.5.0, esbuild 0.28.2, TypeScript 5.9.3; private Node 22.23.4/arm64 runtime.
- Unique coordinator corpus: 2,913. Acceptance, normalized output, input preservation, configured first-message and issue-path checks passed for that finite corpus.
- Normalized native error-copy differences: 600 cases; 599 first-message differences and one later-message-only difference. Full native error metadata/API identity was not equated.
- Five inferred booking-output fields become optional: venue_name, venue_address, contact_name_main, contact_phone_main, contact_email_main.
- 36 focused tests passed in a coordinator rerun, including 1,191 focused and 66,096 Gregorian comparisons that overlap other coverage. Do not add them to the unique corpus count.
- Independent experiment review: GO for methods/evidence, not migration permission. Frozen review artifact: `0fdaf53db638d3611acad1fa0ffbb83ae69f2423c21ab6364c5669c92e1bc642`.

## Standalone bundle results

All-validator closure, gzip level 9 bytes, equal exports and esbuild browser-targeted ESM settings; behavior checked under Node, not Chrome.

| Implementation | Recorded gzip bytes |
|---|---:|
| Zod original imports | 93948 |
| Zod namespace-import control | 27343 |
| Valibot compatibility port | 3586 |

Pure artist-display-helper separation alone measured507 gzip bytes. The original esbuild import spelling retained 64 Zod locales versus 1 for the module-namespace control. These are not actual Next route/network savings. Independent review verified raw artifact bytes/hashes, but Python zlib recompression differed from recorded Node gzip sizes; the gzip/Brotli figures remain source-bound Node execution evidence.

## Recorded timings

Microseconds per operation, median of 18 samples per implementation/workload across two fresh processes; 540 raw records in total. Shared inputs/iterations, warm-up, cyclic order, result sink and native error-count checks. Different error representations, a shared host and short windows limit interpretation. No end-to-end latency claim.

| Workload | Zod original | Valibot | Zod combined optimized control |
|---|---:|---:|---:|
| artist.valid | 7.544 | 2.056 | 1.037 |
| artist.invalid | 13.154 | 2.262 | 6.371 |
| booking.valid | 0.509 | 0.671 | 0.511 |
| booking.invalid | 3.289 | 0.889 | 3.289 |
| booking-update.valid | 7.043 | 1.466 | 1.996 |
| booking-update.invalid | 3.149 | 2.478 | 3.332 |
| event.valid | 0.505 | 0.648 | 0.537 |
| event.invalid | 2.792 | 0.914 | 2.803 |
| artist.collections | 13.285 | 27.252 | 7.637 |
| fee-parser.valid | 0.225 | 0.235 | 0.230 |

The last arm combines module-namespace imports and reused email-schema construction. A namespace-only arm was not timed; do not attribute its whole runtime delta to caching alone.

## Unrun application-level checks

- NOT_RUN: actual Next route/client-chunk comparison for these alternatives.
- NOT_RUN: complete application Valibot caller/form integration and typecheck.
- NOT_RUN: browser, hosted Auth/DB, deployed performance or new migration.
- NOT_PERFORMED: application edits, dependency migration, production changes.

The measured standalone scripts and full raw records are in the separately retained comparison archive; obtain that exact archive if reproducing the experiment becomes authorized. Do not pretend those scripts are in this repository or restore the retired runtime by assumption.

## Decision sensitivity

A material actual-client size/performance result could justify reconsidering migration. Without it, the experiment supports keeping the existing library and investigating smaller changes. Compatibility, maintenance effort, error/type policy and release authority remain separate choices.

## Package hygiene

This example contains no credentials, real user records, environment files, host-specific paths or infrastructure identifiers. Source links require the target repository. The example manifest hashes its two documents and does not hash itself. Its status never becomes an approval by being packaged or reviewed.
