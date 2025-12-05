import Link from "next/link"
import { StatsCard } from "@/components/dashboard/stats-card"
import { EventCard } from "@/components/dashboard/event-card"
import { BookingCard } from "@/components/dashboard/booking-card"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { ArrowRight } from "lucide-react"

// Mock data matching the design
const stats = [
  { label: "Performance in progress", value: 1 },
  { label: "Event in progress", value: 12 },
  { label: "Bookings in progress", value: 4 },
  { label: "Artists total", value: 43 },
]

const eventsInProgress = [
  {
    month: "NOV",
    day: "27",
    artistName: "Swami",
    location: "Berlin",
    venue: "Lumen Lounge",
    time: "11:30 PM – 1:00 AM",
  },
  {
    month: "NOV",
    day: "27",
    artistName: "Lena Voss",
    location: "Hamburg",
    venue: "Velvet Horizon",
    time: "12:00 AM – 1:30 AM",
  },
  {
    month: "NOV",
    day: "27",
    artistName: "Quliano",
    location: "Florence",
    venue: "Cielo Club",
    time: "1:30 AM – 3:00 AM",
  },
  {
    month: "NOV",
    day: "27",
    artistName: "Orion Keller",
    location: "Rome",
    venue: "Echo Chamber",
    time: "2:00 AM – 3:30 AM",
  },
  {
    month: "NOV",
    day: "27",
    artistName: "DJ Hollowtone",
    location: "Brooklyn",
    venue: "Pulse Underground",
    time: "3:00 AM – 5:00 AM",
  },
  {
    month: "NOV",
    day: "27",
    artistName: "Mira Strobe",
    location: "Copenhagen",
    venue: "Obscura Club",
    time: "4:00 AM – 6:00 AM",
  },
]

const bookingsInProgress = [
  {
    month: "DEC",
    day: "7",
    artistName: "Aero Lindholm",
    location: "Valencia",
    venue: "Liquid Canvas",
    time: "1:00 AM – 3:00 AM",
  },
  {
    month: "JAN",
    day: "14",
    artistName: "Kiro Solenne",
    location: "Los Angeles",
    venue: "Luminous Hall",
    time: "9:00 PM – 10:30 PM",
  },
  {
    month: "JAN",
    day: "21",
    artistName: "Nara Flux",
    location: "Vienna",
    venue: "Neon Drift",
    time: "10:00 PM – 11:00 PM",
  },
  {
    month: "FEB",
    day: "9",
    artistName: "Vesper Kline",
    location: "Turin",
    venue: "Frequency Loft",
    time: "1:00 AM – 2:30 AM",
  },
]

export default function DashboardPage() {
  return (
    <div className="flex gap-6">
      {/* Main content area */}
      <div className="flex-1 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4">
          {stats.map((stat) => (
            <StatsCard key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>

        {/* Events in progress */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Event in progress</h2>
            <Link
              href="/dashboard/events"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {eventsInProgress.map((event, index) => (
              <EventCard key={index} {...event} />
            ))}
          </div>
        </section>

        {/* Bookings in progress */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Booking in progress</h2>
            <Link
              href="/dashboard/bookings"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {bookingsInProgress.map((booking, index) => (
              <BookingCard key={index} {...booking} />
            ))}
          </div>
        </section>
      </div>

      {/* Quick actions sidebar */}
      <div className="w-64 shrink-0">
        <QuickActions />
      </div>
    </div>
  )
}
