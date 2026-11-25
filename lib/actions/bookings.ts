"use server";

import { readCompleteCollection } from "@/lib/read-complete-collection";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "./workspace";
import type { BookingFeeCurrency } from "@/lib/booking-fee";
import { bookingTransitionBlock, canTransitionBooking, type BookingStatus, type BookingTransitionBlock } from "@/lib/booking-status";
import { configuredCalendarDay } from "@/lib/calendar-day";
import { createBookingSchema, updateBookingSchema, bookingStatusSchema, bookingIdSchema } from "@/lib/booking-validation";
import { BOOKING_EVENT_COPY, isBookingPromoterViolation } from "@/lib/booking-event";

export interface Booking {
  fee_amount_minor: number | null;
  fee_currency: BookingFeeCurrency | null;
  id: string;
  workspace_id: string;
  artist_id: string;
  date: string;
  start_time: string;
  duration_minutes: number | null;
  notes: string | null;
  venue_name: string | null;
  venue_address: string | null;
  contact_name_main: string | null;
  contact_phone_main: string | null;
  contact_email_main: string | null;
  status: BookingStatus;
  /** Present after migration 006; only meaningful while status is "hold". */
  hold_expires_on?: string | null;
  /** Present after migration 008. Optional promoter from the directory; the free-text main contact is separate. */
  promoter_id?: string | null;
  created_at: string;
  updated_at: string;
  artist?: {
    id: string;
    stage_name: string | null;
    name: string | null;
    surname: string | null;
    location: string | null;
    fee: number | null;
    currency: string | null;
    profile_image_url: string | null;
  } | null;
}

export interface BookingWithArtist extends Booking {
  artist: {
    id: string;
    stage_name: string | null;
    name: string | null;
    surname: string | null;
    location: string | null;
    fee: number | null;
    currency: string | null;
    profile_image_url: string | null;
  };
}

// List projections (R17/F19): each caller receives only the fields it renders or
// computes from (duration_minutes: start–end and "next day" times, F20). Notes, contacts, fees, workspace_id and the artist's fee never leave
// the server through a list read; the single-booking detail read (getBooking) is the
// only wide read. Keep these in sync with tests/unit/bookings-read-projection.test.ts.
const BOOKING_LIST_COLUMNS = {
  calendar: "id,artist_id,date,start_time,duration_minutes,status",
  dashboard: "id,artist_id,date,start_time,duration_minutes,status,venue_name,venue_address,artist:artists(stage_name,name)",
  list: "id,artist_id,date,start_time,duration_minutes,status,hold_expires_on,created_at,venue_name,venue_address,artist:artists(stage_name,name)",
} as const;
const CREATED_BOOKING_COLUMNS = "id,artist_id,date";

type BookingArtistName = { stage_name: string | null; name: string | null } | null;
/** Artist profile calendar and the same-day notice of the new booking dialog. */
export type BookingCalendarItem = Pick<Booking, "id" | "artist_id" | "date" | "start_time" | "duration_minutes" | "status">;
/** Dashboard "Bookings in progress" cards. */
export type BookingDashboardItem = BookingCalendarItem &
  Pick<Booking, "venue_name" | "venue_address"> & { artist: BookingArtistName };
/** Bookings list page (server-rendered) and server-only counts on the detail page. */
export type BookingListItem = BookingDashboardItem & Pick<Booking, "created_at" | "hold_expires_on">;
export type BookingFields = keyof typeof BOOKING_LIST_COLUMNS;
type BookingRows = { calendar: BookingCalendarItem; dashboard: BookingDashboardItem; list: BookingListItem };
/** What createBooking returns to the dialog: identity, artist check and the saved date. */
export type CreatedBooking = Pick<Booking, "id" | "artist_id" | "date">;

// Fixed user-facing copy: provider/database messages are logged, never returned.
const TRANSITION_BLOCK_MESSAGES: Record<BookingTransitionBlock, string> = {
  not_allowed: "This status change is not allowed.",
  not_performed_yet: "A booking can be marked as completed only on or after its date.",
};
const BOOKING_NOT_FOUND = "Booking not found";
const BOOKING_CHANGED_ELSEWHERE = "This booking was changed elsewhere. Reload and try again.";

