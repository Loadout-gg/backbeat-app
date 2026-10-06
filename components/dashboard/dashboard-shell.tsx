"use client"

import { useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { Header } from "@/components/dashboard/header"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface DashboardShellProps {
  children: ReactNode
  userName: string
  avatarUrl?: string | null
}

export function DashboardShell({ children, userName, avatarUrl }: DashboardShellProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const sections: Record<string, { title: string; detail: string }> = {
    artists: { title: "Artists", detail: "Artist details" },
    bookings: { title: "Bookings", detail: "Booking details" },
    events: { title: "Events", detail: "Event details" },
    settings: { title: "Settings", detail: "Settings" },
  }
  const [, , section, record] = pathname.split("/")
  const context = sections[section]
  const title = section === "artists" && record === "new" ? "Add artist"
    : section === "artists" && pathname.endsWith("/edit") ? "Edit artist"
    : section === "events" && record === "new" ? "New event"
    : context ? (record ? context.detail : context.title) : "Dashboard"

  return (
    <div className="flex min-h-dvh flex-col bg-background px-4 pb-4 font-sans text-foreground sm:px-6 sm:pb-6">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-background p-3 shadow-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <div className="grid min-w-0 flex-1 gap-x-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="hidden lg:block"><Sidebar /></div>
        <div className="flex min-w-0 flex-col">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <Header title={title} userName={userName} avatarUrl={avatarUrl} navigation={
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open navigation" className="size-11 shrink-0 lg:hidden"><Menu aria-hidden="true" className="size-5" /></Button>
              </DialogTrigger>
            } />
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:max-w-sm">
              <div className="flex items-center justify-between gap-3">
                <DialogTitle>Navigation</DialogTitle>
                <DialogClose asChild><Button variant="ghost" size="icon" aria-label="Close navigation" className="size-11"><X aria-hidden="true" className="size-5" /></Button></DialogClose>
              </div>
              <Sidebar onNavigate={() => setMenuOpen(false)} />
            </DialogContent>
          </Dialog>
          <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col pt-2 focus:outline-none">{children}</main>
        </div>
      </div>
    </div>
  )
}
