"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteCollection } from "@/lib/read-complete-collection";
import { getCurrentWorkspaceId } from "./workspace";
import { bookingIdSchema } from "@/lib/booking-validation";
import {
  PAYMENT_ALREADY_CLOSED_MESSAGE, PAYMENT_CORRECT_INSTEAD_MESSAGE, PAYMENT_CURRENCY_MESSAGE, PAYMENT_HISTORY_RESERVED_MESSAGE,
  PAYMENT_NEEDS_FEE_MESSAGE, createPaymentSchema, updatePaymentSchema, voidPaymentReasonSchema,
  type BookingPayment, type CreatePaymentInput, type UpdatePaymentInput,
} from "@/lib/booking-finance";

// Booking payments (P2, migrations 007 and 010). Workspace-scoped, validated, affected-row
// witness, fixed error copy: provider and database messages are logged, never returned.
// No hard delete: a payment is voided or corrected, and the original stays as history.

const PAYMENT_COLUMNS = "id, booking_id, kind, amount_minor, currency, due_on, paid_on, note, voided_at, void_kind, void_reason, replaces_payment_id";
const BOOKING_NOT_FOUND = "Booking not found";
const PAYMENT_NOT_FOUND = "Payment not found";
const INVALID_PAYMENT_ID = "Invalid payment ID";
const SAVE_FAILED = "Unable to save the payment. Please try again.";
const RETRY_UNCONFIRMED = "Unable to confirm this payment. Check the booking before starting another payment.";

type Result = { success: boolean; error?: string };

function revalidate(bookingId?: string) {
  revalidatePath("/dashboard/bookings");
  if (bookingId) revalidatePath(`/dashboard/bookings/${bookingId}`);
}

/** Payments of one booking, oldest due date first. Read failures reject; they are never an empty list. */
export async function getBookingPayments(bookingId: string): Promise<BookingPayment[]> {
  if (!bookingIdSchema.safeParse(bookingId).success) throw new Error("Invalid booking ID");
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error("Unable to load payments. Please try again.");
  if (!user) throw new Error("Not authenticated");
  const workspaceId = await getCurrentWorkspaceId();

  try {
    return await readCompleteCollection<BookingPayment>(async (from, to) => {
      const { data, error, count } = await supabase
        .from("booking_payments")
        .select(PAYMENT_COLUMNS, { count: "exact" })
        .eq("workspace_id", workspaceId)
        .eq("booking_id", bookingId)
        .order("due_on", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: data as unknown as BookingPayment[] | null, error, count };
    }, "Booking payments");
  } catch (error) {
    console.error("Error loading booking payments:", error);
    throw new Error("Unable to load payments. Please try again.");
  }
}

/**
 * Records a payment. `operationId` is the payment id and the idempotency key: the editor keeps
 * it with the draft (also across a page reload), so a retry after a lost response adopts the
 * row it already created instead of adding a second one. With `replacesPaymentId` the new
 * payment is a correction: in the same statement the original is marked corrected (010).
 */