type ProviderError = { code?: string | null } | null;
/** SQLSTATEs raised by backbeat_enforce_booking_status (migration 006). */
function lifecycleErrorMessage(error: ProviderError): string | null {
  if (error?.code === "BB002") return TRANSITION_BLOCK_MESSAGES.not_allowed;
  if (error?.code === "BB003") return "A completed booking cannot be moved to a future date.";
  return null;
}

// failOnError is retained for source compatibility only.
// Collection/auth failures always reject; false no longer means "return []".
export async function getBookings<F extends BookingFields = "list">(
  options: { artistId?: string; failOnError?: boolean; fields?: F } = {}
): Promise<BookingRows[F][]> {
  const fields = options.fields ?? "list";
  if (!Object.hasOwn(BOOKING_LIST_COLUMNS, fields)) throw new Error("Invalid booking fields");
  const columns: string = BOOKING_LIST_COLUMNS[fields];
  if (
    options.artistId !== undefined &&
    !createBookingSchema.shape.artistId.safeParse(options.artistId).success
  ) {
    throw new Error("Invalid artist ID");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error("Unable to load bookings. Please try again.");
  }
  if (!user) throw new Error("Not authenticated");

  const workspaceId = await getCurrentWorkspaceId();

  try {
    return await readCompleteCollection<BookingRows[F]>(async (from, to) => {
      let query = supabase
        .from("bookings")
        .select(columns, { count: "exact" })
        .eq("workspace_id", workspaceId);

      if (options.artistId !== undefined) {
        query = query.eq("artist_id", options.artistId);
      }

      const { data, error, count } = await query
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      return {
        data: data as unknown as BookingRows[F][] | null,
        error,
        count,
      };
    }, "Bookings");
  } catch {
    throw new Error("Unable to load bookings. Please try again.");
  }
}

