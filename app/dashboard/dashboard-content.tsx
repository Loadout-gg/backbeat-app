"use client"

import { useState } from "react"
import Link from "next/link"
import { StatsCard } from "@/components/dashboard/stats-card"
import { EventCard } from "@/components/dashboard/event-card"
import { BookingCard } from "@/components/dashboard/booking-card"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { NewBookingModal } from "@/components/dashboard/new-booking-modal"
import { type BookingDashboardItem } from "@/lib/actions/bookings"
import { bookingArtistName, compareBookingSchedule, formatBookingTimeRange } from "@/lib/booking-display"

/** The events panel is a short preview, not the full schedule. */
export const DASHBOARD_EVENTS_LIMIT = 6

interface DashboardStats {
  eventsInProgress: number
  bookingsInProgress: number
  totalArtists: number
  totalPromoters: number
}

interface Event {
  id: string
  date: string
  title: string
  location: string | null
  artists?: { name: string; stage_name?: string | null } | null
  promoters?: { name: string; company_name: string | null } | null
}

interface DashboardContentProps {
  welcomeMessage: string
  stats: DashboardStats
  eventsInProgress: Event[]
  bookings: BookingDashboardItem[]
  calendarToday: string
}

export function DashboardContent({
  welcomeMessage,
  stats,
  eventsInProgress,
  bookings,
  calendarToday,
}: DashboardContentProps) {
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false)

  // Bookings in progress, soonest first; same-day bookings in start-time order.
  const bookingsInProgress = bookings
    .filter((b) => b.status === "in_progress")
    .sort(compareBookingSchedule)
  const shownEvents = eventsInProgress.slice(0, DASHBOARD_EVENTS_LIMIT)
  const hasArtists = stats.totalArtists > 0

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-w-0 flex-1">
        {/* Welcome message */}
        <h1 className="mb-5 break-words text-2xl font-semibold tracking-tight">{welcomeMessage}</h1>

        {/* Stats row */}
        <div role="region" aria-label="Workspace overview" className="grid grid-cols-1 gap-2 rounded-xl bg-muted/60 p-2 mb-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard label="Events in progress" value={stats.eventsInProgress} />
          <StatsCard
            label="Bookings in progress"
            value={bookingsInProgress.length}
          />
          <StatsCard label="Artists total" value={stats.totalArtists} />
          <StatsCard label="Promoters" value={stats.totalPromoters} href="/dashboard/promoters" />
        </div>

        {/* Main content grid */}
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
          {/* Right column - Quick Actions */}
          <div className="row-start-1 min-w-0 xl:col-start-2 xl:row-start-1">
            <QuickActions onNewBooking={() => setIsBookingModalOpen(true)} hasArtists={hasArtists} />
          </div>
          {/* Left column - Events and Bookings */}
          <div className="min-w-0 space-y-7">
            {/* Events in progress panel */}
            <section aria-labelledby="dashboard-events" className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id="dashboard-events" className="text-base font-semibold">Events in progress</h2>
                <Link
                  href="/dashboard/events"
                  className="inline-flex min-h-10 items-center rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                >
                  View all events
                </Link>
              </div>
              <p id="dashboard-events-scope" className="mb-3 text-sm text-muted-foreground">
                {eventsInProgress.length > DASHBOARD_EVENTS_LIMIT
                  ? `Showing the next ${DASHBOARD_EVENTS_LIMIT} of ${eventsInProgress.length} events in progress. `
                  : `Shows at most ${DASHBOARD_EVENTS_LIMIT} events in progress, soonest first. `}
                Confirmed events and other commitments are not listed here.
              </p>
              {eventsInProgress.length === 0 ? (
                <p className="rounded-xl bg-muted/60 px-4 py-6 text-sm text-muted-foreground">
                  No events in progress at the moment
                </p>
              ) : (
                <ul aria-describedby="dashboard-events-scope" className="space-y-2 rounded-xl bg-muted/60 p-2">
                  {shownEvents.map((event) => {
                    const hasTime = /[T ]\d{2}:\d{2}/.test(event.date)
                    const date = new Date(hasTime ? event.date : `${event.date}T00:00:00`)
                    return (
                      <li key={event.id}>
                        <EventCard
                          month={date
                            .toLocaleDateString("en-US", { month: "short" })
                            .toUpperCase()}
                          day={String(date.getDate())}
                          artistName={event.artists?.stage_name || event.artists?.name || event.title}
                          location={event.location || "TBD"}
                          venue={
                            event.promoters?.company_name ||
                            event.promoters?.name ||
                            ""
                          }
                          time={hasTime ? date.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          }) : undefined}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* Bookings in progress panel */}
            <section aria-labelledby="dashboard-bookings" className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id="dashboard-bookings" className="text-base font-semibold">Bookings in progress</h2>
                <Link
                  href="/dashboard/bookings"
                  className="inline-flex min-h-10 items-center rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                >
                  View all bookings
                </Link>
              </div>
              {bookingsInProgress.length === 0 ? (
                <div className="space-y-3 rounded-xl bg-muted/60 px-4 py-6">
                  <p className="text-sm text-muted-foreground">
                    No bookings in progress at the moment
                  </p>
                  {hasArtists ? (
                    <>
                      <p className="text-sm text-muted-foreground">Create a booking to choose an artist and add a date.</p>
                      <Button
                        className="gap-2"
                        onClick={() => setIsBookingModalOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                        New booking
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">A booking starts from an artist. Add your first artist, then create a booking from their profile.</p>
                      <Button className="gap-2" asChild>
                        <Link href="/dashboard/artists/new">
                          <Plus className="h-4 w-4" />
                          Add first artist
                        </Link>
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <ul className="space-y-2 rounded-xl bg-muted/60 p-2">
                  {bookingsInProgress.map((booking) => {
                    const date = new Date(`${booking.date}T00:00:00`)
                    return (
                      <li key={booking.id}>
                        <BookingCard
                          id={booking.id}
                          month={date
                            .toLocaleDateString("en-US", { month: "short" })
                            .toUpperCase()}
                          day={String(date.getDate())}
                          artistName={bookingArtistName(booking.artist)}
                          venue={booking.venue_name || ""}
                          location={booking.venue_address || ""}
                          time={formatBookingTimeRange(booking.start_time, booking.duration_minutes)}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>


        </div>
      </div>

      {/* New Booking Modal */}
      <NewBookingModal
        open={isBookingModalOpen}
        onOpenChange={setIsBookingModalOpen}
        existingBookings={bookings}
        calendarToday={calendarToday}
      />

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-4 text-xs text-muted-foreground">
        {/* Year of the configured calendar day (server zone policy), not the viewer clock. */}
        <span>© {calendarToday.slice(0, 4)} Backbeat. All rights reserved.</span>
        <span>Terms, Privacy, Help and Contact are currently unavailable.</span>
      </footer>
    </div>
  )
}
