import { beforeEach, expect, it, vi } from "vitest"
const { stats, events, bookings, user } = vi.hoisted(() => ({
  stats: vi.fn(), events: vi.fn(), bookings: vi.fn(), user: vi.fn(),
}))
vi.mock("@/lib/actions/dashboard", () => ({ getDashboardStats: stats }))
vi.mock("@/lib/actions/events", () => ({ listEventsInProgress: events }))
vi.mock("@/lib/actions/bookings", () => ({ getBookings: bookings }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentUser: user }))
vi.mock("@/app/dashboard/dashboard-content", () => ({ DashboardContent: () => null }))
import DashboardPage from "@/app/dashboard/page"
const emptyStats = { totalArtists: 0, eventsInProgress: 0, bookingsInProgress: 0, totalPromoters: 0 }
beforeEach(() => {
  stats.mockReset().mockResolvedValue(emptyStats)
  events.mockReset().mockResolvedValue([])
  bookings.mockReset().mockResolvedValue([])
  user.mockReset().mockResolvedValue(null)
})
it("accepts genuinely empty successful reads without changing normal props", async () => {
  const result = await DashboardPage()
  expect(result.props).toEqual({ welcomeMessage: "Welcome back", stats: emptyStats, eventsInProgress: [], bookings: [] })
  expect(bookings).toHaveBeenCalledWith({ failOnError: true })
})
it.each(["events", "bookings", "stats", "user"] as const)("does not turn %s rejection into a successful dashboard", async name => {
  const failure = new Error("Synthetic reader failure")
  const readers = { events, bookings, stats, user }
  readers[name].mockRejectedValueOnce(failure)
  await expect(DashboardPage()).rejects.toBe(failure)
})
it("preserves framework redirect rejection rather than swallowing it", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/auth/login;307;" })
  events.mockRejectedValueOnce(redirect)
  await expect(DashboardPage()).rejects.toBe(redirect)
})
