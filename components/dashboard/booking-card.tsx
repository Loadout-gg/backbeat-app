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
    <div className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex items-center gap-3">
          <div className="h-16 w-1 bg-primary rounded-full" />
          <div className="flex flex-col items-center justify-center rounded border bg-background px-3 py-2 min-w-[56px]">
            <span className="text-xs font-medium uppercase text-muted-foreground">{month}</span>
            <span className="text-xl font-semibold leading-none mt-1">{day}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base mb-1">{artistName}</h3>
          <p className="text-sm text-muted-foreground">
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
