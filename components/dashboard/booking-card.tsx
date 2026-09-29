"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

interface BookingCardProps {
  id: string
  month: string
  day: string
  artistName: string
  venue: string
  location: string
  time: string
}

export function BookingCard({ id, month, day, artistName, venue, location, time }: BookingCardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center justify-center border-r border-border py-1 pr-3 tabular-nums">
          <span className="text-xs font-medium uppercase text-muted-foreground">{month}</span>
          <span className="text-lg font-medium leading-tight">{day}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="break-words text-sm font-medium leading-5">{artistName}</h3>
          <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">
            {[[location, venue].filter(Boolean).join(", "), time].filter(Boolean).join(" • ")}
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="min-h-10 self-start sm:self-auto" asChild>
        <Link href={`/dashboard/bookings/${id}`}>
          Continue setup
        </Link>
      </Button>
    </div>
  )
}
