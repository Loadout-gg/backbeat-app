import { describe, expect, it } from "vitest"
import {
  MAX_PAYMENT_NOTE_LENGTH, MAX_TAX_NOTE_LENGTH, artistDefaultCommission, artistDefaultCommissionSchema, bookingCommission,
  bookingFinanceTotals, commissionAmountMinor, createPaymentSchema, defaultCommissionPrefill, formatArtistDefaultCommission,
  formatBasisPoints, formatCommissionValue, formatMinorAmount,
  parseCommissionPercent, parseMoneyAmount, paymentCurrencyMatchesFee, updatePaymentSchema,
  type BookingCommission,
} from "@/lib/booking-finance"
import { MAX_BOOKING_FEE_MINOR } from "@/lib/booking-fee"
import { updateBookingSchema } from "@/lib/booking-validation"

const percent = (value: number, mode: BookingCommission["mode"] = "on_top"): BookingCommission => ({ type: "percent", value, mode })
const fixed = (value: number, mode: BookingCommission["mode"] = "on_top"): BookingCommission => ({ type: "fixed", value, mode })
const paid = (amount_minor: number, currency = "EUR", paid_on: string | null = "2026-11-01") =>
  ({ amount_minor, currency: currency as "EUR", paid_on })

describe("commission amount", () => {
  it.each([
    [100000, 1500, 15000],      // 15% of 1000.00
    [100000, 0, 0],
    [100000, 10000, 100000],    // 100%
    [0, 1500, 0],
    [1, 5000, 1],               // 0.005 → half rounds up to 0.01
    [1, 4999, 0],               // 0.004999 rounds down
    [3, 5000, 2],               // 0.015 → 0.02
    [333, 3333, 111],           // 110.9889 → 111
    [333, 1, 0],                // 0.0333 → 0
    [150, 1, 0],                // 0.015 minor → 0
    [5000, 1, 1],               // exactly half a minor unit rounds up
    [4999, 1, 0],
    [12345, 1250, 1543],        // 1543.125 → 1543
    [12348, 1250, 1544],        // 1543.5 → 1544 (half up)
  ])("percent: fee %i at %i bp is %i, rounded half up to the minor unit", (fee, basisPoints, expected) => {
    expect(commissionAmountMinor(fee, percent(basisPoints))).toBe(expected)
  })
  it("rounds to the whole yen for JPY, whose minor unit is the yen", () => {
    expect(commissionAmountMinor(150000, percent(1250))).toBe(18750)
    expect(commissionAmountMinor(33333, percent(1500))).toBe(5000)   // 4999.95 → 5000
    expect(commissionAmountMinor(33, percent(1500))).toBe(5)         // 4.95 → 5
    expect(commissionAmountMinor(3, percent(1500))).toBe(0)          // 0.45 → 0
  })
  it("stays exact where fee × basis points exceeds Number.MAX_SAFE_INTEGER", () => {
    expect(MAX_BOOKING_FEE_MINOR * 9999).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    expect(commissionAmountMinor(MAX_BOOKING_FEE_MINOR, percent(9999))).toBe(999899999999)   // 999899999999.0001
    expect(commissionAmountMinor(MAX_BOOKING_FEE_MINOR, percent(3333))).toBe(333300000000)   // 333299999999.6667
    expect(commissionAmountMinor(MAX_BOOKING_FEE_MINOR, percent(10000))).toBe(MAX_BOOKING_FEE_MINOR)
  })
  it("fixed: the stored amount, independent of the fee; none: zero", () => {
    expect(commissionAmountMinor(100000, fixed(25000))).toBe(25000)
    expect(commissionAmountMinor(0, fixed(25000))).toBe(25000)
    expect(commissionAmountMinor(100000, null)).toBe(0)
  })
})

