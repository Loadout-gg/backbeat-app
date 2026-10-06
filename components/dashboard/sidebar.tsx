"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BackbeatLogoFull } from "@/components/backbeat-logo"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Users, Settings } from "lucide-react"

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Artists", href: "/dashboard/artists", icon: Users },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center px-4">
        <BackbeatLogoFull />
      </div>
      <nav aria-label="Main navigation" className="flex-1 rounded-xl bg-muted p-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
          return (
            <div key={item.href} className={item.label === "Settings" ? "mt-4 border-t pt-4" : "mb-1"}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive ? "bg-background font-medium text-foreground shadow-sm" : "text-foreground hover:bg-background/70",
                )}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                {item.label}
              </Link>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
