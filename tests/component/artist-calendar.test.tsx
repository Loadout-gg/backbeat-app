// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import ArtistPage from "@/app/dashboard/artists/[id]/page"
import type { Artist } from "@/lib/actions/artists"
import type { Booking } from "@/lib/actions/bookings"
import type { EventWithRelations } from "@/lib/actions/events"

const mocks = vi.hoisted(() => ({ getArtist: vi.fn(), getBookings: vi.fn(), listEvents: vi.fn() }))
vi.mock("@/lib/actions/artists", () => ({ getArtist: mocks.getArtist }))
vi.mock("@/lib/actions/bookings", () => ({ getBookings: mocks.getBookings }))
vi.mock("@/lib/actions/events", () => ({ listEvents: mocks.listEvents }))
vi.mock("@/components/dashboard/new-booking-modal", () => ({ NewBookingModal: () => null }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=calendar"),
  useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/artists/artist-a",
  notFound: () => { throw new Error("not found") },
}))
const artist = { id: "artist-a", name: "Alice", stage_name: "DJ Alice" } as Artist
const booking = { id: "booking-a", artist_id: "artist-a", date: "2026-09-29", start_time: "20:00", status: "in_progress" } as Booking
const event = { id: "event-a", artist_id: "artist-a", date: "2026-10-02", title: "Autumn show", location: "Rome", status: "confirmed" } as EventWithRelations
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 8, 29, 15))
  mocks.getArtist.mockResolvedValue(artist)
  mocks.getBookings.mockResolvedValue([booking])
  mocks.listEvents.mockResolvedValue([event])
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it("shows only this artist's today/future active entries, sorted by date, with an honest all-upcoming policy", async () => {
  mocks.getBookings.mockResolvedValue([
    { ...booking, id: "later", date: "2027-03-01", status: "confirmed" }, booking,
    { ...booking, id: "other", artist_id: "artist-b" },
    { ...booking, id: "cancelled", status: "cancelled" },
    { ...booking, id: "completed", status: "completed" },
    { ...booking, id: "past", date: "2026-09-28" },
  ])
  mocks.listEvents.mockResolvedValue([
    event, { ...event, id: "today", date: "2026-09-29", title: "Today show", status: "in_progress" },
    { ...event, id: "other", artist_id: "artist-b", title: "Other artist show" },
    { ...event, id: "cancelled", status: "cancelled", title: "Cancelled show" },
    { ...event, id: "completed", status: "completed", title: "Completed show" },
    { ...event, id: "past", date: "2026-09-28", title: "Past show" },
  ])
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  expect(screen.getAllByRole("link", { name: /DJ Alice/ }).map(link => link.getAttribute("href"))).toEqual([
    "/dashboard/bookings/booking-a", "/dashboard/bookings/later",
  ])
  expect(screen.getByText("Today show")).toBeTruthy()
  for (const name of ["Other artist show", "Cancelled show", "Completed show", "Past show"]) expect(screen.queryByText(name)).toBeNull()
  expect(screen.getByText("All upcoming")).toBeTruthy()
  expect(screen.queryByText(/Showing 1-10/)).toBeNull()
})
it.each(["getBookings", "listEvents"] as const)("shows a visible calendar error, not a false empty state, when %s fails", async (reader) => {
  mocks[reader].mockRejectedValueOnce(new Error("private database detail"))
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  expect(screen.getByRole("alert").textContent).toMatch(/Unable to load.*calendar/i)
  expect(screen.queryByText("No upcoming bookings or events for this artist.")).toBeNull()
  expect(screen.queryByText(/private database detail/)).toBeNull()
})
it("retains the genuine empty state after successful empty reads", async () => {
  mocks.getBookings.mockResolvedValue([])
  mocks.listEvents.mockResolvedValue([])
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  expect(screen.getByText("No upcoming bookings or events for this artist.")).toBeTruthy()
  expect(screen.queryByRole("alert")).toBeNull()
})
it("marks persisted local calendar days rather than selecting today without an entry", async () => {
  mocks.getBookings.mockResolvedValue([{ ...booking, date: "2026-09-30" }])
  mocks.listEvents.mockResolvedValue([])
  const { container } = render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  const selectedDays = Array.from(container.querySelectorAll('[data-selected-single="true"]'))
  expect(selectedDays.map(day => day.getAttribute("data-day"))).toEqual([new Date(2026, 8, 30).toLocaleDateString()])
  const bookingRow = screen.getByRole("link", { name: /DJ Alice/ }).closest("div.flex.items-center.justify-between")
  expect(bookingRow?.textContent).toContain("Sep30")
})
it("reads scoped persisted calendar data and renders a booking link and event without a fabricated detail route", async () => {
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  expect(mocks.getBookings).toHaveBeenCalledWith({ artistId: artist.id, failOnError: true })
  expect(mocks.listEvents).toHaveBeenCalledOnce()
  expect(screen.getByRole("link", { name: /DJ Alice/ }).getAttribute("href")).toBe("/dashboard/bookings/booking-a")
  expect(screen.getByText("Autumn show").closest("a")).toBeNull()
  expect(screen.queryByText("No upcoming bookings or events for this artist.")).toBeNull()
})