describe("booking totals (decision 3)", () => {
  const base = { feeMinor: 100000, currency: "EUR" as const, payments: [] }
  it("has no totals without a fee", () => {
    expect(bookingFinanceTotals({ ...base, feeMinor: null, currency: null, commission: percent(1500) })).toBeNull()
    expect(bookingFinanceTotals({ ...base, currency: null, commission: null })).toBeNull()
  })
  it("without commission: promoter total and artist net are the fee", () => {
    expect(bookingFinanceTotals({ ...base, commission: null })).toEqual({
      currency: "EUR", feeMinor: 100000, commissionMinor: 0, promoterTotalMinor: 100000,
      paidTotalMinor: 0, outstandingMinor: 100000, artistNetMinor: 100000, ignoredPayments: 0,
    })
  })
  it("on top: the promoter pays fee + commission, the artist keeps the fee", () => {
    expect(bookingFinanceTotals({ ...base, commission: percent(1500, "on_top") })).toMatchObject({
      commissionMinor: 15000, promoterTotalMinor: 115000, artistNetMinor: 100000, outstandingMinor: 115000,
    })
    expect(bookingFinanceTotals({ ...base, commission: fixed(20000, "on_top") })).toMatchObject({
      commissionMinor: 20000, promoterTotalMinor: 120000, artistNetMinor: 100000,
    })
  })
  it("included: the promoter pays the fee, the artist net is fee − commission", () => {
    expect(bookingFinanceTotals({ ...base, commission: percent(1500, "included") })).toMatchObject({
      commissionMinor: 15000, promoterTotalMinor: 100000, artistNetMinor: 85000, outstandingMinor: 100000,
    })
    expect(bookingFinanceTotals({ ...base, commission: fixed(100000, "included") })).toMatchObject({
      commissionMinor: 100000, promoterTotalMinor: 100000, artistNetMinor: 0,
    })
  })
  it("paid total sums only payments with a paid date; outstanding = promoter total − paid", () => {
    const totals = bookingFinanceTotals({
      ...base, commission: percent(1000, "on_top"),
      payments: [paid(30000), paid(20000, "EUR", null), paid(5000)],
    })
    expect(totals).toMatchObject({ promoterTotalMinor: 110000, paidTotalMinor: 35000, outstandingMinor: 75000 })
  })
  it("reports an overpayment as a negative outstanding amount", () => {
    expect(bookingFinanceTotals({ ...base, commission: null, payments: [paid(120000)] })).toMatchObject({ outstandingMinor: -20000 })
  })
  it("a zero fee is a real fee", () => {
    expect(bookingFinanceTotals({ ...base, feeMinor: 0, commission: percent(1500) })).toMatchObject({
      feeMinor: 0, commissionMinor: 0, promoterTotalMinor: 0, outstandingMinor: 0, artistNetMinor: 0,
    })
  })
  it("JPY: whole-yen amounts end to end", () => {
    expect(bookingFinanceTotals({
      feeMinor: 333333, currency: "JPY", commission: percent(1250, "included"),
      payments: [paid(100000, "JPY"), paid(50000, "JPY", null)],
    })).toEqual({
      currency: "JPY", feeMinor: 333333, commissionMinor: 41667, promoterTotalMinor: 333333,
      paidTotalMinor: 100000, outstandingMinor: 233333, artistNetMinor: 291666, ignoredPayments: 0,
    })
  })
  it("never sums a payment in another currency (no FX)", () => {
    expect(bookingFinanceTotals({ ...base, commission: null, payments: [paid(30000), paid(99999, "USD"), paid(1, "JPY", null)] }))
      .toMatchObject({ paidTotalMinor: 30000, outstandingMinor: 70000, ignoredPayments: 2 })
  })
})

describe("currency rule (decision 2)", () => {
  it.each([
    ["EUR", "EUR", true], ["JPY", "JPY", true], ["USD", "EUR", false], ["EUR", null, false], ["EUR", undefined, false], ["eur", "EUR", false],
  ])("payment %s on a %s fee: %s", (payment, fee, expected) => {
    expect(paymentCurrencyMatchesFee(payment, fee)).toBe(expected)
  })
})

describe("stored commission", () => {
  it("reads a complete triple and ignores anything else", () => {
    expect(bookingCommission({ commission_type: "percent", commission_value: 1500, commission_mode: "included" }))
      .toEqual({ type: "percent", value: 1500, mode: "included" })
    expect(bookingCommission({ commission_type: "fixed", commission_value: 0, commission_mode: "on_top" }))
      .toEqual({ type: "fixed", value: 0, mode: "on_top" })
    for (const row of [
      {}, { commission_type: null, commission_value: null, commission_mode: null },
      { commission_type: "percent", commission_value: 1500 }, { commission_type: "tiered", commission_value: 1, commission_mode: "on_top" },
      { commission_type: "percent", commission_value: null, commission_mode: "on_top" },
    ]) expect(bookingCommission(row)).toBeNull()
  })
})

