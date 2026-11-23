"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteCollection } from "@/lib/read-complete-collection";
import { getCurrentWorkspaceId } from "./workspace";
import { bookingIdSchema } from "@/lib/booking-validation";
import {
  PAYMENT_CURRENCY_MESSAGE, PAYMENT_NEEDS_FEE_MESSAGE, createPaymentSchema, paymentCurrencyMatchesFee,
  updatePaymentSchema, type BookingPayment, type CreatePaymentInput, type UpdatePaymentInput,
} from "@/lib/booking-finance";

// Booking payments (P2, migration 007). Workspace-scoped, validated, affected-row witness,
// fixed error copy: provider and database messages are logged, never returned.

const PAYMENT_COLUMNS = "id, booking_id, kind, amount_minor, currency, due_on, paid_on, note";
const BOOKING_NOT_FOUND = "Booking not found";
const PAYMENT_NOT_FOUND = "Payment not found";
const INVALID_PAYMENT_ID = "Invalid payment ID";
const SAVE_FAILED = "Unable to save the payment. Please try again.";
const DELETE_FAILED = "Unable to delete the payment. Please try again.";

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

export async function createBookingPayment(bookingId: string, input: CreatePaymentInput): Promise<Result> {
  if (!bookingIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" };
  const validation = createPaymentSchema.safeParse(input);
  if (!validation.success) return { success: false, error: validation.error.issues[0].message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const workspaceId = await getCurrentWorkspaceId();

  // Currency rule, application side. The trigger (BB004) enforces it for every writer.
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, fee_currency")
    .eq("id", bookingId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (bookingError) {
    console.error("Error reading the booking for a payment:", bookingError);
    return { success: false, error: SAVE_FAILED };
  }
  if (!booking) return { success: false, error: BOOKING_NOT_FOUND };
  if (booking.fee_currency == null) return { success: false, error: PAYMENT_NEEDS_FEE_MESSAGE };
  if (!paymentCurrencyMatchesFee(validation.data.currency, booking.fee_currency)) {
    return { success: false, error: PAYMENT_CURRENCY_MESSAGE };
  }

  const { data: created, error } = await supabase
    .from("booking_payments")
    .insert({ ...validation.data, workspace_id: workspaceId, booking_id: bookingId })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Error creating booking payment:", error);
    if (error.code === "BB004") return { success: false, error: PAYMENT_CURRENCY_MESSAGE };
    if (error.code === "23503") return { success: false, error: BOOKING_NOT_FOUND };
    return { success: false, error: SAVE_FAILED };
  }
  if (!created) return { success: false, error: SAVE_FAILED };

  revalidate(bookingId);
  return { success: true };
}

export async function updateBookingPayment(paymentId: string, patch: UpdatePaymentInput): Promise<Result> {
  if (!bookingIdSchema.safeParse(paymentId).success) return { success: false, error: INVALID_PAYMENT_ID };
  const validation = updatePaymentSchema.safeParse(patch);
  if (!validation.success) return { success: false, error: validation.error.issues[0].message };
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
    return { success: false, error: error.code === "BB004" ? PAYMENT_CURRENCY_MESSAGE : SAVE_FAILED };
  }
  if (!changed) return { success: false, error: PAYMENT_NOT_FOUND };

  revalidate(changed.booking_id);
  return { success: true };
}

export async function deleteBookingPayment(paymentId: string): Promise<Result> {
  if (!bookingIdSchema.safeParse(paymentId).success) return { success: false, error: INVALID_PAYMENT_ID };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const workspaceId = await getCurrentWorkspaceId();

  const { data: removed, error } = await supabase
    .from("booking_payments")
    .delete()
    .eq("id", paymentId)
    .eq("workspace_id", workspaceId)
    .select("id, booking_id")
    .maybeSingle();
  if (error) {
    console.error("Error deleting booking payment:", error);
    return { success: false, error: DELETE_FAILED };
  }
  if (!removed) return { success: false, error: PAYMENT_NOT_FOUND };

  revalidate(removed.booking_id);
  return { success: true };
}
