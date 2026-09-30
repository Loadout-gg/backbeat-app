# Artist base-rate currency display

This local correction addresses the currency mismatch found during synthetic exploratory testing: an artist created with a £400 standard rate appeared as $400 in New Booking.

## Display contract

`lib/artist-base-rate.ts` is shared by the artist profile, New Booking and the saved-booking summary.

- USD / `$` render with `$`; EUR / `€` with `€`; GBP / `£` with `£`.
- Other nonempty denomination text is displayed explicitly, not replaced with dollars. No stored value is normalized or converted.
- A known amount with missing or blank currency reads `amount (currency unavailable)`.
- A zero rate remains a real zero. Missing rates remain unavailable: `N/A` on booking surfaces and `Not specified` on the profile.
- Number display uses `en-US`, independent of the host's default locale.
- The figure is the **artist's standard base rate**, not an agreed booking-specific fee. Financial remains unavailable.

The correction does not change artist/booking actions, saved values, schema, authentication, dependencies, date/time calculations or modal draft behavior. One minimum-width guard keeps the adjacent Location label readable when currency is unavailable; the existing layout is otherwise preserved. The Artists directory already displays stored denominations without a guessed dollar fallback and is not changed by this slice.

## Regression coverage

- Pure formatter and real-component tests cover ISO codes and symbols, other denomination text, missing currency, missing amount, zero and deterministic number formatting.
- Existing component tests retain draft-on-refresh, save-error recovery, EUR zero and profile zero-rate behavior.
- `tests/e2e/booking-currency.spec.mjs` creates a GBP artist through the ordinary UI, checks profile → New Booking → saved booking, confirms the Financial placeholder and compares stored artist data before/after.
- Additional browser cases cover stored codes/symbols, zero, missing rate and missing/blank/other currency. Fixture records are read with the ordinary user's token and removed afterward.

Local execution receipts and the exact review/commit/runtime binding live in `../development/currency-fix/`. Publication and production migration are separate, unperformed operations.
