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
    <div className="flex items-center justify-between rounded-lg border bg-background p-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-0.5 bg-primary" />
          <div className="flex flex-col items-center justify-center text-center">
            <span className="text-xs font-medium uppercase text-muted-foreground">{month}</span>
            <span className="text-lg font-semibold">{day}</span>
          </div>
        </div>
        <div className="flex flex-col">
          <span className="font-medium">{artistName}</span>
          <span className="text-sm text-muted-foreground">
            {location}, {venue} • {time}
          </span>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onContinueSetup}>
        Continue setup
      </Button>
    </div>
  )
}