export async function createBooking(formData: {
  artistId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  notes?: string;
  promoterId?: string;
}): Promise<{ success: boolean; error?: string; booking?: CreatedBooking }> {
  const validation = createBookingSchema.safeParse(formData);
  if (!validation.success) return { success: false, error: validation.error.issues[0].message };
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const workspaceId = await getCurrentWorkspaceId();

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      workspace_id: workspaceId,
      artist_id: formData.artistId,
      date: formData.date,
      start_time: formData.startTime,
      duration_minutes: formData.durationMinutes || null,
      notes: formData.notes || null,
      status: "in_progress",
      ...(validation.data.promoterId ? { promoter_id: validation.data.promoterId } : {}),
    })
    .select(CREATED_BOOKING_COLUMNS)
    .single();

  if (error) {
    console.error("Error creating booking:", error);
    if (isBookingPromoterViolation(error)) return { success: false, error: BOOKING_EVENT_COPY.promoterGone };
    return { success: false, error: "Unable to create booking. Please try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/artists");

  return { success: true, booking: booking as CreatedBooking };
}

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus,
  expectedStatus: BookingStatus
): Promise<{ success: boolean; error?: string }> {
  if (!bookingIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" };
  if (!bookingStatusSchema.safeParse(status).success || !bookingStatusSchema.safeParse(expectedStatus).success) {
    return { success: false, error: "Invalid booking status" };
  }
  // Graph check before any backend access; the date rule needs the stored date (below).
  if (!canTransitionBooking(expectedStatus, status)) {
    return { success: false, error: TRANSITION_BLOCK_MESSAGES.not_allowed };
  }
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const workspaceId = await getCurrentWorkspaceId();
  const today = configuredCalendarDay();

  // Compare-and-set: the write matches only while the stored status is still the one
  // the user saw. "completed" additionally requires the stored date to be today or earlier.
  let write = supabase
    .from("bookings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("workspace_id", workspaceId)
    .eq("status", expectedStatus);
  if (status === "completed") write = write.lte("date", today);
  const { data: changedBooking, error } = await write.select("id").maybeSingle();

  if (error) {
    console.error("Error updating booking status:", error);
    return {
      success: false,
      error: lifecycleErrorMessage(error) ?? "Unable to update the booking status. Please try again.",
    };
  }

  if (!changedBooking) {
    // Zero rows: tell a stale status apart from a missing or out-of-workspace booking.
    const { data: current, error: readError } = await supabase
      .from("bookings")
      .select("id, status, date")
      .eq("id", bookingId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (readError) {
      console.error("Error reading booking after a status conflict:", readError);
      return { success: false, error: "Unable to update the booking status. Please try again." };
    }
    if (!current) return { success: false, error: BOOKING_NOT_FOUND };
    if (current.status !== expectedStatus) return { success: false, error: BOOKING_CHANGED_ELSEWHERE };
    const block = bookingTransitionBlock(expectedStatus, status, current.date, today);
    return { success: false, error: block ? TRANSITION_BLOCK_MESSAGES[block] : BOOKING_CHANGED_ELSEWHERE };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/artists");
  revalidatePath(`/dashboard/bookings/${bookingId}`);

  return { success: true };
}

export async function deleteBooking(
  bookingId: string
): Promise<{ success: boolean; error?: string }> {
  if (!bookingIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" };
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const workspaceId = await getCurrentWorkspaceId();

  const { data: changedBooking, error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Error deleting booking:", error);
    return { success: false, error: "Unable to delete booking. Please try again." };
  }
  if (!changedBooking) return { success: false, error: BOOKING_NOT_FOUND };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/artists");

  return { success: true };
}

export async function getBooking(
  bookingId: string
): Promise<BookingWithArtist | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const workspaceId = await getCurrentWorkspaceId();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, location, fee, currency, profile_image_url)
    `
    )
    .eq("id", bookingId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !booking) {
    console.error("Error fetching booking:", error);
    return null;
  }

  return booking as BookingWithArtist;
}

export async function updateBooking(
  bookingId: string,
  patch: {
    fee_amount_minor?: number | null;
    fee_currency?: string | null;
    date?: string;
    start_time?: string;
    duration_minutes?: number | null;
    notes?: string | null;
    hold_expires_on?: string | null;
    promoter_id?: string | null;
    venue_name?: string | null;
    venue_address?: string | null;
    event_type?: string;
    expected_audience?: string;
    driver_name?: string;
    driver_phone?: string;
    driver_distance?: string;
    contact_name_main?: string | null;
    contact_phone_main?: string | null;
    contact_email_main?: string | null;
    contact_name_secondary?: string;
    contact_phone_secondary?: string;
    contact_email_secondary?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!bookingIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" };
  const validation = updateBookingSchema.safeParse(patch);
  if (!validation.success) return { success: false, error: validation.error.issues[0].message };
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const workspaceId = await getCurrentWorkspaceId();

  // Only update fields that are in the bookings table schema
  const dbPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // The schema is the write allowlist and carries normalized M2 values.
  for (const [field, value] of Object.entries(validation.data)) {
    if (value !== undefined) dbPatch[field] = value;
  }

  const { data: changedBooking, error } = await supabase
    .from("bookings")
    .update(dbPatch)
    .eq("id", bookingId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Error updating booking:", error);
    // 23514 with an expiry in the patch = bookings_hold_expires_on_check (status is not "hold").
    const holdExpiry = error.code === "23514" && validation.data.hold_expires_on != null
      ? "A hold expiry date can only be set while the booking is on hold."
      : null;
    return {
      success: false,
      error: lifecycleErrorMessage(error) ?? holdExpiry
        ?? (isBookingPromoterViolation(error) ? BOOKING_EVENT_COPY.promoterGone : null)
        ?? "Unable to save booking. Please try again.",
    };
  }
  if (!changedBooking) return { success: false, error: BOOKING_NOT_FOUND };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/artists");
  revalidatePath(`/dashboard/bookings/${bookingId}`);

  return { success: true };
}
