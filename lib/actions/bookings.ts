"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface Booking {
  id: string;
  workspace_id: string;
  artist_id: string;
  date: string;
  start_time: string;
  duration_minutes: number | null;
  notes: string | null;
  status: "in_progress" | "confirmed" | "cancelled" | "completed";
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

export async function getBookings(): Promise<Booking[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Get user's workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) return [];

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, location, fee, currency, profile_image_url)
    `
    )
    .eq("workspace_id", membership.workspace_id)
    .order("date", { ascending: true });

  if (error) {
    console.error("Error fetching bookings:", error);
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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Get user's workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { success: false, error: "No workspace found" };
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      workspace_id: membership.workspace_id,
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
  revalidatePath("/dashboard/artists");

  return { success: true, booking };
}

export async function updateBookingStatus(
  bookingId: string,
  status: "pending" | "confirmed" | "cancelled"
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", bookingId);

  if (error) {
    console.error("Error updating booking:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/artists");

  return { success: true };
}

export async function deleteBooking(
  bookingId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId);

  if (error) {
    console.error("Error deleting booking:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
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

  // Get user's workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) return null;

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, location, fee, currency, profile_image_url)
    `
    )
    .eq("id", bookingId)
    .eq("workspace_id", membership.workspace_id)
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
    status?: "in_progress" | "confirmed" | "cancelled" | "completed";
    venue_name?: string;
    venue_address?: string;
    event_type?: string;
    expected_audience?: string;
    driver_name?: string;
    driver_phone?: string;
    driver_distance?: string;
    contact_name_main?: string;
    contact_phone_main?: string;
    contact_email_main?: string;
    contact_name_secondary?: string;
    contact_phone_secondary?: string;
    contact_email_secondary?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Get user's workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { success: false, error: "No workspace found" };
  }

  // Only update fields that are in the bookings table schema
  const dbPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.date !== undefined) dbPatch.date = patch.date;
  if (patch.start_time !== undefined) dbPatch.start_time = patch.start_time;
  if (patch.duration_minutes !== undefined)
    dbPatch.duration_minutes = patch.duration_minutes;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.status !== undefined) dbPatch.status = patch.status;

  const { error } = await supabase
    .from("bookings")
    .update(dbPatch)
    .eq("id", bookingId)
    .eq("workspace_id", membership.workspace_id);

  if (error) {
    console.error("Error updating booking:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/artists");
  revalidatePath(`/dashboard/bookings/${bookingId}`);

  return { success: true };
}
