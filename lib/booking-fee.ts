import { z } from "zod"

export const BOOKING_FEE_CURRENCIES = ["EUR", "USD", "GBP", "JPY"] as const
export type BookingFeeCurrency = typeof BOOKING_FEE_CURRENCIES[number]
export const MAX_BOOKING_FEE_MINOR = 999999999999
const fractionDigits: Record<BookingFeeCurrency, number> = { EUR: 2, USD: 2, GBP: 2, JPY: 0 }
const currencySchema = z.enum(BOOKING_FEE_CURRENCIES)
export const bookingFeeShape = {
  fee_amount_minor: z.number().finite().int().min(0).max(MAX_BOOKING_FEE_MINOR).nullable().optional(),
  fee_currency: currencySchema.nullable().optional(),
}
type FeePatch = {
  fee_amount_minor?: number | null
  fee_currency?: BookingFeeCurrency | null
}
export function validateBookingFeePair(value: FeePatch, context: z.RefinementCtx) {
  if (value.fee_amount_minor === undefined && value.fee_currency === undefined) return
  if (value.fee_amount_minor === null && value.fee_currency === null) return
  if (typeof value.fee_amount_minor === "number" && value.fee_currency != null) return
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["fee_amount_minor"],
    message: "Enter both booking fee amount and currency, or clear both",
  })
}
export type BookingFeePair = {
  fee_amount_minor: number | null
  fee_currency: BookingFeeCurrency | null
}
type FeeResult = { success: true; data: BookingFeePair } | { success: false; error: string }

export function parseBookingFee(amount: string, currency: string): FeeResult {
  const text = amount.trim()
  if (text === "" && currency === "") {
    return { success: true, data: { fee_amount_minor: null, fee_currency: null } }
  }
  const parsedCurrency = currencySchema.safeParse(currency)
  if (!parsedCurrency.success || text === "") {
    return { success: false, error: "Enter both booking fee amount and currency, or clear both" }
  }
  const code = parsedCurrency.data
  const digits = fractionDigits[code]
  const pattern = digits === 0 ? /^\d{1,12}$/ : /^\d{1,10}(?:[.,]\d{1,2})?$/
  if (!pattern.test(text)) {
    return { success: false, error: digits === 0
      ? "Enter a whole-number JPY fee without separators"
      : "Enter a booking fee with at most two decimals and no grouping separators" }
  }
  const [whole, fraction = ""] = text.replace(",", ".").split(".")
  const minor = Number(whole) * 10 ** digits + (digits === 0 ? 0 : Number(fraction.padEnd(digits, "0")))
  if (!Number.isSafeInteger(minor) || minor > MAX_BOOKING_FEE_MINOR) {
    return { success: false, error: "Booking fee is too large" }
  }
  return { success: true, data: { fee_amount_minor: minor, fee_currency: code } }
}

export function formatBookingFeeInput(minor: number | null, currency: BookingFeeCurrency | null): string {
  if (minor === null || currency === null) return ""
  const digits = fractionDigits[currency]
  if (digits === 0) return String(minor)
  const factor = 10 ** digits
  return `${Math.floor(minor / factor)}.${String(minor % factor).padStart(digits, "0")}`
}
