import { z } from "zod"
import {
  BOOKING_FEE_CURRENCIES, MAX_BOOKING_FEE_MINOR, formatBookingFeeInput, parseBookingFee,
  type BookingFeeCurrency,
} from "./booking-fee"

// Booking finance (P2). Pure functions over integer minor units; nothing derived is stored.
// The database enforces the same rules for every writer (migrations/007_booking_finance.sql).

export const COMMISSION_TYPES = ["percent", "fixed"] as const
export type CommissionType = (typeof COMMISSION_TYPES)[number]
export const COMMISSION_MODES = ["on_top", "included"] as const
export type CommissionMode = (typeof COMMISSION_MODES)[number]
export const PAYMENT_KINDS = ["deposit", "balance", "other"] as const
export type PaymentKind = (typeof PAYMENT_KINDS)[number]

/** Percent commissions are stored in basis points: 10000 = 100%. */
export const MAX_COMMISSION_BASIS_POINTS = 10000
export const MAX_TAX_NOTE_LENGTH = 2000
export const MAX_PAYMENT_NOTE_LENGTH = 500
/** Mode preselected when a commission is first entered by hand, on a booking or on an artist. */
export const DEFAULT_COMMISSION_MODE: CommissionMode = "on_top"

// Fixed user-facing copy shared by server actions and the editor (never a provider message).
export const BOOKING_HAS_PAYMENTS_MESSAGE =
  "This booking has recorded payments and cannot be deleted. Remove its payments first, or cancel the booking instead."
export const FEE_CURRENCY_LOCKED_MESSAGE =
  "The fee currency cannot be changed while payments are recorded for this booking. The fee amount can still be changed."
export const PAYMENT_NEEDS_FEE_MESSAGE = "Set and save a booking fee before recording payments."
export const PAYMENT_CURRENCY_MESSAGE = "A payment must be in the booking fee currency."
export const PAYMENT_CURRENCY_PENDING_MESSAGE =
  "Save or undo the fee currency change before recording a payment."

export const COMMISSION_MODE_LABELS: Record<CommissionMode, string> = {
  on_top: "On top of the fee (the promoter pays fee + commission)",
  included: "Included in the fee (deducted from the artist's fee)",
}
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  deposit: "Deposit",
  balance: "Balance",
  other: "Other",
}

export type BookingCommission = { type: CommissionType; value: number; mode: CommissionMode }
export type BookingPayment = {
  id: string
  booking_id: string
  kind: PaymentKind
  amount_minor: number
  currency: BookingFeeCurrency
  due_on: string | null
  paid_on: string | null
  note: string | null
}

/**
 * Commission amount in minor units of the fee currency.
 * Percent: fee × basis points / 10000, rounded half up to the minor unit (so to the whole
 * yen for JPY). BigInt keeps the product exact beyond Number.MAX_SAFE_INTEGER.
 * Fixed: the stored amount, already in minor units of the fee currency.
 */
export function commissionAmountMinor(feeMinor: number, commission: Pick<BookingCommission, "type" | "value"> | null): number {
  if (!commission) return 0
  if (commission.type === "fixed") return commission.value
  return Number((BigInt(feeMinor) * BigInt(commission.value) + BigInt(5000)) / BigInt(10000))
}

export type BookingFinanceTotals = {
  currency: BookingFeeCurrency
  feeMinor: number
  /** Agency commission amount. */
  commissionMinor: number
  /** fee + commission when the commission is on top, otherwise the fee. */
  promoterTotalMinor: number
  /** Sum of the payments that have a paid date. */
  paidTotalMinor: number
  /** promoter total − paid total. Negative when more was paid than is due. */
  outstandingMinor: number
  /** fee − commission when the commission is included, otherwise the fee. */
  artistNetMinor: number
  /** Payments in another currency (cannot be stored after migration 007) are never summed. */
  ignoredPayments: number
}

type TotalsInput = {
  feeMinor: number | null
  currency: BookingFeeCurrency | null
  commission: BookingCommission | null
  payments: readonly Pick<BookingPayment, "amount_minor" | "currency" | "paid_on">[]
}

