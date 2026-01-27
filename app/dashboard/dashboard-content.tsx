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
import { type Booking } from "@/lib/actions/bookings"

interface DashboardStats {
  eventsInProgress: number
  bookingsInProgress: number
  totalArtists: number
}

interface Event {
  id: string
  date: string
  title: string
  location: string | null
  artists?: { name: string } | null
  promoters?: { name: string; company_name: string | null } | null
}

interface DashboardContentProps {
  welcomeMessage: string
  stats: DashboardStats
  eventsInProgress: Event[]
  bookings: Booking[]
}

export function DashboardContent({
  welcomeMessage,
  stats,
  eventsInProgress,
  bookings,
}: DashboardContentProps) {
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false)

  // Filter bookings in progress
  const bookingsInProgress = bookings.filter((b) => b.status === "in_progress")

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1">
        {/* Welcome message */}
        <h2 className="text-2xl font-semibold mb-6">{welcomeMessage}</h2>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatsCard
            label="Performance in progress"
            value={stats.eventsInProgress}
          />
          <StatsCard label="Event in progress" value={stats.eventsInProgress} />
          <StatsCard
            label="Bookings in progress"
            value={bookingsInProgress.length}
          />
          <StatsCard label="Artists total" value={stats.totalArtists} />
        </div>

        {/* Main content grid */}
        <div className="flex gap-6">
          {/* Left column - Events and Bookings */}
          <div className="flex-1 space-y-6">
            {/* Events in progress panel */}
            <section className="rounded-lg border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">Events in progress</h2>
                <Link
                  href="/dashboard/events"
                  className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  View all
                </Link>
              </div>
              {eventsInProgress.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No events in progress at the moment
                </p>
              ) : (
                <div className="space-y-2">
                  {eventsInProgress.slice(0, 6).map((event) => {
                    const date = new Date(event.date)
                    return (
                      <EventCard
                        key={event.id}
                        month={date
                          .toLocaleDateString("en-US", { month: "short" })
                          .toUpperCase()}
                        day={String(date.getDate())}
                        artistName={event.artists?.name || event.title}
                        location={event.location || "TBD"}
                        venue={
                          event.promoters?.company_name ||
                          event.promoters?.name ||
                          ""
                        }
                        time={`${date.toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })} - ${new Date(
                          date.getTime() + 2 * 60 * 60 * 1000
                        ).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })}`}
                      />
                    )
                  })}
                </div>
              )}
            </section>

            {/* Bookings in progress panel */}
            <section className="rounded-lg border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">Bookings in progress</h2>
                <Link
                  href="/dashboard/bookings"
                  className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  View all
                </Link>
              </div>
              {bookingsInProgress.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    No bookings in progress at the moment
                  </p>
                  <Button
                    className="gap-2"
                    onClick={() => setIsBookingModalOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    New Booking
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookingsInProgress.map((booking) => {
                    const date = new Date(booking.date)
                    return (
                      <BookingCard
                        key={booking.id}
                        id={booking.id}
                        month={date
                          .toLocaleDateString("en-US", { month: "short" })
                          .toUpperCase()}
                        day={String(date.getDate())}
                        artistName={
                          booking.artist?.stage_name || "Unknown Artist"
                        }
                        venue=""
                        location=""
                        time={booking.start_time}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Right column - Quick Actions */}
          <div className="w-72 shrink-0">
            <QuickActions />
          </div>
        </div>
      </div>

      {/* New Booking Modal */}
      <NewBookingModal
        open={isBookingModalOpen}
        onOpenChange={setIsBookingModalOpen}
      />

      {/* Footer */}
      <footer className="mt-8 pt-6 border-t">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M9 18V12.6C9 12.0399 9 11.7599 9.109 11.546C9.20487 11.3578 9.35785 11.2049 9.54601 11.109C9.75992 11 10.0399 11 10.6 11H13.4C13.9601 11 14.2401 11 14.454 11.109C14.6422 11.2049 14.7951 11.3578 14.891 11.546C15 11.7599 15 12.0399 15 12.6V18M11.0177 3.76407L4.23539 8.03912C3.78202 8.32524 3.55534 8.4683 3.39203 8.65866C3.24737 8.8277 3.1396 9.0238 3.07403 9.2344C3 9.47131 3 9.73256 3 10.2551V16.8C3 17.9201 3 18.4802 3.21799 18.908C3.40973 19.2843 3.71569 19.5903 4.09202 19.782C4.51984 20 5.07989 20 6.2 20H17.8C18.9201 20 19.4802 20 19.908 19.782C20.2843 19.5903 20.5903 19.2843 20.782 18.908C21 18.4802 21 17.9201 21 16.8V10.2551C21 9.73256 21 9.47131 20.926 9.2344C20.8604 9.0238 20.7526 8.8277 20.608 8.65866C20.4447 8.4683 20.218 8.32524 19.7646 8.03912L12.9823 3.76407C12.631 3.54027 12.4553 3.42837 12.2659 3.38388C12.0987 3.34468 11.9013 3.34468 11.7341 3.38388C11.5447 3.42837 11.369 3.54027 11.0177 3.76407Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-medium text-foreground">Backbeat</span>
          </div>
          <div className="flex items-center gap-6">
            <Link
              href="/terms"
              className="hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/help"
              className="hover:text-foreground transition-colors"
            >
              Help
            </Link>
            <Link
              href="/contact"
              className="hover:text-foreground transition-colors"
            >
              Contact
            </Link>
          </div>
          <span>© 2025 Backbeat. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
