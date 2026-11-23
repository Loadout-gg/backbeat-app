// @vitest-environment jsdom
// F20 (Alberto's product review 2026-11-23, findings EXP-02, EXP-05, EXP-06, BK-07, BK-08):
// keyboard/mobile accessibility on the touched screens, dashboard scope and agenda order.
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { Artist, ArtistOption } from "@/lib/actions/artists"
import type { Booking, BookingWithArtist } from "@/lib/actions/bookings"
import type { EventWithRelations } from "@/lib/actions/events"

const mocks = vi.hoisted(() => ({
  createArtist: vi.fn(),
  getArtists: vi.fn(),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
  updateBookingStatus: vi.fn(),
  deleteBooking: vi.fn(),
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  listPromoters: vi.fn(),
  deletePromoter: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), back: vi.fn() },
}))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams("tab=calendar"),
  usePathname: () => "/dashboard/artists/artist-a",
}))
vi.mock("@/lib/actions/artists", () => ({ createArtist: mocks.createArtist, getArtists: mocks.getArtists }))
vi.mock("@/lib/actions/bookings", () => ({
  createBooking: mocks.createBooking,
  updateBooking: mocks.updateBooking,
  updateBookingStatus: mocks.updateBookingStatus,
  deleteBooking: mocks.deleteBooking,
}))
vi.mock("@/lib/actions/events", () => ({ createEvent: mocks.createEvent, deleteEvent: mocks.deleteEvent, listPromoters: mocks.listPromoters }))
vi.mock("@/lib/actions/promoters", () => ({ deletePromoter: mocks.deletePromoter, createPromoter: vi.fn(), updatePromoter: vi.fn() }))

import { DashboardContent, DASHBOARD_EVENTS_LIMIT } from "@/app/dashboard/dashboard-content"
import { NewBookingModal } from "@/components/dashboard/new-booking-modal"
import NewEventPage from "@/app/dashboard/events/new/page"
import NewArtistPage from "@/app/dashboard/artists/new/page"
import { DeleteEvent } from "@/app/dashboard/events/[id]/delete-event"
import { DeletePromoter } from "@/app/dashboard/promoters/delete-promoter"
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import { ArtistProfileClient } from "@/app/dashboard/artists/[id]/artist-profile-client"

const ARTIST_ID = "11111111-1111-4111-8111-111111111111"
const option = (id: string, stage_name: string) => ({
  id, stage_name, name: stage_name, real_name: null, surname: null, genre: null, genres: [],
  location: null, base_rate: null, currency: null, profile_image_url: null,
}) as unknown as ArtistOption

function booking(overrides: Partial<Booking> & { stage?: string } = {}): Booking {
  const { stage = "DJ Moon", ...rest } = overrides
  return {
    fee_amount_minor: null, fee_currency: null, id: "booking-a", workspace_id: "workspace-a", artist_id: ARTIST_ID,
    date: "2030-01-02", start_time: "21:30:00", duration_minutes: null, notes: null,
    venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
    status: "in_progress", created_at: "", updated_at: "",
    artist: { id: ARTIST_ID, stage_name: stage, name: null, surname: null, location: null, fee: null, currency: null, profile_image_url: null },
    ...rest,
  }
}
const event = (n: number) => ({ id: `event-${n}`, date: `2030-02-${String(n).padStart(2, "0")}`, title: `Synthetic event ${n}`, location: "Synthetic city" })
const dashboardProps = {
  welcomeMessage: "Welcome back",
  stats: { eventsInProgress: 0, bookingsInProgress: 0, totalArtists: 1, totalPromoters: 0 },
  eventsInProgress: [] as ReturnType<typeof event>[],
  bookings: [] as Booking[],
  calendarToday: "2030-01-01",
}

/** Every visible button and link exposes a non-empty accessible name. */
function expectEveryControlNamed() {
  for (const role of ["button", "link"] as const) {
    const all = screen.queryAllByRole(role)
    const named = screen.queryAllByRole(role, { name: /\S/ })
    expect(all.filter((element) => !named.includes(element)).map((element) => element.outerHTML)).toEqual([])
  }
}

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
  for (const mock of Object.values(mocks)) if (typeof mock === "function") mock.mockReset()
  mocks.router.push.mockReset(); mocks.router.refresh.mockReset()
  mocks.getArtists.mockResolvedValue([option("artist-luna", "DJ Luna"), option("artist-nova", "Nova Sound")])
  mocks.listPromoters.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})

