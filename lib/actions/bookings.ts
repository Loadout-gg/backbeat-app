"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "./workspace";
import type { BookingStatus } from "@/lib/booking-status";
import { createBookingSchema, updateBookingSchema, bookingStatusSchema, bookingIdSchema } from "@/lib/booking-validation";

export interface Booking {
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
  created_at: string;
  updated_at: string;
  artist?: {
    id: string;
    stage_name: string;
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
    stage_name: string;
    name: string | null;
    surname: string | null;
    location: string | null;
    fee: number | null;
    currency: string | null;
    profile_image_url: string | null;
  };
}

export async function getBookings(options: { artistId?: string; failOnError?: boolean } = {}): Promise<Booking[]> {
  if (options.artistId !== undefined && !createBookingSchema.shape.artistId.safeParse(options.artistId).success) {
    throw new Error("Invalid artist ID");
  }
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    if (options.failOnError) throw new Error("Not authenticated");
    return [];
  }

  const workspaceId = await getCurrentWorkspaceId();

  let query = supabase
    .from("bookings")
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, location, fee, currency, profile_image_url)
    `
    )
    .eq("workspace_id", workspaceId);

  if (options.artistId !== undefined) query = query.eq("artist_id", options.artistId);
  const { data: bookings, error } = await query.order("date", { ascending: true });

  if (error) {
    console.error("Error fetching bookings:", error);
    if (options.failOnError) throw new Error("Unable to load bookings. Please try again.");
    return [];
  }

  return (bookings || []) as Booking[];
}

export async function createBooking(formData: {
  artistId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  notes?: string;
}): Promise<{ success: boolean; error?: string; booking?: Booking }> {
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
    })
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, location, fee, currency, profile_image_url)
    `
    )
    .single();

  if (error) {
    console.error("Error creating booking:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/artists");

  return { success: true, booking };
}

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus
): Promise<{ success: boolean; error?: string }> {
  if (!bookingIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" };
  const validation = bookingStatusSchema.safeParse(status);
  if (!validation.success) return { success: false, error: "Invalid booking status" };
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
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .single();

  if (error) {
    console.error("Error updating booking:", error);
    return { success: false, error: error.message };
  }
  if (!changedBooking) return { success: false, error: "Booking not found" };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/artists");

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
    .single();

  if (error) {
    console.error("Error deleting booking:", error);
    return { success: false, error: error.message };
  }
  if (!changedBooking) return { success: false, error: "Booking not found" };

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
    date?: string;
    start_time?: string;
    duration_minutes?: number | null;
    notes?: string | null;
    status?: BookingStatus;
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
    .single();

  if (error) {
    console.error("Error updating booking:", error);
    return { success: false, error: error.message };
  }
  if (!changedBooking) return { success: false, error: "Booking not found" };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/artists");
  revalidatePath(`/dashboard/bookings/${bookingId}`);

  return { success: true };
}
