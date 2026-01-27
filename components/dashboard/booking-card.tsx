"use client"

import { Button } from "@/components/ui/button"

interface BookingCardProps {
  month: string
  day: string
  artistName: string
  venue: string
  location: string
  time: string
  onContinueSetup?: () => void
}

export function BookingCard({ month, day, artistName, venue, location, time, onContinueSetup }: BookingCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-3">
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center justify-center rounded border bg-muted/50 px-3 py-1.5 min-w-[52px]">
          <span className="text-[10px] font-medium uppercase text-muted-foreground">{month}</span>
          <span className="text-lg font-semibold leading-tight">{day}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm">{artistName}</h3>
          <p className="text-xs text-muted-foreground">
            {location}, {venue} • {time}
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onContinueSetup}>
        Continue setup
      </Button>
    </div>
  )
}