// ---- A1: icon-only controls say what they do ----

it("A1: names the icon-only back control on New event and every other control there", async () => {
  render(<NewEventPage />)
  await waitFor(() => expect(mocks.listPromoters).toHaveBeenCalled())
  expect(screen.getByRole("link", { name: "Back to events" }).getAttribute("href")).toBe("/dashboard/events")
  expectEveryControlNamed()
})

it("A1: names the add-artist close icon and the social-link remove icon", () => {
  render(<NewArtistPage />)
  expect(screen.getByRole("button", { name: "Close without saving, back to artists" })).toBeTruthy()
  const linkType = within(screen.getByText("Type of link").parentElement as HTMLElement).getByRole("combobox")
  fireEvent.keyDown(linkType, { key: "Enter" })
  fireEvent.click(screen.getAllByRole("option")[0])
  fireEvent.change(screen.getByPlaceholderText("Link"), { target: { value: "https://example.test/synthetic" } })
  fireEvent.click(screen.getByRole("button", { name: "Add" }))
  expect(screen.getByRole("button", { name: /^Remove .+ link$/ })).toBeTruthy()
  expectEveryControlNamed()
})

it("A1: names the booking editor close icon by its destination", () => {
  render(<EventBookingClient booking={booking() as BookingWithArtist} />)
  expect(screen.getByRole("link", { name: "Close booking, back to Bookings" }).getAttribute("href")).toBe("/dashboard/bookings")
  expectEveryControlNamed()
})

it("A1: every control on the dashboard has a name", () => {
  render(<DashboardContent {...dashboardProps} eventsInProgress={[event(1)]} bookings={[booking()]} />)
  expectEveryControlNamed()
})

// ---- A2: the artist picker's Select identifies the artist ----

it("A2: each Select command in the artist picker names its artist", async () => {
  render(<NewBookingModal open onOpenChange={vi.fn()} />)
  expect(await screen.findByRole("button", { name: "Select DJ Luna" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Select Nova Sound" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull()
  expectEveryControlNamed()
})

// ---- A3: New event labels are tied to their selectors ----

it("A3: Status, Artist and Promoter labels name their selectors", async () => {
  render(<NewEventPage />)
  expect(screen.getByRole("combobox", { name: "Status" }).textContent).toBe("In progress")
  expect(screen.getByRole("combobox", { name: "Artist" })).toBeTruthy()
  expect(screen.getByRole("combobox", { name: "Promoter" })).toBeTruthy()
  // Clicking a label moves focus to its selector, as a native label does.
  const artist = screen.getByRole("combobox", { name: "Artist" })
  await waitFor(() => expect(artist.hasAttribute("disabled")).toBe(false))
  fireEvent.click(screen.getByText("Artist", { selector: "label" }))
  expect(document.activeElement).toBe(artist)
})

// ---- A4: confirmation dialogs: announced title, close control, focus return ----

function ModalHarness() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open new booking</button>
      <NewBookingModal open={open} onOpenChange={setOpen} preselectedArtist={option(ARTIST_ID, "DJ Moon")} calendarToday="2030-01-01" />
    </>
  )
}

it("A4: a controlled dialog returns focus to the button that opened it (Escape)", async () => {
  render(<ModalHarness />)
  const opener = screen.getByRole("button", { name: "Open new booking" })
  opener.focus()
  fireEvent.click(opener)
  const dialog = screen.getByRole("dialog", { name: "New booking" })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  fireEvent.keyDown(dialog, { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(opener))
})

it("A4: the booking confirmation announces its title, has a close control, closes on Escape and returns focus", async () => {
  mocks.createBooking.mockResolvedValueOnce({ success: true, booking: booking({ date: "2030-01-02" }) })
  render(<ModalHarness />)
  const opener = screen.getByRole("button", { name: "Open new booking" })
  opener.focus()
  fireEvent.click(opener)
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: "2030-01-02" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  const dialog = screen.getByRole("dialog", { name: /^Booking saved for DJ Moon on / })
  expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy()
  fireEvent.keyDown(dialog, { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(mocks.router.refresh).toHaveBeenCalledOnce()
  await waitFor(() => expect(document.activeElement).toBe(opener))
})

it("A4: the confirmation close control returns focus to the opener", async () => {
  mocks.createBooking.mockResolvedValueOnce({ success: true, booking: booking({ date: "2030-01-02" }) })
  render(<ModalHarness />)
  const opener = screen.getByRole("button", { name: "Open new booking" })
  opener.focus()
  fireEvent.click(opener)
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: "2030-01-02" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(opener))
})

it.each([
  ["event", () => <DeleteEvent id="event-a" title="Synthetic Night" />, "Delete event", "Delete Synthetic Night?"],
  ["promoter", () => <DeletePromoter id="promoter-a" name="Marta Rossi" />, "Delete promoter", "Delete Marta Rossi?"],
] as const)("A4: the %s delete confirmation takes focus to Cancel, is named by its question and Cancel returns focus", (_kind, ui, trigger, question) => {
  render(ui())
  fireEvent.click(screen.getByRole("button", { name: trigger }))
  const group = screen.getByRole("group", { name: question })
  expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Cancel" }))
  fireEvent.click(within(group).getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("group", { name: question })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole("button", { name: trigger }))
})

it("A4: the booking editor delete confirmation manages focus the same way", () => {
  render(<EventBookingClient booking={booking() as BookingWithArtist} />)
  fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }))
  const group = screen.getByRole("group", { name: "Are you sure?" })
  expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Cancel" }))
  fireEvent.click(within(group).getByRole("button", { name: "Cancel" }))
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Delete$/ }))
})