/** Null when the booking has no fee: there is nothing to derive totals from. */
export function bookingFinanceTotals({ feeMinor, currency, commission, payments }: TotalsInput): BookingFinanceTotals | null {
  if (feeMinor === null || currency === null) return null
  const commissionMinor = commissionAmountMinor(feeMinor, commission)
  const sameCurrency = payments.filter((payment) => payment.currency === currency)
  const paidTotalMinor = sameCurrency.reduce((sum, payment) => payment.paid_on ? sum + payment.amount_minor : sum, 0)
  const promoterTotalMinor = commission?.mode === "on_top" ? feeMinor + commissionMinor : feeMinor
  return {
    currency,
    feeMinor,
    commissionMinor,
    promoterTotalMinor,
    paidTotalMinor,
    outstandingMinor: promoterTotalMinor - paidTotalMinor,
    artistNetMinor: commission?.mode === "included" ? feeMinor - commissionMinor : feeMinor,
    ignoredPayments: payments.length - sameCurrency.length,
  }
}

/** Decision 2: a payment is always in the booking fee currency; no fee means no payments. */
export function paymentCurrencyMatchesFee(paymentCurrency: string, feeCurrency: string | null | undefined): boolean {
  return feeCurrency != null && paymentCurrency === feeCurrency
}

type CommissionRow = { commission_type?: string | null; commission_value?: number | null; commission_mode?: string | null }
/** Reads the stored triple defensively; anything incomplete or unknown is "no commission". */
export function bookingCommission(row: CommissionRow): BookingCommission | null {
  const type = COMMISSION_TYPES.find((value) => value === row.commission_type)
  const mode = COMMISSION_MODES.find((value) => value === row.commission_mode)
  if (!type || !mode || typeof row.commission_value !== "number") return null
  return { type, value: row.commission_value, mode }
}

