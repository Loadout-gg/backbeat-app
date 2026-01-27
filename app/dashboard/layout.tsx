import type React from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
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
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header title="Dashboard" userName={profile?.full_name || "User"} avatarUrl={profile?.avatar_url} />
        <main className="flex-1 overflow-auto bg-muted/30 px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