describe("display and input", () => {
  it.each([
    [125050, "EUR", "EUR 1,250.50"], [0, "USD", "USD 0.00"], [5, "GBP", "GBP 0.05"], [150000, "JPY", "JPY 150,000"],
    [999999999999, "EUR", "EUR 9,999,999,999.99"], [-20000, "EUR", "EUR -200.00"], [999, "JPY", "JPY 999"],
  ] as const)("formats %i %s as %s", (minor, currency, text) => {
    expect(formatMinorAmount(minor, currency)).toBe(text)
  })
  it.each([[1250, "12.5"], [1000, "10"], [5, "0.05"], [10000, "100"], [0, "0"], [1505, "15.05"], [50, "0.5"]])("formats %i basis points as %s", (basisPoints, text) => {
    expect(formatBasisPoints(basisPoints)).toBe(text)
  })
  it("labels a commission value by type, with or without a fee currency", () => {
    expect(formatCommissionValue("percent", 1250, "EUR")).toBe("12.5%")
    expect(formatCommissionValue("fixed", 25000, "EUR")).toBe("EUR 250.00")
    expect(formatCommissionValue("fixed", 25000, "JPY")).toBe("JPY 25,000")
    expect(formatCommissionValue("fixed", 25000, null)).toBe("250.00")
  })
  it.each([["12.5", 1250], ["10", 1000], [" 0,05 ", 5], ["100", 10000], ["0", 0], ["15.05", 1505]])("parses %s percent as %i basis points", (text, basisPoints) => {
    expect(parseCommissionPercent(text)).toEqual({ success: true, data: basisPoints })
  })
  it.each(["", "abc", "-5", "100.01", "101", "12.555", "1e2", "12.", "1 000"])("rejects the percentage %j instead of rounding or guessing", (text) => {
    expect(parseCommissionPercent(text).success).toBe(false)
  })
  it("parses money in the minor unit of the currency and can require a positive amount", () => {
    expect(parseMoneyAmount("300.50", "EUR", "payment amount", true)).toEqual({ success: true, data: 30050 })
    expect(parseMoneyAmount("150000", "JPY", "payment amount", true)).toEqual({ success: true, data: 150000 })
    expect(parseMoneyAmount("0", "EUR", "commission amount")).toEqual({ success: true, data: 0 })
    expect(parseMoneyAmount("0", "EUR", "payment amount", true)).toEqual({ success: false, error: "Enter a payment amount greater than zero" })
    expect(parseMoneyAmount("1.5", "JPY", "payment amount", true)).toEqual({ success: false, error: "Enter a whole-number JPY payment amount without separators" })
    for (const text of ["", "1,000.00", "-1", "1.001", "abc"]) expect(parseMoneyAmount(text, "EUR", "payment amount").success).toBe(false)
  })
})

