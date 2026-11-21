"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export async function updateProfile(fullName: string) {
  // Same bounds as the workspace name: 1–200 characters, no control characters.
  if (typeof fullName !== "string" || !fullName.trim() || [...fullName.trim()].length > 200 || /[\u0000-\u001f\u007f]/.test(fullName)) {
    throw new Error("Full name must be 1–200 characters without control characters.")
  }
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Not authenticated")
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim() })
    .eq("id", user.id)
    .select("id")

  if (error) {
    throw new Error(error.message)
  }
  // No provider error is not proof of a write: require the actor's own row back.
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== user.id) {
    throw new Error("Unable to save your name. Please try again.")
  }

  return { success: true }
}

export async function createWorkspace(name: string) {
  if (typeof name !== "string" || !name.trim() || [...name.trim()].length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Workspace name must be 1–200 characters without control characters.")
  }
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    throw new Error("Not authenticated")
  }

  try {
    const { data: workspaceId, error } = await supabase.rpc("backbeat_bootstrap_workspace", {
      workspace_name: name.trim(),
    })
    if (error || typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
      throw new Error("Unable to create workspace. Please try again.")
    }

    return { success: true, workspaceId }
  } catch {
    throw new Error("Unable to create workspace. Please try again.")
  }
}

export async function getCurrentUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return null
  }

  // Get profile
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  // Get onboarding status
  const { data: onboardingStatus } = await supabase
    .from("onboarding_status")
    .select("*, workspaces(*)")
    .eq("user_id", user.id)
    .single()

  return {
    user,
    profile,
    onboardingStatus,
    workspace: onboardingStatus?.workspaces ?? null,
  }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/auth/login")
}

export async function getCurrentWorkspaceId(): Promise<string> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Not authenticated")
  }

  const { data: onboardingStatus, error } = await supabase
    .from("onboarding_status")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single()

  if (error || !onboardingStatus?.workspace_id) {
    redirect("/onboarding")
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", onboardingStatus.workspace_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .single()

  if (membershipError || !membership) {
    throw new Error("No active workspace membership")
  }

  return onboardingStatus.workspace_id
}