// ---- A5: small screens (class-level only; jsdom has no layout engine) ----

it("A5: the booking confirmation stacks and scrolls instead of overflowing a phone screen", async () => {
  mocks.createBooking.mockResolvedValueOnce({ success: true, booking: booking({ date: "2030-01-02" }) })
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={option(ARTIST_ID, "DJ Moon")} />)
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: "2030-01-02" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  const dialog = screen.getByRole("dialog")
  expect(dialog.className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/)
  expect(dialog.className).toMatch(/overflow-y-auto/)
  const summary = within(dialog).getByRole("heading", { name: "Artist" }).closest(".grid") as HTMLElement
  expect(summary.className.split(" ")).toEqual(expect.arrayContaining(["grid-cols-1", "sm:grid-cols-2"]))
  const actions = within(dialog).getByRole("button", { name: "Open booking" }).parentElement as HTMLElement
  expect(actions.className.split(" ")).toContain("flex-wrap")
})

it("A5: the artist picker dialog scrolls vertically rather than clipping its content", async () => {
  render(<NewBookingModal open onOpenChange={vi.fn()} />)
  await screen.findByRole("button", { name: "Select DJ Luna" })
  const dialog = screen.getByRole("dialog")
  expect(dialog.className).toMatch(/overflow-y-auto/)
  expect(dialog.className).not.toMatch(/overflow-hidden/)
})

it("A5: the add-artist stepper, fields and footer wrap on narrow screens", () => {
  const { container } = render(<NewArtistPage />)
  const stepper = screen.getByText("General info").closest(".flex-wrap")
  expect(stepper).not.toBeNull()
  const footer = screen.getByRole("button", { name: "Continue" }).parentElement as HTMLElement
  expect(footer.className.split(" ")).toContain("flex-wrap")
  // No fixed two- or three-column field grid without a small-screen single column.
  for (const grid of container.querySelectorAll(".grid")) {
    const classes = grid.className.split(" ")
    if (classes.some((name) => /^(sm:)?grid-cols-[23]$/.test(name))) expect(classes).toContain("grid-cols-1")
  }
})

// ---- B6: distinct "view all" links ----

it("B6: View all events and View all bookings are distinct links with distinct targets", () => {
  render(<DashboardContent {...dashboardProps} eventsInProgress={[event(1)]} bookings={[booking()]} />)
  const events = screen.getByRole("link", { name: "View all events" })
  const bookings = screen.getByRole("link", { name: "View all bookings" })
  expect(events.getAttribute("href")).toBe("/dashboard/events")
  expect(bookings.getAttribute("href")).toBe("/dashboard/bookings")
  expect(screen.queryByRole("link", { name: "View all" })).toBeNull()
  // Touch target height for both links (WCAG 2.5.8 minimum is 24px; min-h-10 is 40px).
  for (const link of [events, bookings]) expect(link.className.split(" ")).toContain("min-h-10")
})