describe("validation", () => {
  const payment = { kind: "deposit", amount_minor: 30000, currency: "EUR" }
  it("normalizes a payment: trims the note, blank note and dates become null only when sent", () => {
    expect(createPaymentSchema.parse({ ...payment, note: "  first half  ", due_on: "2026-12-01", paid_on: null }))
      .toEqual({ ...payment, note: "first half", due_on: "2026-12-01", paid_on: null })
    expect(createPaymentSchema.parse({ ...payment, note: "   " })).toEqual({ ...payment, note: null })
    expect(createPaymentSchema.parse(payment)).toEqual(payment)
  })
  it.each([
    { kind: "refund" }, { amount_minor: 0 }, { amount_minor: -1 }, { amount_minor: 1.5 }, { amount_minor: MAX_BOOKING_FEE_MINOR + 1 },
    { amount_minor: Number.NaN }, { currency: "CHF" }, { currency: null }, { due_on: "2026-02-30" }, { paid_on: "yesterday" },
    { note: "n".repeat(MAX_PAYMENT_NOTE_LENGTH + 1) }, { workspace_id: "w" }, { booking_id: "b" }, { id: "x" },
  ])("rejects the payment field %j", (patch) => {
    expect(createPaymentSchema.safeParse({ ...payment, ...patch }).success).toBe(false)
  })
  it("payment update: partial allowlist without currency, booking or workspace", () => {
    expect(updatePaymentSchema.parse({ paid_on: "2026-11-23" })).toEqual({ paid_on: "2026-11-23" })
    expect(updatePaymentSchema.parse({ paid_on: null, note: "" })).toEqual({ paid_on: null, note: null })
    for (const patch of [{}, { currency: "USD" }, { booking_id: "b" }, { workspace_id: "w" }, { amount_minor: 0 }, { kind: "x" }]) {
      expect(updatePaymentSchema.safeParse(patch).success).toBe(false)
    }
  })
  it("booking commission: all three together, or all null, or omitted", () => {
    const ok = [
      {}, { commission_type: null, commission_value: null, commission_mode: null },
      { commission_type: "percent", commission_value: 10000, commission_mode: "included" },
      { commission_type: "fixed", commission_value: MAX_BOOKING_FEE_MINOR, commission_mode: "on_top" },
      { commission_type: "fixed", commission_value: 500, commission_mode: "included", fee_amount_minor: 500, fee_currency: "EUR" },
      { commission_type: "fixed", commission_value: 501, commission_mode: "on_top", fee_amount_minor: 500, fee_currency: "EUR" },
    ]
    for (const patch of ok) expect(updateBookingSchema.safeParse(patch).success).toBe(true)
    const bad = [
      { commission_type: "percent" }, { commission_value: 1500 }, { commission_mode: "on_top" },
      { commission_type: "percent", commission_value: 1500 }, { commission_type: null, commission_value: 1500, commission_mode: "on_top" },
      { commission_type: "percent", commission_value: 10001, commission_mode: "on_top" },
      { commission_type: "percent", commission_value: -1, commission_mode: "on_top" },
      { commission_type: "percent", commission_value: 12.5, commission_mode: "on_top" },
      { commission_type: "tiered", commission_value: 1, commission_mode: "on_top" },
      { commission_type: "fixed", commission_value: 1, commission_mode: "split" },
      { commission_type: "fixed", commission_value: MAX_BOOKING_FEE_MINOR + 1, commission_mode: "on_top" },
      { commission_type: "fixed", commission_value: 501, commission_mode: "included", fee_amount_minor: 500, fee_currency: "EUR" },
    ]
    for (const patch of bad) expect(updateBookingSchema.safeParse(patch).success).toBe(false)
  })
  it("tax note: trimmed, blank clears, at most 2000 characters, omitted stays unchanged", () => {
    expect(updateBookingSchema.parse({ tax_note: "  VAT reverse charge  " })).toEqual({ tax_note: "VAT reverse charge" })
    expect(updateBookingSchema.parse({ tax_note: "  " })).toEqual({ tax_note: null })
    expect(updateBookingSchema.parse({ notes: "x" })).not.toHaveProperty("tax_note")
    expect(updateBookingSchema.safeParse({ tax_note: "t".repeat(MAX_TAX_NOTE_LENGTH) }).success).toBe(true)
    expect(updateBookingSchema.safeParse({ tax_note: "t".repeat(MAX_TAX_NOTE_LENGTH + 1) }).success).toBe(false)
  })
  it("artist default commission: type, value and mode together, or null (decision 13)", () => {
    expect(artistDefaultCommissionSchema.parse(null)).toBeNull()
    expect(artistDefaultCommissionSchema.parse({ type: "percent", value: 1250, mode: "included" }))
      .toEqual({ type: "percent", value: 1250, mode: "included", currency: null })
    expect(artistDefaultCommissionSchema.parse({ type: "percent", value: 10000, mode: "on_top", currency: null }))
      .toEqual({ type: "percent", value: 10000, mode: "on_top", currency: null })
    for (const input of [
      { type: "percent", value: 1250 }, { type: "percent", mode: "on_top" }, { value: 5, mode: "on_top" },
      { type: "percent", value: 5, mode: "split" }, { type: "tiered", value: 1, mode: "on_top" },
      { type: "percent", value: 10001, mode: "on_top" }, { type: "percent", value: -1, mode: "on_top" },
      { type: "percent", value: 12.5, mode: "on_top" }, { type: "percent", value: 5, mode: "on_top", extra: true }, undefined,
    ]) expect(artistDefaultCommissionSchema.safeParse(input).success).toBe(false)
  })
  it("artist default commission: a fixed default needs its own currency, a percent default has none (decision 12)", () => {
    for (const currency of ["EUR", "USD", "GBP", "JPY"]) {
      expect(artistDefaultCommissionSchema.parse({ type: "fixed", value: 25000, mode: "on_top", currency }))
        .toEqual({ type: "fixed", value: 25000, mode: "on_top", currency })
    }
    expect(artistDefaultCommissionSchema.safeParse({ type: "fixed", value: 25000, mode: "on_top" }).error?.issues[0].message)
      .toBe("Choose the currency of the fixed default commission")
    expect(artistDefaultCommissionSchema.safeParse({ type: "percent", value: 1250, mode: "on_top", currency: "EUR" }).error?.issues[0].message)
      .toBe("A percentage default commission has no currency")
    for (const input of [
      { type: "fixed", value: 25000, mode: "on_top", currency: null }, { type: "fixed", value: 25000, mode: "on_top", currency: "CHF" },
      { type: "fixed", value: 1.5, mode: "on_top", currency: "EUR" }, { type: "fixed", value: MAX_BOOKING_FEE_MINOR + 1, mode: "on_top", currency: "EUR" },
    ]) expect(artistDefaultCommissionSchema.safeParse(input).success).toBe(false)
  })
})

