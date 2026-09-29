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
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-card p-3 shadow-xs">
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
  )
}
