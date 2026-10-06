import type React from "react"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { getCurrentUser } from "@/lib/actions/workspace"
import { redirect } from "next/navigation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userData = await getCurrentUser()

  if (!userData) {
    redirect("/auth/login")
  }

  const { profile } = userData

  return (
    <DashboardShell userName={profile?.full_name || "User"} avatarUrl={profile?.avatar_url}>
      {children}
    </DashboardShell>
  )
}