describe("artist default commission and its prefill (decisions 12 and 13)", () => {
  const row = (type: string | null, value: number | null, mode: string | null, currency: string | null = null) =>
    ({ default_commission_type: type, default_commission_value: value, default_commission_mode: mode, default_commission_currency: currency })
  const percentDefault = { type: "percent", value: 1250, mode: "included", currency: null } as const
  const eurDefault = { type: "fixed", value: 25000, mode: "on_top", currency: "EUR" } as const
  const jpyDefault = { type: "fixed", value: 30000, mode: "included", currency: "JPY" } as const

  it("reads a complete stored default and treats anything inconsistent as no default", () => {
    expect(artistDefaultCommission(row("percent", 1250, "included"))).toEqual(percentDefault)
    expect(artistDefaultCommission(row("fixed", 25000, "on_top", "EUR"))).toEqual(eurDefault)
    expect(artistDefaultCommission(row("fixed", 30000, "included", "JPY"))).toEqual(jpyDefault)
    for (const stored of [
      null, undefined, {}, row(null, null, null), row("percent", 1250, null), row("percent", null, "on_top"),
      row("percent", 10001, "on_top"), row("percent", 1250, "on_top", "EUR"), row("fixed", 25000, "on_top"),
      row("fixed", 25000, "on_top", "CHF"), row("fixed", 25000, "split", "EUR"), row("tiered", 1, "on_top"),
      row("fixed", -1, "on_top", "EUR"), row("fixed", 1.5, "on_top", "EUR"), row(null, null, null, "EUR"),
    ]) expect(artistDefaultCommission(stored)).toBeNull()
  })
  it("a percent default always applies, with the mode chosen on the artist", () => {
    for (const feeCurrency of [null, undefined, "", "EUR", "JPY"]) {
      expect(defaultCommissionPrefill(percentDefault, feeCurrency))
        .toEqual({ status: "applied", commission: { type: "percent", value: 1250, mode: "included" } })
    }
  })
  it("a fixed default applies only when the booking fee is in the default currency", () => {
    expect(defaultCommissionPrefill(eurDefault, "EUR")).toEqual({ status: "applied", commission: { type: "fixed", value: 25000, mode: "on_top" } })
    expect(defaultCommissionPrefill(jpyDefault, "JPY")).toEqual({ status: "applied", commission: { type: "fixed", value: 30000, mode: "included" } })
  })
  it.each([["EUR", "JPY"], ["EUR", "USD"], ["EUR", "GBP"], ["JPY", "EUR"]] as const)(
    "a %s fixed default prefills nothing on a %s booking: no conversion, no reinterpretation of minor units", (defaultCurrency, feeCurrency) => {
      const artistDefault = defaultCurrency === "EUR" ? eurDefault : jpyDefault
      expect(defaultCommissionPrefill(artistDefault, feeCurrency)).toEqual({ status: "currency_mismatch", currency: defaultCurrency })
    })
  it("a fixed default waits for a fee currency, and no default prefills nothing", () => {
    expect(defaultCommissionPrefill(eurDefault, null)).toEqual({ status: "awaiting_fee_currency", currency: "EUR" })
    expect(defaultCommissionPrefill(jpyDefault, "")).toEqual({ status: "awaiting_fee_currency", currency: "JPY" })
    expect(defaultCommissionPrefill(null, "EUR")).toEqual({ status: "none" })
  })
  it("describes a default with its own currency and mode; JPY has no decimals", () => {
    expect(formatArtistDefaultCommission(percentDefault)).toBe("12.5%, included in the fee")
    expect(formatArtistDefaultCommission(eurDefault)).toBe("EUR 250.00, on top of the fee")
    expect(formatArtistDefaultCommission(jpyDefault)).toBe("JPY 30,000, included in the fee")
  })
})
