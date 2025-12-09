import Link from "next/link"
import { StatsCard } from "@/components/dashboard/stats-card"
import { EventCard } from "@/components/dashboard/event-card"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { ArrowRight } from "lucide-react"
import { getDashboardStats } from "@/lib/actions/dashboard"
import { listEventsInProgress } from "@/lib/actions/events"

export default async function DashboardPage() {
  const [stats, eventsInProgress] = await Promise.all([getDashboardStats(), listEventsInProgress()])

  return (
    <div className="flex gap-6">
      {/* Main content area */}
      <div className="flex-1 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Events total" value={stats.totalEvents} />
          <StatsCard label="Bookings in progress" value={stats.totalBookingsInProgress} />
          <StatsCard label="Artists total" value={stats.totalArtists} />
          <StatsCard label="Promoters total" value={stats.totalPromoters} />
        </div>

        {/* Events in progress */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Events in progress</h2>
            <Link
              href="/dashboard/events"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {eventsInProgress.length === 0 ? (
            <div className="rounded-lg border bg-background p-8 text-center text-muted-foreground">
              No events in progress. Create your first event to get started.
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
                    time=""
                  />
                )
              })}
            </div>
          )}
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
            {/* Placeholder for real bookings data */}
            {/* This section will be updated later with real data */}
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
