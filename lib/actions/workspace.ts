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

  const { error: workspaceError } = await supabase.from("workspaces").insert({
    name,
    created_by: user.id,
  })

  if (workspaceError) {
    throw new Error(workspaceError.message)
  }

  const { data: workspace, error: fetchError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("created_by", user.id)
    .eq("name", name)
    .single()

  if (fetchError || !workspace) {
    throw new Error(fetchError?.message || "Failed to retrieve created workspace")
  }

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
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
      workspace_id: workspace.id,
    })
    .eq("user_id", user.id)

  if (onboardingError) {
    throw new Error(onboardingError.message)
  }

  redirect("/dashboard")
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
