"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { readCompleteCollection } from "@/lib/read-complete-collection"
import { promoterSchema, type PromoterInput } from "@/lib/promoter-validation"
import { getCurrentWorkspaceId } from "./workspace"

export type PromoterListItem = {
  id: string
  name: string
  company_name: string | null
  email: string | null
  phone: string | null
}

export type PromoterDetail = PromoterListItem & { notes: string | null }

export type PromoterWriteResult =
  | { success: true; promoter: { id: string; name: string; company_name: string | null } }
  | { success: false; error: string }

const SAVE_FAILED = "Unable to save the promoter. Please try again."
const NOT_FOUND = "Promoter not found."

function revalidatePromoterSurfaces() {
  revalidatePath("/dashboard/promoters")
  revalidatePath("/dashboard/events/new")
  revalidatePath("/dashboard/events")
}

// Directory rows carry contact details for the workspace's own operators; notes stay on the detail read.
export async function listPromoterDirectory(): Promise<PromoterListItem[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const rows = await readCompleteCollection<PromoterListItem>(async (from, to) => {
    const { data, error, count } = await supabase
      .from("promoters")
      .select("id,name,company_name,email,phone", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
    return { data: data as PromoterListItem[] | null, error, count }
  }, "Promoter directory")
  return rows.map((row) => ({
    id: row.id, name: row.name, company_name: row.company_name, email: row.email, phone: row.phone,
  }))
}

/** Null means "no such promoter in this workspace"; a failed read throws. */
export async function getPromoter(id: string): Promise<PromoterDetail | null> {
  if (!z.guid().safeParse(id).success) return null
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("promoters")
    .select("id,name,company_name,email,phone,notes")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("Unable to load the promoter.")
  if (!data) return null
  const row = data as PromoterDetail
  return {
    id: row.id, name: row.name, company_name: row.company_name, email: row.email, phone: row.phone, notes: row.notes,
  }
}

export async function createPromoter(input: PromoterInput): Promise<PromoterWriteResult> {
  const validation = promoterSchema.safeParse(input)
  if (!validation.success) return { success: false, error: validation.error.issues[0].message }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("promoters")
    .insert({ ...validation.data, workspace_id: workspaceId })
    .select("id,name,company_name")
    .single()

  // The provider message is never shown to the user.
  if (error || !data || !z.guid().safeParse(data.id).success) return { success: false, error: SAVE_FAILED }

  revalidatePromoterSurfaces()
  return { success: true, promoter: { id: data.id, name: data.name, company_name: data.company_name } }
}

export async function updatePromoter(id: string, input: PromoterInput): Promise<PromoterWriteResult> {
  if (!z.guid().safeParse(id).success) return { success: false, error: NOT_FOUND }
  const validation = promoterSchema.safeParse(input)
  if (!validation.success) return { success: false, error: validation.error.issues[0].message }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("promoters")
    .update(validation.data)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id,name,company_name")

  if (error) return { success: false, error: SAVE_FAILED }
  // No provider error is not proof of a write: require exactly the targeted row back.
  if (!Array.isArray(data) || data.length !== 1 || data[0].id !== id) return { success: false, error: NOT_FOUND }

  revalidatePromoterSurfaces()
  return { success: true, promoter: { id: data[0].id, name: data[0].name, company_name: data[0].company_name } }
}

export type PromoterDeleteResult = { success: true } | { success: false; error: string }

const DELETE_FAILED = "Unable to delete the promoter. Please try again."

/** Events linked to the promoter are kept; the database clears their promoter reference (ON DELETE SET NULL). */
export async function deletePromoter(id: string): Promise<PromoterDeleteResult> {
  if (!z.guid().safeParse(id).success) return { success: false, error: NOT_FOUND }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("promoters")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id")

  if (error) return { success: false, error: DELETE_FAILED }
  // No provider error is not proof of a delete: require exactly the targeted row back.
  if (!Array.isArray(data) || data.length !== 1 || data[0].id !== id) return { success: false, error: NOT_FOUND }

  revalidatePromoterSurfaces()
  revalidatePath("/dashboard")
  return { success: true }
}
