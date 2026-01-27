"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface Booking {
  id: string;
  workspace_id: string;
  artist_id: string;
  date: string;
  start_time: string;
  duration_minutes: number;
  notes: string | null;
  status: "in_progress" | "confirmed" | "cancelled" | "completed";
  created_at: string;
  updated_at: string;
  artist?: {
    id: string;
    stage_name: string;
    name: string | null;
    surname: string | null;
    profile_image_url: string | null;
    fee: number | null;
    currency: string | null;
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
      artist:artists(id, stage_name, name, surname, profile_image_url, fee, currency)
    `
    )
    .eq("workspace_id", membership.workspace_id)
    .order("date", { ascending: true });

  if (error) {
    console.error("Error fetching bookings:", error);
    return [];
  }

  return bookings || [];
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
      duration_minutes: formData.durationMinutes,
      notes: formData.notes || null,
      status: "in_progress",
    })
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, profile_image_url, fee, currency)
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
  status: "in_progress" | "confirmed" | "cancelled" | "completed"
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

export async function listBookingsByStatus(
  status: "in_progress" | "confirmed" | "cancelled" | "completed",
  limit?: number
): Promise<Booking[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) return [];

  let query = supabase
    .from("bookings")
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, profile_image_url, fee, currency)
    `
    )
    .eq("workspace_id", membership.workspace_id)
    .eq("status", status)
    .order("date", { ascending: true });

  if (limit) {
    query = query.limit(limit);
  }

  const { data: bookings, error } = await query;

  if (error) {
    console.error("Error fetching bookings by status:", error);
    return [];
  }

  return bookings || [];
}

export async function listBookingsForArtist(
  artistId: string,
  range?: { start: string; end: string }
): Promise<Booking[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) return [];

  let query = supabase
    .from("bookings")
    .select(
      `
      *,
      artist:artists(id, stage_name, name, surname, profile_image_url, fee, currency)
    `
    )
    .eq("workspace_id", membership.workspace_id)
    .eq("artist_id", artistId)
    .order("date", { ascending: true });

  if (range) {
    query = query.gte("date", range.start).lte("date", range.end);
  }

  const { data: bookings, error } = await query;

  if (error) {
    console.error("Error fetching bookings for artist:", error);
    return [];
  }

  return bookings || [];
}