export async function createBookingPayment(bookingId: string, input: CreatePaymentInput, operationId: string, replacesPaymentId?: string): Promise<Result> {
  if (!bookingIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" };
  if (!bookingIdSchema.safeParse(operationId).success) return { success: false, error: INVALID_PAYMENT_ID };
  if (replacesPaymentId !== undefined && (!bookingIdSchema.safeParse(replacesPaymentId).success
    || replacesPaymentId.toLowerCase() === operationId.toLowerCase())) return { success: false, error: INVALID_PAYMENT_ID };
  const validation = createPaymentSchema.safeParse(input);
  if (!validation.success) return { success: false, error: validation.error.issues[0].message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const workspaceId = await getCurrentWorkspaceId();

  // Currency rule, application side. The trigger (BB004) enforces it for every writer.
  const bookingQuery = () => supabase
    .from("bookings")
    .select("id")
    .eq("id", bookingId)
    .eq("workspace_id", workspaceId);
  const { data: booking, error: bookingError } = await bookingQuery()
    .eq("fee_currency", validation.data.currency).maybeSingle();
  if (bookingError) {
    console.error("Error reading the booking for a payment:", bookingError);
    return { success: false, error: SAVE_FAILED };
  }
  if (!booking) {
    // Preserve the missing/unsaved/mismatched distinctions without projecting a fee field.
    const [noFee, exists] = await Promise.all([
      bookingQuery().is("fee_currency", null).maybeSingle(), bookingQuery().maybeSingle(),
    ]);
    if (noFee.error || exists.error) return { success: false, error: SAVE_FAILED };
    return { success: false, error: !exists.data ? BOOKING_NOT_FOUND
      : noFee.data ? PAYMENT_NEEDS_FEE_MESSAGE : PAYMENT_CURRENCY_MESSAGE };
  }

  const payment = {
    ...validation.data,
    due_on: validation.data.due_on ?? null,
    paid_on: validation.data.paid_on ?? null,
    note: validation.data.note ?? null,
    ...(replacesPaymentId !== undefined ? { replaces_payment_id: replacesPaymentId.toLowerCase() } : {}),
  };
  const { data: created, error } = await supabase
    .from("booking_payments")
    .insert({ ...payment, id: operationId, workspace_id: workspaceId, booking_id: bookingId })
    .select("id")
    .maybeSingle();
  // A replayed correction fails BB007 first (its original is already corrected), a replayed
  // payment 23505 on its id. Either way, adopt only the identical row created under this key.
  if (error?.code === "23505" || (replacesPaymentId !== undefined && error?.code === "BB007")) {
    // A timed-out insert may have committed. Never upsert or dedupe by amount/date.
    const replayColumns: string = `kind, amount_minor, currency, due_on, paid_on, note${replacesPaymentId !== undefined ? ", replaces_payment_id" : ""}`;
    const { data: existing, error: readError } = await supabase.from("booking_payments")
      .select(replayColumns)
      .eq("id", operationId).eq("workspace_id", workspaceId).eq("booking_id", bookingId).maybeSingle();
    if (readError || !existing || Object.entries(payment).some(([key, value]) => (existing as unknown as Record<string, unknown>)[key] !== value)) {
      return { success: false, error: error.code === "BB007" && !readError && !existing ? PAYMENT_ALREADY_CLOSED_MESSAGE : RETRY_UNCONFIRMED };
    }
    revalidate(bookingId);
    return { success: true };
  }
  if (error) {
    console.error("Error creating booking payment:", error);
    if (error.code === "BB004") return { success: false, error: PAYMENT_CURRENCY_MESSAGE };
    if (error.code === "23503") return { success: false, error: replacesPaymentId !== undefined ? PAYMENT_NOT_FOUND : BOOKING_NOT_FOUND };
    if (error.code === "BB007") return { success: false, error: PAYMENT_ALREADY_CLOSED_MESSAGE };
    return { success: false, error: SAVE_FAILED };
  }
  if (created?.id !== operationId.toLowerCase()) return { success: false, error: SAVE_FAILED };

  revalidate(bookingId);
  return { success: true };
}

/** Marks an unpaid payment as paid. Any other change is a correction or a void. */
export async function updateBookingPayment(paymentId: string, patch: UpdatePaymentInput): Promise<Result> {
  if (!bookingIdSchema.safeParse(paymentId).success) return { success: false, error: INVALID_PAYMENT_ID };
  if (patch && typeof patch === "object" && Object.keys(patch).some((key) => key !== "paid_on")) {
    return { success: false, error: PAYMENT_CORRECT_INSTEAD_MESSAGE };
  }
  const validation = updatePaymentSchema.safeParse(patch);
  if (!validation.success) return { success: false, error: validation.error.issues[0].message };
  if (validation.data.paid_on === null) return { success: false, error: PAYMENT_HISTORY_RESERVED_MESSAGE };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const workspaceId = await getCurrentWorkspaceId();

  // The schema is the write allowlist: no currency, booking or workspace can be changed here.
  const dbPatch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(validation.data)) {
    if (value !== undefined) dbPatch[field] = value;
  }
  const { data: changed, error } = await supabase
    .from("booking_payments")
    .update(dbPatch)
    .eq("id", paymentId)
    .eq("workspace_id", workspaceId)
    .select("id, booking_id")
    .maybeSingle();
  if (error) {
    console.error("Error updating booking payment:", error);
    return { success: false, error: error.code === "BB006" ? PAYMENT_HISTORY_RESERVED_MESSAGE
      : error.code === "BB004" ? PAYMENT_CURRENCY_MESSAGE : SAVE_FAILED };
  }
  if (!changed) return { success: false, error: PAYMENT_NOT_FOUND };

  revalidate(changed.booking_id);
  return { success: true };
}

/**
 * Voids a payment (e.g. the event was cancelled). The row stays as history with its reason and
 * the database time; it no longer counts in totals. An identical retry is a no-op success.
 */
export async function voidBookingPayment(paymentId: string, reason: string): Promise<Result> {
  if (!bookingIdSchema.safeParse(paymentId).success) return { success: false, error: INVALID_PAYMENT_ID };
  const validation = voidPaymentReasonSchema.safeParse(reason);
  if (!validation.success) return { success: false, error: validation.error.issues[0].message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const workspaceId = await getCurrentWorkspaceId();

  const { data: changed, error } = await supabase
    .from("booking_payments")
    .update({ void_kind: "void", void_reason: validation.data })
    .eq("id", paymentId)
    .eq("workspace_id", workspaceId)
    .select("id, booking_id")
    .maybeSingle();
  if (error) {
    console.error("Error voiding booking payment:", error);
    return { success: false, error: error.code === "BB006" || error.code === "BB007" ? PAYMENT_ALREADY_CLOSED_MESSAGE : SAVE_FAILED };
  }
  if (!changed) return { success: false, error: PAYMENT_NOT_FOUND };

  revalidate(changed.booking_id);
  return { success: true };
}

export async function deleteBookingPayment(paymentId: string): Promise<Result> {
  if (!bookingIdSchema.safeParse(paymentId).success) return { success: false, error: INVALID_PAYMENT_ID };
  // Keep obsolete callers fail-closed without looking up or mutating any record.
  return { success: false, error: PAYMENT_HISTORY_RESERVED_MESSAGE };
}
