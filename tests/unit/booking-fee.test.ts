import { describe, expect, it } from "vitest"
import { parseBookingFee, formatBookingFeeInput, MAX_BOOKING_FEE_MINOR } from "@/lib/booking-fee"
import { updateBookingSchema } from "@/lib/booking-validation"

describe("booking fee draft", () => {
  it.each([
    ["1050", "EUR", 105000], ["1050.00", "EUR", 105000],
    [" 1050,50 ", "GBP", 105050], ["0", "USD", 0],
    ["0.01", "EUR", 1], ["1050", "JPY", 1050],
    ["9999999999.99", "EUR", 999999999999],
  ])("parses %s %s exactly", (text, currency, minor) => {
    expect(parseBookingFee(String(text), String(currency))).toEqual({
      success: true, data: { fee_amount_minor: minor, fee_currency: currency },
    })
  })
  it("clears only an entirely blank pair", () => {
    expect(parseBookingFee("  ", "")).toEqual({ success: true, data: { fee_amount_minor: null, fee_currency: null } })
  })
  it.each([
    ["", "EUR"], ["1050", ""], ["1050", "CHF"], ["-1", "EUR"],
    ["+1", "EUR"], ["1e3", "EUR"], ["1,050.00", "EUR"],
    ["1.001", "EUR"], ["1.00", "JPY"], ["10000000000", "EUR"],
    ["NaN", "EUR"], ["Infinity", "EUR"],
  ])("rejects %s %s without rounding", (amount, currency) => {
    expect(parseBookingFee(amount, currency).success).toBe(false)
  })
  it("formats stored minor units without changing their meaning", () => {
    expect(formatBookingFeeInput(null, null)).toBe("")
    expect(formatBookingFeeInput(0, "EUR")).toBe("0.00")
    expect(formatBookingFeeInput(105050, "EUR")).toBe("1050.50")
    expect(formatBookingFeeInput(1050, "JPY")).toBe("1050")
  })
})

describe("booking update fee contract", () => {
  it.each([
    {}, { notes: "keep fee" }, { fee_amount_minor: null, fee_currency: null },
    { fee_amount_minor: 0, fee_currency: "EUR" },
    { fee_amount_minor: MAX_BOOKING_FEE_MINOR, fee_currency: "JPY" },
  ])("accepts an omitted or complete pair: %j", patch => {
    const parsed = updateBookingSchema.safeParse(patch)
    expect(parsed.success).toBe(true)
    if (parsed.success && "fee_amount_minor" in patch) expect(parsed.data).toMatchObject(patch)
  })
  it.each([
    { fee_amount_minor: 100 }, { fee_currency: "EUR" },
    { fee_amount_minor: null, fee_currency: "EUR" },
    { fee_amount_minor: 100, fee_currency: null },
    { fee_amount_minor: -1, fee_currency: "EUR" },
    { fee_amount_minor: 1.1, fee_currency: "EUR" },
    { fee_amount_minor: Number.NaN, fee_currency: "EUR" },
    { fee_amount_minor: Number.POSITIVE_INFINITY, fee_currency: "EUR" },
    { fee_amount_minor: 1000000000000, fee_currency: "EUR" },
    { fee_amount_minor: 100, fee_currency: "€" },
    { fee_amount_minor: "100", fee_currency: "EUR" },
  ])("rejects invalid or partial pairs: %j", patch => {
    expect(updateBookingSchema.safeParse(patch).success).toBe(false)
  })
})
