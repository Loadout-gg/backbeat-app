import Link from "next/link"
import { StatsCard } from "@/components/dashboard/stats-card"
import { EventCard } from "@/components/dashboard/event-card"
import { BookingCard } from "@/components/dashboard/booking-card"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { getDashboardStats } from "@/lib/actions/dashboard"
import { listEventsInProgress } from "@/lib/actions/events"
import { getBookings } from "@/lib/actions/bookings"
import { getCurrentUser } from "@/lib/actions/workspace"
import { DashboardContent } from "./dashboard-content"

export default async function DashboardPage() {
  const [stats, eventsInProgress, bookings, userData] = await Promise.all([
    getDashboardStats(),
    listEventsInProgress().catch(() => []), // Return empty array if events table doesn't exist
    getBookings().catch(() => []), // Return empty array if bookings table doesn't exist
    getCurrentUser(),
  ])

  // Get first name for welcome message
  const fullName = userData?.profile?.full_name
  const firstName = fullName ? fullName.split(" ")[0] : null
  const welcomeMessage = firstName ? `Welcome back, ${firstName}` : "Welcome back"

  return (
    <DashboardContent
      welcomeMessage={welcomeMessage}
      stats={stats}
      eventsInProgress={eventsInProgress}
      bookings={bookings}
    />
  )
}
