"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export async function updateProfile(fullName: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Not authenticated")
  }

  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id)

  if (error) {
    throw new Error(error.message)
  }

  return { success: true }
}

export async function createWorkspace(name: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Not authenticated")
  }

  const { data: insertResult, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({
      name,
    })
    .select("id")

  if (workspaceError || !insertResult || insertResult.length === 0) {
    throw new Error(workspaceError?.message || "Failed to create workspace")
  }

  const workspaceId = insertResult[0].id

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "admin",
    status: "active",
  })

  if (memberError) {
    throw new Error(memberError.message)
  }

  // Mark onboarding as complete
  const { error: onboardingError } = await supabase
    .from("onboarding_status")
    .update({
      completed: true,
      workspace_id: workspaceId,
    })
    .eq("user_id", user.id)

  if (onboardingError) {
    throw new Error(onboardingError.message)
  }

  return { success: true, workspaceId }
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
