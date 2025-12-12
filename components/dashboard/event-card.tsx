interface EventCardProps {
  month: string
  day: string
  artistName: string
  venue: string
  location: string
  time?: string
}

export function EventCard({ month, day, artistName, venue, location, time }: EventCardProps) {
  return (
    <div className="flex items-start gap-4 rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors">
      <div className="flex flex-col items-center justify-center rounded border bg-background px-3 py-2 min-w-[56px]">
        <span className="text-xs font-medium uppercase text-muted-foreground">{month}</span>
        <span className="text-xl font-semibold leading-none mt-1">{day}</span>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-base mb-1">{artistName}</h3>
        <p className="text-sm text-muted-foreground">
          {location}
          {venue && `, ${venue}`}
          {time && ` • ${time}`}
        </p>
      </div>
    </div>
  )
}
