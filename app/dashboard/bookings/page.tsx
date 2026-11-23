import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { getBookings, type Booking } from "@/lib/actions/bookings"
import { BookingCard } from "@/components/dashboard/booking-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RetryButton } from "@/components/retry-button"
import { BOOKING_STATUSES } from "@/lib/booking-status"
import {
  BOOKING_STATUS_LABELS,
  bookingArtistName,
  bookingStatusBadgeVariant,
  formatBookingTime,
  holdRank,
  holdRankLabel,
  isHoldExpired,
  parseBookingStatusFilter,
  splitBookingsByDate,
  type BookingStatusFilter,
} from "@/lib/booking-display"
import { configuredCalendarDay } from "@/lib/calendar-day"
import { eventDateParts } from "@/lib/event-date-display"

type BookingsPageProps = {
  searchParams?: Promise<{ status?: string | string[] }>
}

const FILTERS: { value: BookingStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...BOOKING_STATUSES.map((status) => ({ value: status, label: BOOKING_STATUS_LABELS[status] })),
]

function BookingRow({ booking, all, today }: { booking: Booking; all: readonly Booking[]; today: string }) {
  const { month, day } = eventDateParts(booking.date)
  // Rank is derived from the complete workspace list, not from the filtered view.
  const priority = holdRankLabel(holdRank(all, booking))
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <Badge variant={bookingStatusBadgeVariant(booking.status)}>{BOOKING_STATUS_LABELS[booking.status]}</Badge>
        {isHoldExpired(booking, today) && <Badge variant="destructive">Hold expired</Badge>}
        {priority && <Badge variant="outline">{priority}</Badge>}
      </div>
      <BookingCard
        id={booking.id}
        month={month.toUpperCase()}
        day={day}
        artistName={bookingArtistName(booking.artist)}
        venue={booking.venue_name || ""}
        location={booking.venue_address || ""}
        time={formatBookingTime(booking.start_time)}
      />
    </li>
  )
}

export default async function BookingsPage({ searchParams }: BookingsPageProps = {}) {
  const filter = parseBookingStatusFilter((await searchParams)?.status)
  let bookings: Booking[] = []
  let loadError = false
  try {
    bookings = await getBookings({ failOnError: true })
  } catch (error) {
    unstable_rethrow(error)
    loadError = true
  }

  const visible = filter === "all" ? bookings : bookings.filter((booking) => booking.status === filter)
  const today = configuredCalendarDay()
  const { upcoming, past } = splitBookingsByDate(visible, today)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">All bookings in your workspace.</p>
      </div>
      <nav aria-label="Filter bookings by status" className="flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const active = option.value === filter
          return (
            <Button key={option.value} asChild size="sm" variant={active ? "secondary" : "outline"}>
              <Link
                href={option.value === "all" ? "/dashboard/bookings" : `/dashboard/bookings?status=${option.value}`}
                aria-current={active ? "page" : undefined}
              >
                {option.label}
              </Link>
            </Button>
          )
        })}
      </nav>
      <div className="space-y-3">
        {loadError && (
          <>
            <p role="alert" className="text-sm text-destructive">Unable to load bookings. Please refresh and try again.</p>
            <RetryButton label="Retry loading bookings" />
          </>
        )}
        {!loadError && bookings.length === 0 && (
          // No artist count is read here: the way out is valid with or without artists.
          <div className="space-y-3 rounded-lg border bg-card p-5">
            <p className="text-sm text-muted-foreground">No bookings in your workspace yet.</p>
            <p className="text-sm text-muted-foreground">A booking starts from an artist. Add an artist, or open one from Artists and choose New booking.</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/dashboard/artists/new">Add artist</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/artists">View artists</Link>
              </Button>
            </div>
          </div>
        )}
        {!loadError && bookings.length > 0 && visible.length === 0 && (
          <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">No bookings with this status.</p>
        )}
        {upcoming.length > 0 && (
          <section aria-labelledby="bookings-upcoming" className="space-y-3">
            <h2 id="bookings-upcoming" className="text-base font-semibold">Upcoming</h2>
            <ul className="space-y-3">
              {upcoming.map((booking) => <BookingRow key={booking.id} booking={booking} all={bookings} today={today} />)}
            </ul>
          </section>
        )}
        {past.length > 0 && (
          <section aria-labelledby="bookings-past" className="space-y-3">
            <h2 id="bookings-past" className="text-base font-semibold">Past</h2>
            <ul className="space-y-3">
              {past.map((booking) => <BookingRow key={booking.id} booking={booking} all={bookings} today={today} />)}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
