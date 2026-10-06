"use client"

import type { ReactNode } from "react"
import { ChevronDown, LogOut } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { signOut } from "@/lib/actions/workspace"

interface HeaderProps {
  title: string
  userName?: string
  avatarUrl?: string | null
  navigation?: ReactNode
}

export function Header({ title, userName = "User", avatarUrl, navigation }: HeaderProps) {
  const displayName = userName.trim().replace(/\s+/g, " ") || "User"
  const initials = displayName.split(" ").map((name) => name[0]).join("").toUpperCase().slice(0, 2)

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <header className="flex min-h-16 min-w-0 items-center justify-between gap-3 bg-background">
      <div className="flex min-w-0 items-center gap-2">
        {navigation}
        <p className="truncate text-lg font-medium sm:text-xl">{title}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" aria-label={`Account menu for ${displayName}`} className="h-11 min-w-11 shrink-0 gap-2 px-2">
            <Avatar>
              <AvatarImage src={avatarUrl || undefined} alt="" className="object-cover" />
              <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 truncate text-sm sm:block">{displayName}</span>
            <ChevronDown aria-hidden="true" className="hidden size-4 text-muted-foreground sm:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <a href="/dashboard/settings">Settings</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
            <LogOut aria-hidden="true" className="mr-2 size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