/** Display: grouped amount with the ISO code, e.g. "EUR 1,250.00" or "JPY 150,000". */
export function formatMinorAmount(minor: number, currency: BookingFeeCurrency): string {
  const sign = minor < 0 ? "-" : ""
  const [whole, fraction] = formatBookingFeeInput(Math.abs(minor), currency).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${currency} ${sign}${grouped}${fraction === undefined ? "" : `.${fraction}`}`
}

/** 1250 → "12.5", 1000 → "10", 5 → "0.05". */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100)
  const fraction = String(basisPoints % 100).padStart(2, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function formatCommissionValue(type: CommissionType, value: number, currency: BookingFeeCurrency | null): string {
  if (type === "percent") return `${formatBasisPoints(value)}%`
  // A fixed commission on a booking that has no fee yet has no currency to show: it is
  // displayed as a plain two-decimal number without a code.
  return currency ? formatMinorAmount(value, currency) : formatBookingFeeInput(value, "EUR")
}

type ParseResult<T> = { success: true; data: T } | { success: false; error: string }

/** "12.5" → 1250 basis points. At most two decimals, 0 to 100. Excess precision is rejected. */
export function parseCommissionPercent(text: string): ParseResult<number> {
  const value = text.trim()
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value)) {
    return { success: false, error: "Enter a commission percentage between 0 and 100 with at most two decimals" }
  }
  const [whole, fraction = ""] = value.replace(",", ".").split(".")
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  if (basisPoints > MAX_COMMISSION_BASIS_POINTS) {
    return { success: false, error: "Enter a commission percentage between 0 and 100 with at most two decimals" }
  }
  return { success: true, data: basisPoints }
}

/**
 * A money amount typed by the user, in minor units of `currency`, strictly positive when
 * `positive` is set. Same input rules as the booking fee (no grouping, JPY whole numbers).
 */
export function parseMoneyAmount(text: string, currency: BookingFeeCurrency, label: string, positive = false): ParseResult<number> {
  const parsed = parseBookingFee(text, currency)
  if (!parsed.success || parsed.data.fee_amount_minor === null) {
    return { success: false, error: currency === "JPY"
      ? `Enter a whole-number JPY ${label} without separators`
      : `Enter a ${label} with at most two decimals and no grouping separators` }
  }
  if (positive && parsed.data.fee_amount_minor === 0) {
    return { success: false, error: `Enter a ${label} greater than zero` }
  }
  return { success: true, data: parsed.data.fee_amount_minor }
}

const commissionValue = z.number().finite().int().min(0).max(MAX_BOOKING_FEE_MINOR)
/** Booking commission fields of the update allowlist. All omitted = unchanged, all null = clear. */
export const bookingCommissionShape = {
  commission_type: z.enum(COMMISSION_TYPES).nullable().optional(),
  commission_value: commissionValue.nullable().optional(),
  commission_mode: z.enum(COMMISSION_MODES).nullable().optional(),
}
type CommissionPatch = {
  commission_type?: CommissionType | null
  commission_value?: number | null
  commission_mode?: CommissionMode | null
  fee_amount_minor?: number | null
}
const COMMISSION_SET_MESSAGE = "Enter commission type, value and mode together, or clear all three"
export const COMMISSION_PERCENT_MESSAGE = "A percentage commission must be between 0 and 100"
export const COMMISSION_WITHIN_FEE_MESSAGE = "A fixed commission included in the fee cannot be greater than the fee"

export function validateBookingCommission(value: CommissionPatch, context: z.RefinementCtx) {
  const fields = [value.commission_type, value.commission_value, value.commission_mode]
  if (fields.every((field) => field === undefined) || fields.every((field) => field === null)) return
  if (fields.some((field) => field == null)) {
    context.addIssue({ code: "custom", path: ["commission_type"], message: COMMISSION_SET_MESSAGE })
    return
  }
  if (value.commission_type === "percent" && value.commission_value! > MAX_COMMISSION_BASIS_POINTS) {
    context.addIssue({ code: "custom", path: ["commission_value"], message: COMMISSION_PERCENT_MESSAGE })
  }
  // Checked here only when the same patch carries the fee; the database CHECK covers the rest.
  if (value.commission_type === "fixed" && value.commission_mode === "included"
      && typeof value.fee_amount_minor === "number" && value.commission_value! > value.fee_amount_minor) {
    context.addIssue({ code: "custom", path: ["commission_value"], message: COMMISSION_WITHIN_FEE_MESSAGE })
  }
}

export const DEFAULT_CURRENCY_REQUIRED_MESSAGE = "Choose the currency of the fixed default commission"
export const DEFAULT_CURRENCY_FORBIDDEN_MESSAGE = "A percentage default commission has no currency"
/**
 * Artist default commission, or null to clear: type, value and mode together (decision 13).
 * A fixed default carries its own currency and its value is in minor units of that currency;
 * a percent default has none (decision 12).
 */
export const artistDefaultCommissionSchema = z.object({
  type: z.enum(COMMISSION_TYPES, "Choose a commission type"),
  value: commissionValue,
  mode: z.enum(COMMISSION_MODES, "Choose a commission mode"),
  currency: z.enum(BOOKING_FEE_CURRENCIES, "Choose a supported currency").nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.type === "percent" && value.value > MAX_COMMISSION_BASIS_POINTS) {
    context.addIssue({ code: "custom", path: ["value"], message: COMMISSION_PERCENT_MESSAGE })
  }
  if (value.type === "fixed" && value.currency == null) {
    context.addIssue({ code: "custom", path: ["currency"], message: DEFAULT_CURRENCY_REQUIRED_MESSAGE })
  }
  if (value.type === "percent" && value.currency != null) {
    context.addIssue({ code: "custom", path: ["currency"], message: DEFAULT_CURRENCY_FORBIDDEN_MESSAGE })
  }
}).transform((value) => ({ ...value, currency: value.currency ?? null })).nullable()
export type ArtistDefaultCommissionInput = z.input<typeof artistDefaultCommissionSchema>
export type ArtistDefaultCommission = {
  type: CommissionType
  value: number
  mode: CommissionMode
  /** Set exactly when the type is fixed. */
  currency: BookingFeeCurrency | null
}

type ArtistDefaultRow = {
  default_commission_type?: string | null
  default_commission_value?: number | null
  default_commission_mode?: string | null
  default_commission_currency?: string | null
}
/** Reads the stored default defensively; anything incomplete or inconsistent is "no default". */
export function artistDefaultCommission(row: ArtistDefaultRow | null | undefined): ArtistDefaultCommission | null {
  if (!row) return null
  const type = COMMISSION_TYPES.find((value) => value === row.default_commission_type)
  const mode = COMMISSION_MODES.find((value) => value === row.default_commission_mode)
  const value = row.default_commission_value
  if (!type || !mode || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null
  if (type === "percent") {
    return value <= MAX_COMMISSION_BASIS_POINTS && row.default_commission_currency == null
      ? { type, value, mode, currency: null } : null
  }
  const currency = BOOKING_FEE_CURRENCIES.find((code) => code === row.default_commission_currency)
  return currency && value <= MAX_BOOKING_FEE_MINOR ? { type, value, mode, currency } : null
}

export type DefaultCommissionPrefill =
  | { status: "none" }
  | { status: "applied"; commission: BookingCommission }
  /** Fixed default, and the booking has no fee currency yet. */
  | { status: "awaiting_fee_currency"; currency: BookingFeeCurrency }
  /** Fixed default in another currency than the booking fee: nothing is prefilled. */
  | { status: "currency_mismatch"; currency: BookingFeeCurrency }

/**
 * What a new booking takes from the artist default. A percent default always applies.
 * A fixed default applies only when the booking fee currency equals the default currency:
 * there is no conversion, so any other currency prefills nothing.
 */
export function defaultCommissionPrefill(
  artistDefault: ArtistDefaultCommission | null,
  feeCurrency: string | null | undefined,
): DefaultCommissionPrefill {
  if (!artistDefault) return { status: "none" }
  const commission = { type: artistDefault.type, value: artistDefault.value, mode: artistDefault.mode }
  if (artistDefault.type === "percent" || artistDefault.currency === null) {
    return artistDefault.type === "percent" ? { status: "applied", commission } : { status: "none" }
  }
  if (!feeCurrency) return { status: "awaiting_fee_currency", currency: artistDefault.currency }
  return feeCurrency === artistDefault.currency
    ? { status: "applied", commission }
    : { status: "currency_mismatch", currency: artistDefault.currency }
}

/** "12.5%, on top of the fee" or "EUR 250.00, included in the fee". */
export function formatArtistDefaultCommission(artistDefault: ArtistDefaultCommission): string {
  return `${formatCommissionValue(artistDefault.type, artistDefault.value, artistDefault.currency)}, ${
    artistDefault.mode === "on_top" ? "on top of the fee" : "included in the fee"}`
}

const optionalDate = (message: string) => z.string().date(message).nullable().optional()
const paymentNote = z.string().trim()
  .max(MAX_PAYMENT_NOTE_LENGTH, `Payment note must be at most ${MAX_PAYMENT_NOTE_LENGTH} characters`)
  .nullable().optional().transform((value) => value === "" ? null : value)
const paymentFields = {
  kind: z.enum(PAYMENT_KINDS, "Choose a payment type"),
  amount_minor: z.number("Enter a payment amount").finite().int()
    .min(1, "Enter a payment amount greater than zero").max(MAX_BOOKING_FEE_MINOR, "Payment amount is too large"),
  due_on: optionalDate("Enter a valid due date"),
  paid_on: optionalDate("Enter a valid paid date"),
  note: paymentNote,
}
/** Create allowlist. The currency is checked against the booking fee currency by the action. */
export const createPaymentSchema = z.object({
  ...paymentFields,
  currency: z.enum(BOOKING_FEE_CURRENCIES, "Choose a supported currency"),
}).strict()
/** Update allowlist: omitted = unchanged, null clears a date or the note. No currency, no booking. */
export const updatePaymentSchema = z.object(paymentFields).partial().strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Nothing to update")
export type CreatePaymentInput = z.input<typeof createPaymentSchema>
export type UpdatePaymentInput = z.input<typeof updatePaymentSchema>
