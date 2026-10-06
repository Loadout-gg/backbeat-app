import { getBookings, type Booking } from "@/lib/actions/bookings"
import { BookingCard } from "@/components/dashboard/booking-card"
import { Badge } from "@/components/ui/badge"

export default async function BookingsPage() {
  let bookings: Booking[] = []
  let loadError = false
  try {
    bookings = await getBookings({ failOnError: true })
  } catch {
    loadError = true
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">All bookings in your workspace.</p>
      </div>
      <div className="space-y-3">
        {loadError && <p role="alert" className="text-sm text-destructive">Unable to load bookings. Please refresh and try again.</p>}
        {!loadError && bookings.length === 0 && (
          <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">No bookings in your workspace yet.</p>
        )}
        {bookings.map((booking) => {
          const date = new Date(`${booking.date}T00:00:00`)
          return (
            <div key={booking.id} className="space-y-1">
              <Badge variant="outline" className="capitalize">{booking.status.replaceAll("_", " ")}</Badge>
              <BookingCard
                id={booking.id}
                month={date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                day={String(date.getDate())}
                artistName={booking.artist?.stage_name || booking.artist?.name || "Unknown Artist"}
                venue=""
                location=""
                time={booking.start_time.slice(0, 5)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
