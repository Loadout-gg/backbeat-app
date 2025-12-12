import Link from "next/link"
import { StatsCard } from "@/components/dashboard/stats-card"
import { EventCard } from "@/components/dashboard/event-card"
import { BookingCard } from "@/components/dashboard/booking-card"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { ArrowRight } from "lucide-react"
import { getDashboardStats } from "@/lib/actions/dashboard"
import { listEventsInProgress } from "@/lib/actions/events"

export default async function DashboardPage() {
  const [stats, eventsInProgress] = await Promise.all([getDashboardStats(), listEventsInProgress()])

  const bookingsInProgress = [
    {
      id: "1",
      month: "DEC",
      day: "7",
      artistName: "Aero Lindholm",
      venue: "Liquid Canvas",
      location: "Valencia",
      time: "1:00 AM - 3:00 AM",
    },
    {
      id: "2",
      month: "JAN",
      day: "14",
      artistName: "Kiro Solenne",
      venue: "Luminous Hall",
      location: "Los Angeles",
      time: "9:00 PM - 10:30 PM",
    },
    {
      id: "3",
      month: "JAN",
      day: "21",
      artistName: "Nara Flux",
      venue: "Neon Drift",
      location: "Vienna",
      time: "10:00 PM - 11:00 PM",
    },
    {
      id: "4",
      month: "FEB",
      day: "9",
      artistName: "Vesper Kline",
      venue: "Frequency Loft",
      location: "Turin",
      time: "1:00 AM - 2:30 AM",
    },
  ]

  return (
    <div className="flex gap-6 p-6">
      {/* Main content area */}
      <div className="flex-1 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Performance in progress" value={1} />
          <StatsCard label="Event in progress" value={eventsInProgress.length} />
          <StatsCard label="Bookings in progress" value={stats.totalBookingsInProgress} />
          <StatsCard label="Artists total" value={stats.totalArtists} />
        </div>

        {/* Events in progress */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Event in progress</h2>
            <Link
              href="/dashboard/events"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {eventsInProgress.length === 0 ? (
            <div className="rounded-lg border bg-card p-12 text-center">
              <p className="text-muted-foreground">No events in progress. Create your first event to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {eventsInProgress.map((event) => {
                const date = new Date(event.date)
                return (
                  <EventCard
                    key={event.id}
                    month={date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                    day={String(date.getDate())}
                    artistName={event.artists?.name || event.title}
                    location={event.location || "TBD"}
                    venue={event.promoters?.company_name || event.promoters?.name || ""}
                    time={date.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  />
                )
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Booking in progress</h2>
            <Link
              href="/dashboard/bookings"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {bookingsInProgress.map((booking) => (
              <BookingCard key={booking.id} {...booking} />
            ))}
          </div>
        </section>
      </div>

      {/* Quick actions sidebar */}
      <div className="w-80 shrink-0">
        <QuickActions />
      </div>
    </div>
  )
}
