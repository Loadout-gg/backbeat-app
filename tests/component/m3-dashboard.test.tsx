// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { Booking } from "@/lib/actions/bookings"
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/actions/artists", () => ({ getArtists: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/actions/bookings", () => ({ createBooking: vi.fn() }))
import { DashboardContent } from "@/app/dashboard/dashboard-content"
import { EventCard } from "@/components/dashboard/event-card"
import { BookingCard } from "@/components/dashboard/booking-card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { QuickActions } from "@/components/dashboard/quick-actions"
afterEach(cleanup)
it("puts creation actions before the work lists in keyboard reading order", () => {
  render(<DashboardContent {...props} />)
  const actions = screen.getByRole("region", { name: "Quick Actions" })
  const events = screen.getByRole("region", { name: "Events in progress" })
  expect(Boolean(actions.compareDocumentPosition(events) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
})
it("gives the dashboard one primary page heading", () => {
  render(<DashboardContent {...props} />)
  expect(screen.queryByRole("heading", { level: 1, name: "Welcome back" })).toBeTruthy()
})
it("explains the supported next step when bookings are empty", () => {
  render(<DashboardContent {...props} />)
  const section = screen.getByRole("region", { name: "Bookings in progress" })
  expect(within(section).getByText("Create a booking to choose an artist and add a date.")).toBeTruthy()
})
it("preserves the stored calendar day for bookings in every operator timezone", () => {
  render(<DashboardContent {...props} bookings={[booking()]} />)
  const section = screen.getByRole("region", { name: "Bookings in progress" })
  expect(within(section).getByText("2", { exact: true })).toBeTruthy()
})
it("does not invent midnight when an event supplies a calendar date only", () => {
  render(<DashboardContent {...props} eventsInProgress={[{ id: "synthetic-date", date: "2030-01-02", title: "Synthetic date-only event", location: "Synthetic location" }]} />)
  expect(screen.getByText(/Synthetic location/).textContent).toBe("Synthetic location")
})
it("uses bounded grid tracks for side-by-side quick actions", () => {
  render(<QuickActions onNewBooking={() => {}} />)
  const actions = screen.getByRole("button", { name: "New Booking" }).parentElement!
  expect(actions.className).toContain("sm:grid-cols-2")
  expect(actions.className).toContain("xl:grid-cols-1")
})
it("does not offer non-existent footer destinations as working links", () => {
  render(<DashboardContent {...props} />)
  const footer = screen.getByRole("contentinfo")
  expect(within(footer).queryAllByRole("link")).toHaveLength(0)
  expect(footer.textContent).toContain("Backbeat")
  expect(footer.textContent).toContain("unavailable")
})
it("renders missing event fields without leading punctuation and wraps long names", () => {
  const name = "SyntheticEventArtist".repeat(15)
  render(<EventCard month="JAN" day="2" artistName={name} venue="Synthetic venue" location="" />)
  expect(screen.getByText(/Synthetic venue/).textContent).toBe("Synthetic venue")
  expect(screen.getByRole("heading", { name }).className).toContain("break-words")
  expect(screen.queryByRole("button")).toBeNull()
  expect(screen.queryByRole("link")).toBeNull()
})
it("keeps long shared row content readable and the booking action on its own narrow row", () => {
  const name = "SyntheticLongArtist".repeat(15)
  const { container } = render(<BookingCard id="synthetic-long" month="JAN" day="2" artistName={name} venue="Synthetic venue" location="Synthetic address" time="09:45" />)
  expect(screen.getByRole("heading", { name }).className).toContain("break-words")
  expect(container.firstElementChild?.className).toContain("flex-col")
  expect(container.firstElementChild?.className).toContain("sm:flex-row")
  expect(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href")).toBe("/dashboard/bookings/synthetic-long")
})
it("groups work in labelled regions and lists that can reflow without fixed side widths", () => {
  render(<DashboardContent {...props} bookings={[booking()]} eventsInProgress={[{ id: "synthetic-event", date: "2030-01-02T15:30:00", title: "Synthetic event", location: null }]} />)
  const events = screen.getByRole("region", { name: "Events in progress" })
  const bookings = screen.getByRole("region", { name: "Bookings in progress" })
  expect(within(events).getAllByRole("listitem")).toHaveLength(1)
  expect(within(bookings).getAllByRole("listitem")).toHaveLength(1)
  expect(within(events).getByRole("link", { name: /View all/ }).getAttribute("href")).toBe("/dashboard/events")
  expect(within(bookings).getByRole("link", { name: /View all/ }).getAttribute("href")).toBe("/dashboard/bookings")
  expect(screen.getByRole("region", { name: "Quick Actions" })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Welcome back" }).className).toContain("break-words")
  expect(events.parentElement?.parentElement?.className).toContain("grid-cols-1")
})
it("lets the dashboard own booking creation from Quick Actions", () => {
  const onNewBooking = vi.fn()
  render(<QuickActions onNewBooking={onNewBooking} />)
  fireEvent.click(screen.getByRole("button", { name: "New Booking" }))
  expect(onNewBooking).toHaveBeenCalledOnce()
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.getByRole("link", { name: "Add artist" }).getAttribute("href")).toBe("/dashboard/artists/new")
})
it("renders only the provided event start time, not an invented duration", () => {
  const date = "2030-01-02T15:30:00"
  render(<DashboardContent {...props} eventsInProgress={[{ id: "synthetic-event", date, title: "Synthetic event", location: "Synthetic location" }]} />)
  const expected = new Date(date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  expect(screen.getByText(/Synthetic location/).textContent).toBe(`Synthetic location • ${expected}`)
})
it("shows persisted booking venue and address without substituting an artist city", () => {
  render(<DashboardContent {...props} bookings={[booking({ venue_name: "Synthetic venue", venue_address: "Synthetic address 42" })]} />)
  expect(screen.getByText(/Synthetic venue/).textContent).toBe("Synthetic address 42, Synthetic venue • 09:45")
  expect(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href")).toBe("/dashboard/bookings/synthetic-booking")
})
const booking = (overrides: Partial<Booking> = {}): Booking => ({
  fee_amount_minor: null, fee_currency: null,
  id: "synthetic-booking", workspace_id: "synthetic-workspace", artist_id: "synthetic-artist",
  date: "2030-01-02", start_time: "09:45", duration_minutes: null, notes: null,
  venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null,
  contact_email_main: null, status: "in_progress", created_at: "", updated_at: "", ...overrides,
})
const props = { welcomeMessage: "Welcome back", stats: { eventsInProgress: 7, bookingsInProgress: 99, totalArtists: 12 }, eventsInProgress: [], bookings: [] }
it("exposes only the three supported metrics with the filtered booking count", () => {
  render(<DashboardContent {...props} bookings={[booking(), booking({ id: "other", status: "cancelled" })]} />)
  expect(screen.queryByText("Performance in progress")).toBeNull()
  const summary = screen.getByRole("region", { name: "Workspace overview" })
  expect(within(summary).getAllByRole("term")).toHaveLength(3)
  expect(within(summary).getAllByRole("definition").map(el => el.textContent)).toEqual(["7", "1", "12"])
})

// Compatibility checks: these existing behaviors are intentionally unchanged.
it.each(["Bookings in progress", "Quick Actions"])("opens the real booking dialog from %s and can close it", async (name) => {
  render(<DashboardContent {...props} />)
  fireEvent.click(within(screen.getByRole("region", { name })).getByRole("button", { name: "New Booking" }))
  expect(screen.getAllByRole("dialog")).toHaveLength(1)
  expect(await screen.findByText("No artists available in your workspace")).toBeTruthy()
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }))
  expect(screen.queryByRole("dialog")).toBeNull()
})
it("retains the standalone QuickActions dialog for existing callers", async () => {
  render(<QuickActions />)
  fireEvent.click(screen.getByRole("button", { name: "New Booking" }))
  expect(await screen.findByText("No artists available in your workspace")).toBeTruthy()
  expect(screen.getAllByRole("dialog")).toHaveLength(1)
})
it("preserves string and zero StatsCard values", () => {
  render(<><StatsCard label="Synthetic string" value="12" /><StatsCard label="Synthetic zero" value={0} /></>)
  expect(screen.getAllByRole("definition").map(el => el.textContent)).toEqual(["12", "0"])
})
it("preserves the six-event preview and all in-progress booking rows", () => {
  const events = Array.from({ length: 7 }, (_, index) => ({ id: `synthetic-event-${index}`, title: `Synthetic event ${index}`, date: "2030-01-02T15:30:00", location: null }))
  const bookings = Array.from({ length: 8 }, (_, index) => booking({ id: `synthetic-booking-${index}` }))
  render(<DashboardContent {...props} eventsInProgress={events} bookings={bookings} />)
  expect(within(screen.getByRole("region", { name: "Events in progress" })).getAllByRole("listitem")).toHaveLength(6)
  expect(within(screen.getByRole("region", { name: "Bookings in progress" })).getAllByRole("listitem")).toHaveLength(8)
})
it.each([
  { venue: "", location: "", time: "09:45", expected: "09:45" },
  { venue: "Synthetic venue", location: "", time: "", expected: "Synthetic venue" },
  { venue: "", location: "Synthetic address", time: "09:45", expected: "Synthetic address • 09:45" },
])("keeps sparse shared booking props compatible: $expected", ({ expected, ...details }) => {
  render(<BookingCard id="synthetic-sparse" month="JAN" day="2" artistName="Synthetic artist" {...details} />)
  expect(screen.getByText(expected, { exact: true })).toBeTruthy()
})
