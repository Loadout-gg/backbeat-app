// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { hydrateRoot } from "react-dom/client"
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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs() })
it("shares the configured server day across filtering, initial month and today marker despite a different client clock", async () => {
  vi.stubEnv("BACKBEAT_CALENDAR_TIME_ZONE", "Europe/Rome")
  vi.setSystemTime(new Date("2026-09-30T22:30:00Z"))
  mocks.getBookings.mockResolvedValue([
    { ...booking, id: "yesterday", date: "2026-09-30" },
    { ...booking, id: "today", date: "2026-10-01" },
  ])
  mocks.listEvents.mockResolvedValue([])
  const page = await ArtistPage({ params: Promise.resolve({ id: artist.id }) })
  expect(page.props.calendarToday).toBe("2026-10-01")
  // The browser clock is not an authority for the already-rendered response.
  vi.setSystemTime(new Date("2026-09-29T10:00:00Z"))
  const { container } = render(page)
  expect(screen.getAllByRole("link", { name: /DJ Alice/ }).map(link => link.getAttribute("href"))).toEqual(["/dashboard/bookings/today"])
  expect(screen.getAllByText("October 2026").length).toBeGreaterThan(0)
  expect(container.querySelector('[data-today="true"]')?.textContent).toBe("1")
})
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
it("keeps persisted occupancy separate from selection when occupied and empty dates are clicked", async () => {
  mocks.getBookings.mockResolvedValue([{ ...booking, date: "2026-09-30" }])
  mocks.listEvents.mockResolvedValue([{ ...event, date: "2026-09-30" }])
  const { container } = render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  const occupiedDays = () => Array.from(container.querySelectorAll('[data-booked="true"]'))
  expect(occupiedDays().map(day => day.getAttribute("data-day"))).toEqual(["2026-09-30"])
  const occupied = screen.getByRole("gridcell", { name: /September 30.*active booking or event/i })
  const empty = screen.getByRole("gridcell", { name: /September 29/ })
  const markerClass = occupied.className
  expect(screen.getByText("Active booking or event", { exact: true })).toBeTruthy()
  expect(screen.getByText(/Calendar is read-only/)).toBeTruthy()
  // There is no implemented date-selection/filter action on this all-upcoming view.
  expect(within(screen.getByRole("grid")).queryByRole("button")).toBeNull()
  for (const day of [empty, occupied, occupied]) {
    fireEvent.click(day)
    expect(occupiedDays().map(cell => cell.getAttribute("data-day"))).toEqual(["2026-09-30"])
    expect(occupied.className).toBe(markerClass)
    expect(empty.getAttribute("data-booked")).toBeNull()
    expect(screen.getByRole("grid").querySelector('[aria-selected="true"], [data-selected-single="true"]')).toBeNull()
  }
  const bookingRow = screen.getByRole("link", { name: /DJ Alice/ }).closest("div.flex.items-center.justify-between")
  expect(bookingRow?.textContent).toContain("Sep30")
  expect(screen.getByText("Autumn show")).toBeTruthy()
})
it("reads scoped persisted calendar data and renders a booking link and event without a fabricated detail route", async () => {
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  expect(mocks.getBookings).toHaveBeenCalledWith({ artistId: artist.id, failOnError: true })
  expect(mocks.listEvents).toHaveBeenCalledOnce()
  expect(mocks.listEvents).toHaveBeenCalledWith({ artistId: artist.id })
  expect(screen.getByRole("link", { name: /DJ Alice/ }).getAttribute("href")).toBe("/dashboard/bookings/booking-a")
  expect(screen.getByText("Autumn show").closest("a")).toBeNull()
  expect(screen.queryByText("No upcoming bookings or events for this artist.")).toBeNull()
})
it("hydrates a UTC server response in Los Angeles across Rome midnight without changing rows, month or today", async () => {
  vi.stubEnv("BACKBEAT_CALENDAR_TIME_ZONE", "Europe/Rome")
  vi.stubEnv("TZ", "UTC")
  vi.setSystemTime(new Date("2026-09-30T22:30:00Z"))
  expect(new Date().getTimezoneOffset()).toBe(0)
  mocks.getBookings.mockResolvedValue([
    { ...booking, id: "old", date: "2026-09-30" },
    { ...booking, id: "current", date: "2026-10-01" },
  ])
  mocks.listEvents.mockResolvedValue([])
  const page = await ArtistPage({ params: Promise.resolve({ id: artist.id }) })
  const html = renderToString(page)
  vi.stubEnv("TZ", "America/Los_Angeles")
  expect(new Date().getTimezoneOffset()).toBe(420)
  const container = document.createElement("div")
  document.body.appendChild(container)
  container.innerHTML = html
  const hydrationErrors: unknown[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    await act(async () => {
      root = hydrateRoot(container, page, { onRecoverableError: error => hydrationErrors.push(error) })
    })
    expect(hydrationErrors).toEqual([])
    expect(container.querySelector('a[href="/dashboard/bookings/old"]')).toBeNull()
    expect(container.querySelector('a[href="/dashboard/bookings/current"]')).not.toBeNull()
    expect(container.textContent).toContain("October 2026")
    expect(container.querySelector('[data-today="true"]')?.textContent).toBe("1")
  } finally {
    await act(async () => { root?.unmount() })
    container.remove()
  }
})
it("provides one named month-navigation pair and one live month label without end-of-month rollover", async () => {
  vi.setSystemTime(new Date(2027, 0, 31, 15))
  mocks.getBookings.mockResolvedValue([{ ...booking, date: "2027-01-31" }])
  mocks.listEvents.mockResolvedValue([])
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  const panel = screen.getByRole("tabpanel", { name: "Calendar" })
  expect(within(panel).getAllByText("January 2027")).toHaveLength(1)
  expect(within(panel).getAllByRole("button")).toHaveLength(2)
  expect(within(panel).getByRole("button", { name: "Previous month" })).toBeTruthy()
  fireEvent.click(within(panel).getByRole("button", { name: "Next month" }))
  expect(within(panel).getAllByText("February 2027")).toHaveLength(1)
  expect(within(panel).getByRole("status").textContent).toBe("February 2027")
  fireEvent.click(within(panel).getByRole("button", { name: "Previous month" }))
  expect(within(panel).getAllByText("January 2027")).toHaveLength(1)
  expect(within(panel).getByRole("gridcell", { name: /January 31.*active booking or event/i }).getAttribute("data-booked")).toBe("true")
})
it("retains keyboard focus on the single calendar navigation control after changing month", async () => {
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  const next = screen.getByRole("button", { name: "Next month" })
  next.focus()
  fireEvent.click(next)
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next month" }))
  const previous = screen.getByRole("button", { name: "Previous month" })
  previous.focus()
  fireEvent.click(previous)
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Previous month" }))
})
it("uses UTC when no calendar timezone is configured (boundary characterization)", async () => {
  vi.stubEnv("BACKBEAT_CALENDAR_TIME_ZONE", undefined)
  vi.setSystemTime(new Date("2026-09-30T22:30:00Z"))
  const page = await ArtistPage({ params: Promise.resolve({ id: artist.id }) })
  expect(page.props.calendarToday).toBe("2026-09-30")
})
