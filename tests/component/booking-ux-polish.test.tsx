// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { Booking, BookingWithArtist } from "@/lib/actions/bookings"
import type { Artist } from "@/lib/actions/artists"

const mocks = vi.hoisted(() => ({
  getBookings: vi.fn(), getBooking: vi.fn(), createBooking: vi.fn(), updateBooking: vi.fn(), deleteBooking: vi.fn(),
  getArtist: vi.fn(), listEvents: vi.fn(), push: vi.fn(), refresh: vi.fn(),
}))
vi.mock("@/lib/actions/bookings", () => ({
  getBookings: mocks.getBookings, getBooking: mocks.getBooking, createBooking: mocks.createBooking,
  updateBooking: mocks.updateBooking, deleteBooking: mocks.deleteBooking,
}))
vi.mock("@/lib/actions/artists", () => ({ getArtist: mocks.getArtist, getArtists: vi.fn(async () => []) }))
vi.mock("@/lib/actions/events", () => ({ listEvents: mocks.listEvents }))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=calendar"),
  usePathname: () => "/dashboard/artists/artist-a",
}))
import BookingsPage from "@/app/dashboard/bookings/page"
import EventBookingPage from "@/app/dashboard/bookings/[id]/page"
import ArtistPage from "@/app/dashboard/artists/[id]/page"
import { DashboardContent } from "@/app/dashboard/dashboard-content"
import { NewBookingModal } from "@/components/dashboard/new-booking-modal"
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"

const artistId = "11111111-1111-4111-8111-111111111111"
const row = (overrides: Partial<Booking> = {}): Booking => ({
  fee_amount_minor: null, fee_currency: null,
  id: "booking-a", workspace_id: "workspace-a", artist_id: artistId,
  date: "2026-11-20", start_time: "21:30:00", duration_minutes: 60, notes: null,
  venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null,
  contact_email_main: null, status: "in_progress", created_at: "", updated_at: "",
  artist: { id: artistId, stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: null, profile_image_url: null },
  ...overrides,
})
const editorBooking = row() as BookingWithArtist
const modalArtist = { id: artistId, stage_name: "DJ Moon", name: "Luna", base_rate: null } as Artist

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

// 1 + 2: dashboard time format and artist-name fallback
it("shows dashboard booking times as HH:MM and falls back to the artist name", () => {
  render(<DashboardContent
    welcomeMessage="Welcome back"
    stats={{ eventsInProgress: 0, bookingsInProgress: 0, totalArtists: 1 }}
    eventsInProgress={[]}
    calendarToday="2026-11-14"
    bookings={[row({ artist: { ...row().artist!, stage_name: null, name: "Luna" } })]}
  />)
  const section = screen.getByRole("region", { name: "Bookings in progress" })
  expect(within(section).getByRole("heading", { name: "Luna" })).toBeTruthy()
  expect(within(section).getByText("21:30", { exact: true })).toBeTruthy()
  expect(within(section).queryByText(/21:30:00/)).toBeNull()
})

// 3: bookings list filter and grouping
const listRows = [
  row({ id: "future-late", date: "2026-12-01", status: "confirmed" }),
  row({ id: "today", date: "2026-11-14", status: "in_progress" }),
  row({ id: "past-old", date: "2026-01-10", status: "completed" }),
  row({ id: "past-recent", date: "2026-11-01", status: "cancelled" }),
]
const detailLinks = (name: string) => within(screen.getByRole("region", { name }))
  .getAllByRole("link", { name: "Continue setup" }).map(link => link.getAttribute("href"))

it("groups all bookings into upcoming (ascending) and past (most recent first) with status badges", async () => {
  mocks.getBookings.mockResolvedValueOnce(listRows)
  render(await BookingsPage({ searchParams: Promise.resolve({}) }))
  expect(detailLinks("Upcoming")).toEqual(["/dashboard/bookings/today", "/dashboard/bookings/future-late"])
  expect(detailLinks("Past")).toEqual(["/dashboard/bookings/past-recent", "/dashboard/bookings/past-old"])
  const nav = screen.getByRole("navigation", { name: "Filter bookings by status" })
  expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["All", "In progress", "Hold", "Option", "Confirmed", "Cancelled", "Completed"])
  expect(within(nav).getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page")
  expect(within(screen.getByRole("region", { name: "Past" })).getByText("Completed")).toBeTruthy()
})

it("filters by the status URL parameter on the server and marks the active filter", async () => {
  mocks.getBookings.mockResolvedValueOnce(listRows)
  render(await BookingsPage({ searchParams: Promise.resolve({ status: "confirmed" }) }))
  expect(detailLinks("Upcoming")).toEqual(["/dashboard/bookings/future-late"])
  expect(screen.queryByRole("region", { name: "Past" })).toBeNull()
  const confirmed = screen.getByRole("link", { name: "Confirmed" })
  expect(confirmed.getAttribute("href")).toBe("/dashboard/bookings?status=confirmed")
  expect(confirmed.getAttribute("aria-current")).toBe("page")
  expect(mocks.getBookings).toHaveBeenCalledWith({ failOnError: true })
})

