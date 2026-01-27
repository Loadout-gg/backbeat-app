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
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
  updated_at: string;
  artist?: {
    id: string;
    stage_name: string;
    real_name: string | null;
    profile_image_url: string | null;
    base_rate: number | null;
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
      artist:artists(id, stage_name, real_name, profile_image_url, base_rate)
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
      status: "pending",
    })
    .select(
      `
      *,
      artist:artists(id, stage_name, real_name, profile_image_url, base_rate)
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