// ---- B7: the six-event preview says what it is ----

it("B7: with more than six events in progress the dashboard shows six and says how many exist", () => {
  const eight = Array.from({ length: 8 }, (_, index) => event(index + 1))
  render(<DashboardContent {...dashboardProps} eventsInProgress={eight} />)
  const section = screen.getByRole("region", { name: "Events in progress" })
  expect(DASHBOARD_EVENTS_LIMIT).toBe(6)
  const list = within(section).getByRole("list", { description: /Showing the next 6 of 8 events in progress\./ })
  expect(within(list).getAllByRole("listitem")).toHaveLength(6)
  expect(within(section).getByText(/Confirmed events and other commitments are not listed here\./)).toBeTruthy()
  expect(within(section).queryByText("Synthetic event 7")).toBeNull()
})

it("B7: with six or fewer events the dashboard still states the six-event limit", () => {
  render(<DashboardContent {...dashboardProps} eventsInProgress={[event(1), event(2)]} />)
  const section = screen.getByRole("region", { name: "Events in progress" })
  expect(within(section).getByRole("list", { description: /Shows at most 6 events in progress, soonest first\./ })).toBeTruthy()
  expect(within(section).getAllByRole("listitem")).toHaveLength(2)
})

// ---- B8: same-day order, times and shows past midnight ----

it("B8: dashboard bookings on the same day are ordered by start time and show their time", () => {
  render(<DashboardContent {...dashboardProps} bookings={[
    booking({ id: "late", date: "2030-01-02", start_time: "23:00:00", duration_minutes: 150, stage: "Late Set" }),
    booking({ id: "early", date: "2030-01-02", start_time: "18:00:00", duration_minutes: 60, stage: "Early Set" }),
    booking({ id: "before", date: "2030-01-01", start_time: "22:00:00", stage: "Day Before" }),
  ]} />)
  const section = screen.getByRole("region", { name: "Bookings in progress" })
  const order = within(section).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)
  expect(order).toEqual(["Day Before", "Early Set", "Late Set"])
  expect(within(section).getByText("18:00–19:00", { exact: true })).toBeTruthy()
  expect(within(section).getByText("22:00", { exact: true })).toBeTruthy()
})

it("B8: a show that ends after midnight says next day", () => {
  render(<DashboardContent {...dashboardProps} bookings={[
    booking({ id: "late", date: "2030-01-02", start_time: "23:00:00", duration_minutes: 150, stage: "Late Set" }),
  ]} />)
  expect(screen.getByText("23:00–01:30 (next day)", { exact: true })).toBeTruthy()
})

it("B8: the artist agenda lists same-day items by time, untimed events last, with next-day end times", () => {
  const artist = { id: ARTIST_ID, name: "Luna", stage_name: "DJ Moon" } as Artist
  const events = [{
    id: "event-same-day", title: "Synthetic festival", date: "2030-01-02", location: "Synthetic city",
    status: "in_progress", artist_id: ARTIST_ID,
  }] as unknown as EventWithRelations[]
  render(<ArtistProfileClient artist={artist} calendarToday="2030-01-01" events={events} bookings={[
    booking({ id: "b-late", date: "2030-01-02", start_time: "23:30:00", duration_minutes: 120 }),
    booking({ id: "a-early", date: "2030-01-02", start_time: "19:00:00", duration_minutes: 90 }),
  ]} />)
  const agenda = screen.getByRole("tabpanel", { name: "Calendar" })
  const links = within(agenda).getAllByRole("link").filter((link) => /\/dashboard\/(bookings|events)\//.test(link.getAttribute("href") ?? ""))
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/dashboard/bookings/a-early",
    "/dashboard/bookings/b-late",
    "/dashboard/events/event-same-day",
  ])
  expect(within(agenda).getByText("19:00–20:30", { exact: true })).toBeTruthy()
  expect(within(agenda).getByText("23:30–01:30 (next day)", { exact: true })).toBeTruthy()
})
