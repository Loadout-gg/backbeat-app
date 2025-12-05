interface EventCardProps {
  month: string
  day: string
  artistName: string
  venue: string
  location: string
  time: string
}

export function EventCard({ month, day, artistName, venue, location, time }: EventCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-background p-4">
      <div className="flex flex-col items-center justify-center text-center">
        <span className="text-xs font-medium uppercase text-muted-foreground">{month}</span>
        <span className="text-lg font-semibold">{day}</span>
      </div>
      <div className="flex flex-col">
        <span className="font-medium">{artistName}</span>
        <span className="text-sm text-muted-foreground">
          {location}, {venue} • {time}
        </span>
      </div>
    </div>
  )
}