it("shows an honest empty state for a status with no bookings and ignores unknown filters", async () => {
  mocks.getBookings.mockResolvedValueOnce([row({ status: "confirmed" })])
  render(await BookingsPage({ searchParams: Promise.resolve({ status: "cancelled" }) }))
  expect(screen.getByText("No bookings with this status.")).toBeTruthy()
  expect(screen.queryByText("No bookings in your workspace yet.")).toBeNull()
  cleanup()
  mocks.getBookings.mockResolvedValueOnce([row({ status: "confirmed" })])
  render(await BookingsPage({ searchParams: Promise.resolve({ status: "pending" }) }))
  expect(screen.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page")
  expect(screen.getAllByRole("link", { name: "Continue setup" })).toHaveLength(1)
})

// 4 + 6: editor status badge, close target, same-day notice
it("shows a read-only status badge and closes to the bookings list", () => {
  render(<EventBookingClient booking={{ ...editorBooking, status: "confirmed" }} />)
  expect(screen.getByLabelText("Status: Confirmed").textContent).toBe("Confirmed")
  expect(screen.queryByRole("combobox", { name: /status/i })).toBeNull()
  expect(screen.getByRole("link", { name: "Close" }).getAttribute("href")).toBe("/dashboard/bookings")
  expect((screen.getByLabelText("End time") as HTMLInputElement).readOnly).toBe(true)
  expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("22:30")
})

it("warns in the editor about other same-day bookings, excluding itself and cancelled ones, and follows date edits", () => {
  const artistBookings = [
    editorBooking,
    row({ id: "same-day", date: "2026-11-20", status: "confirmed" }),
    row({ id: "cancelled", date: "2026-11-20", status: "cancelled" }),
    row({ id: "next-day", date: "2026-11-21" }),
  ]
  render(<EventBookingClient booking={editorBooking} artistBookings={artistBookings} />)
  expect(screen.getByText("This artist already has another booking on this date.")).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "2026-11-22" } })
  expect(screen.queryByText(/already has/)).toBeNull()
  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "2026-11-21" } })
  expect(screen.getByText("This artist already has another booking on this date.")).toBeTruthy()
  expect(mocks.updateBooking).not.toHaveBeenCalled()
})

it("says the same-day check could not run when the artist read failed, without blocking the editor", async () => {
  mocks.getBooking.mockResolvedValueOnce(editorBooking)
  mocks.getBookings.mockRejectedValueOnce(new Error("private detail"))
  render(await EventBookingPage({ params: Promise.resolve({ id: editorBooking.id }) }))
  expect(mocks.getBookings).toHaveBeenCalledWith({ artistId, failOnError: true })
  expect(screen.getByText("Other bookings for this date could not be checked.")).toBeTruthy()
  expect(screen.queryByText("private detail")).toBeNull()
  expect(screen.getByRole("button", { name: "Update booking" })).toBeTruthy()
})

// 5 + 6: create modal
it("labels the note and search, and warns without blocking about past dates and same-day bookings", () => {
  render(<NewBookingModal
    open
    onOpenChange={vi.fn()}
    preselectedArtist={modalArtist}
    calendarToday="2026-11-14"
    existingBookings={[row({ id: "existing", date: "2026-11-20" }), row({ id: "gone", date: "2026-11-10", status: "cancelled" })]}
  />)
  expect(screen.getByLabelText("Note").tagName).toBe("TEXTAREA")
  const date = screen.getByLabelText("Select date")
  fireEvent.change(date, { target: { value: "2026-11-10" } })
  expect(screen.getByText("This date is in the past. You can still save the booking.")).toBeTruthy()
  expect(screen.queryByText(/already has/)).toBeNull()
  expect(date.getAttribute("aria-describedby")).toBe("new-booking-past-date")
  fireEvent.change(date, { target: { value: "2026-11-20" } })
  expect(screen.queryByText(/in the past/)).toBeNull()
  expect(screen.getByText("This artist already has another booking on this date.")).toBeTruthy()
  fireEvent.change(date, { target: { value: "2026-11-14" } })
  expect(screen.queryByText(/in the past|already has/)).toBeNull()
  expect((screen.getByRole("button", { name: "Save on calendar" }) as HTMLButtonElement).disabled).toBe(false)
})

it("gives the artist search an accessible name", () => {
  render(<NewBookingModal open onOpenChange={vi.fn()} />)
  expect(screen.getByRole("textbox", { name: "Search artists" })).toBeTruthy()
})

it("says the modal same-day check could not run when the page read failed", () => {
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={modalArtist} existingBookings={null} calendarToday="2026-11-14" />)
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: "2026-11-20" } })
  expect(screen.getByText("Other bookings for this date could not be checked.")).toBeTruthy()
})

// 1 + 6: artist calendar
it("shows calendar times as HH:MM and marks days with more than one booking", async () => {
  mocks.getArtist.mockResolvedValueOnce({ id: artistId, name: "Luna", stage_name: "DJ Moon" })
  mocks.listEvents.mockResolvedValueOnce([])
  mocks.getBookings.mockResolvedValueOnce([
    row({ id: "first", date: "2026-11-20", start_time: "20:00:00" }),
    row({ id: "second", date: "2026-11-20", start_time: "23:15:00", status: "confirmed" }),
    row({ id: "dropped", date: "2026-11-20", status: "cancelled" }),
    row({ id: "single", date: "2026-11-25", start_time: "19:00:00" }),
  ])
  const { container } = render(await ArtistPage({ params: Promise.resolve({ id: artistId }) }))
  expect(screen.getByText("20:00", { exact: true })).toBeTruthy()
  expect(screen.getByText("23:15", { exact: true })).toBeTruthy()
  expect(screen.queryByText(/:00:00/)).toBeNull()
  expect(screen.getAllByText("2 bookings this day")).toHaveLength(2)
  expect(screen.getByText("More than one booking on this day")).toBeTruthy()
  const multiple = [...container.querySelectorAll('[data-multiple="true"]')]
  expect(multiple.map(day => day.textContent)).toEqual(["20"])
  expect(screen.getByRole("gridcell", { name: /November 20.*2 bookings/ })).toBeTruthy()
  expect(screen.queryByRole("gridcell", { name: /November 25.*bookings/ })).toBeNull()
})
