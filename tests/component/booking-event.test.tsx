// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  updateBooking: vi.fn(), updateBookingStatus: vi.fn(), deleteBooking: vi.fn(), getBooking: vi.fn(), getBookings: vi.fn(), createBooking: vi.fn(),
  createEventFromBooking: vi.fn(), getBookingEventLink: vi.fn(),
  getEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), listPromoters: vi.fn(), getArtists: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), back: vi.fn() },
}))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => mocks.router,
}))
vi.mock("@/lib/actions/bookings", () => ({
  updateBooking: mocks.updateBooking, updateBookingStatus: mocks.updateBookingStatus, deleteBooking: mocks.deleteBooking,
  getBooking: mocks.getBooking, getBookings: mocks.getBookings, createBooking: mocks.createBooking,
}))
vi.mock("@/lib/actions/booking-events", () => ({
  createEventFromBooking: mocks.createEventFromBooking, getBookingEventLink: mocks.getBookingEventLink,
}))
vi.mock("@/lib/actions/events", () => ({
  getEvent: mocks.getEvent, updateEvent: mocks.updateEvent, deleteEvent: mocks.deleteEvent, listPromoters: mocks.listPromoters,
}))
vi.mock("@/lib/actions/artists", () => ({ getArtists: mocks.getArtists }))
vi.mock("@/lib/calendar-day", () => ({ configuredCalendarDay: () => "2026-11-23" }))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import { BookingEventLink } from "@/app/dashboard/bookings/[id]/booking-event-link"
import BookingPage from "@/app/dashboard/bookings/[id]/page"
import EventPage from "@/app/dashboard/events/[id]/page"
import { NewBookingModal } from "@/components/dashboard/new-booking-modal"
import type { BookingWithArtist } from "@/lib/actions/bookings"
import type { Artist } from "@/lib/actions/artists"
import { BOOKING_STATUSES } from "@/lib/booking-status"
import { BOOKING_HAS_PAYMENTS_MESSAGE, type BookingPayment } from "@/lib/booking-finance"

const BOOKING = "11111111-1111-4111-8111-111111111111"
const EVENT = "44444444-4444-4444-8444-444444444444"
const P1 = "33333333-3333-4333-8333-333333333331"
const P2 = "33333333-3333-4333-8333-333333333332"
const promoters = [
  { id: P1, name: "Marta Rossi", company_name: "Nightwave Srl" },
  { id: P2, name: "Paolo Bianchi", company_name: null },
]
const booking: BookingWithArtist = {
  fee_amount_minor: 150000, fee_currency: "EUR", hold_expires_on: null, promoter_id: null,
  id: BOOKING, workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-12-12", start_time: "21:30:00",
  venue_name: "Club Synthetic", venue_address: null, contact_name_main: "Typed Contact", contact_phone_main: null, contact_email_main: null,
  duration_minutes: 60, notes: null, status: "confirmed", created_at: "2026-01-02", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: "EUR", profile_image_url: null },
}
const eventSection = () => within(screen.getByRole("region", { name: "Event" }))
const link = (overrides: Partial<React.ComponentProps<typeof BookingEventLink>> = {}) =>
  <BookingEventLink bookingId={BOOKING} status="confirmed" linkedEvent={null} {...overrides} />

beforeEach(() => {
  for (const mock of Object.values(mocks)) if ("mockReset" in mock) mock.mockReset()
  for (const mock of Object.values(mocks.router)) mock.mockReset()
  mocks.updateBooking.mockResolvedValue({ success: true })
  mocks.listPromoters.mockResolvedValue(promoters)
  mocks.getBookings.mockResolvedValue([])
  mocks.getBooking.mockResolvedValue(booking)
  mocks.getBookingEventLink.mockResolvedValue(null)
  mocks.getArtists.mockResolvedValue([{ id: "artist-a", name: "Luna", stage_name: "DJ Moon" }])
})
afterEach(cleanup)

// --- "Create event" control -------------------------------------------------------------

it.each(["confirmed", "completed"] as const)("offers Create event for a %s booking, creates it once and links to the new event", async (status) => {
  mocks.createEventFromBooking.mockResolvedValue({ success: true, eventId: EVENT, existing: false })
  render(link({ status }))
  const button = screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  expect(eventSection().getByText(/The booking status does not change/)).toBeTruthy()
  await act(async () => { fireEvent.click(button) })
  expect(mocks.createEventFromBooking).toHaveBeenCalledExactlyOnceWith(BOOKING)
  expect(eventSection().getByRole("status").textContent).toContain("Event created.")
  expect(eventSection().getByRole("link", { name: "Open event" }).getAttribute("href")).toBe(`/dashboard/events/${EVENT}`)
  expect(screen.queryByRole("button", { name: "Create event" })).toBeNull()
  expect(mocks.router.refresh).toHaveBeenCalledOnce()
  expect(mocks.updateBookingStatus).not.toHaveBeenCalled()
  expect(mocks.updateBooking).not.toHaveBeenCalled()
})

it.each(BOOKING_STATUSES.filter(status => status !== "confirmed" && status !== "completed"))(
  "keeps Create event disabled for a %s booking and says when it becomes available", (status) => {
    render(link({ status }))
    const button = screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(eventSection().getByText("Available when the booking is confirmed or completed.")).toBeTruthy()
    fireEvent.click(button)
    expect(mocks.createEventFromBooking).not.toHaveBeenCalled()
  })

it("shows the existing event instead of the button when the booking is already converted", () => {
  render(link({ linkedEvent: { id: EVENT, title: "DJ Moon @ Club Synthetic" } }))
  expect(screen.queryByRole("button", { name: "Create event" })).toBeNull()
  expect(eventSection().getByRole("link", { name: "DJ Moon @ Club Synthetic" }).getAttribute("href")).toBe(`/dashboard/events/${EVENT}`)
})

it("a retry (double click, lost response) opens the event already linked, never an error", async () => {
  mocks.createEventFromBooking.mockResolvedValue({ success: true, eventId: EVENT, existing: true })
  render(link())
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create event" })) })
  expect(eventSection().queryByRole("alert")).toBeNull()
  expect(eventSection().getByRole("status").textContent).toBe("This booking already has an event. Open event")
  expect(eventSection().getByRole("link", { name: "Open event" }).getAttribute("href")).toBe(`/dashboard/events/${EVENT}`)
  expect(screen.queryByText(/already exists/)).toBeNull()
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1)
})

it("a double click sends one request", async () => {
  let resolve!: (value: unknown) => void
  mocks.createEventFromBooking.mockReturnValue(new Promise(r => { resolve = r }))
  render(link())
  const button = screen.getByRole("button", { name: "Create event" })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(mocks.createEventFromBooking).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ success: true, eventId: EVENT, existing: false }) })
  expect(eventSection().getByRole("link", { name: "Open event" })).toBeTruthy()
})

it("shows a server refusal without a link, and allows a retry", async () => {
  mocks.createEventFromBooking.mockResolvedValueOnce({ success: false, error: "Unable to create the event. Please try again." })
  mocks.createEventFromBooking.mockResolvedValueOnce({ success: true, eventId: EVENT, existing: false })
  render(link())
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create event" })) })
  expect(eventSection().getByRole("alert").textContent).toBe("Unable to create the event. Please try again.")
  expect(eventSection().queryByRole("link")).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create event" })) })
  expect(eventSection().queryByRole("alert")).toBeNull()
  expect(eventSection().getByRole("link", { name: "Open event" })).toBeTruthy()
})

it("does not claim a result when the request throws, and never shows the thrown detail", async () => {
  mocks.createEventFromBooking.mockRejectedValue(new Error("PRIVATE_NETWORK_DETAIL"))
  render(link())
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create event" })) })
  expect(eventSection().getByRole("alert").textContent).toBe("Unable to confirm whether the event was created. Reload the booking before retrying.")
  expect(screen.queryByText(/PRIVATE_NETWORK_DETAIL/)).toBeNull()
  expect(mocks.router.refresh).not.toHaveBeenCalled()
})

it("ignores duplicate clicks while the event is being created", async () => {
  let settle!: (value: { success: true; eventId: string }) => void
  mocks.createEventFromBooking.mockReturnValueOnce(new Promise(resolve => { settle = resolve }))
  render(link())
  fireEvent.click(screen.getByRole("button", { name: "Create event" }))
  const pending = await screen.findByRole("button", { name: "Creating event..." })
  expect(pending.getAttribute("aria-disabled")).toBe("true")
  fireEvent.click(pending)
  fireEvent.click(pending)
  expect(mocks.createEventFromBooking).toHaveBeenCalledOnce()
  await act(async () => settle({ success: true, eventId: EVENT }))
  expect(eventSection().getByRole("link", { name: "Open event" })).toBeTruthy()
})

it("does not offer creation when the linked event could not be checked", () => {
  render(link({ linkedEvent: "unavailable" }))
  expect(eventSection().getByRole("alert").textContent).toContain("could not be checked")
  expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(true)
})

// --- Booking editor and page ---------------------------------------------------------------

it("booking page passes the linked event and promoter options to the editor", async () => {
  mocks.getBooking.mockResolvedValue({ ...booking, promoter_id: P1 })
  mocks.getBookingEventLink.mockResolvedValue({ id: EVENT, title: "DJ Moon @ Club Synthetic" })
  render(await BookingPage({ params: Promise.resolve({ id: BOOKING }) }))
  expect(mocks.getBookingEventLink).toHaveBeenCalledWith(BOOKING)
  expect(eventSection().getByRole("link", { name: "DJ Moon @ Club Synthetic" }).getAttribute("href")).toBe(`/dashboard/events/${EVENT}`)
  expect((screen.getByLabelText("Promoter") as HTMLSelectElement).value).toBe(P1)
  expect(screen.queryByRole("button", { name: "Complete and create event" })).toBeNull()
})

it("booking page reports failed side reads honestly instead of showing 'no event' or 'no promoters'", async () => {
  mocks.getBookingEventLink.mockRejectedValue(new Error("private database detail"))
  mocks.listPromoters.mockRejectedValue(new Error("private database detail"))
  render(await BookingPage({ params: Promise.resolve({ id: BOOKING }) }))
  expect(eventSection().getByRole("alert").textContent).toContain("could not be checked")
  expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText("Promoter") as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByText(/Promoters could not be loaded/)).toBeTruthy()
  expect(screen.queryByText("private database detail")).toBeNull()
})

it("editor without the new props renders neither the event section nor the promoter selector", () => {
  render(<EventBookingClient booking={booking} />)
  expect(screen.queryByRole("region", { name: "Event" })).toBeNull()
  expect(screen.queryByLabelText("Promoter")).toBeNull()
})

it("editor saves the promoter only when it changed, and leaves the typed main contact alone", async () => {
  render(<EventBookingClient booking={booking} promoters={promoters} linkedEvent={null} today="2026-11-23" />)
  const select = screen.getByLabelText("Promoter") as HTMLSelectElement
  expect(Array.from(select.options).map(option => option.textContent)).toEqual(["No promoter", "Marta Rossi (Nightwave Srl)", "Paolo Bianchi"])
  expect(select.value).toBe("")
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  expect(mocks.updateBooking.mock.calls[0][1]).not.toHaveProperty("promoter_id")
  fireEvent.change(select, { target: { value: P2 } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  // Changed-only save (#40): the unchanged main contact is not resent, the new promoter is.
  expect(mocks.updateBooking.mock.calls[1][1]).toStrictEqual({ promoter_id: P2 })
  expect((screen.getByLabelText("Contact name (main)") as HTMLInputElement).value).toBe("Typed Contact")
})

it("editor clears a stored promoter with null and shows a server refusal", async () => {
  mocks.updateBooking.mockResolvedValueOnce({ success: false, error: "The selected promoter no longer exists. Choose another promoter." })
  render(<EventBookingClient booking={{ ...booking, promoter_id: P1 }} promoters={promoters} linkedEvent={null} today="2026-11-23" />)
  const select = screen.getByLabelText("Promoter") as HTMLSelectElement
  expect(select.value).toBe(P1)
  fireEvent.change(select, { target: { value: "" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  expect(mocks.updateBooking.mock.calls[0][1]).toMatchObject({ promoter_id: null })
  expect(screen.getByText("The selected promoter no longer exists. Choose another promoter.")).toBeTruthy()
})

it("editor keeps a stored promoter that is missing from the options selected and unchanged", async () => {
  render(<EventBookingClient booking={{ ...booking, promoter_id: P1 }} promoters={[promoters[1]]} linkedEvent={null} today="2026-11-23" />)
  const select = screen.getByLabelText("Promoter") as HTMLSelectElement
  expect(select.value).toBe(P1)
  expect(select.selectedOptions[0].textContent).toBe("Current promoter")
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  expect(mocks.updateBooking.mock.calls[0][1]).not.toHaveProperty("promoter_id")
})

// --- Create modal --------------------------------------------------------------------------

const artist = { id: "22222222-2222-4222-8222-222222222222", stage_name: "DJ Moon", name: "Luna", base_rate: null } as Artist
it("create modal offers the optional promoter and sends it only when chosen", async () => {
  mocks.createBooking.mockResolvedValue({ success: false, error: "stop here" })
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={artist} />)
  const select = await screen.findByLabelText("Promoter") as HTMLSelectElement
  await waitFor(() => expect(select.disabled).toBe(false))
  expect(Array.from(select.options).map(option => option.textContent)).toEqual(["No promoter", "Marta Rossi (Nightwave Srl)", "Paolo Bianchi"])
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: "2030-01-02" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  expect(mocks.createBooking.mock.calls[0][0]).not.toHaveProperty("promoterId")
  fireEvent.change(select, { target: { value: P1 } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  expect(mocks.createBooking.mock.calls[1][0]).toMatchObject({ artistId: artist.id, date: "2030-01-02", promoterId: P1 })
})

it("create modal still saves without a promoter when the directory cannot be loaded", async () => {
  mocks.listPromoters.mockRejectedValue(new Error("private database detail"))
  mocks.createBooking.mockResolvedValue({ success: false, error: "stop here" })
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={artist} />)
  expect(await screen.findByText(/Promoters could not be loaded/)).toBeTruthy()
  expect((screen.getByLabelText("Promoter") as HTMLSelectElement).disabled).toBe(true)
  expect(screen.queryByText("private database detail")).toBeNull()
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: "2030-01-02" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  expect(mocks.createBooking).toHaveBeenCalledOnce()
  expect(mocks.createBooking.mock.calls[0][0]).not.toHaveProperty("promoterId")
})

it("create modal says so when the directory is empty", async () => {
  mocks.listPromoters.mockResolvedValue([])
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={artist} />)
  expect(await screen.findByText("No promoters in the directory yet. Optional.")).toBeTruthy()
})

// --- Event page: new fields and link back to the booking -------------------------------------

const stored = {
  id: EVENT, title: "DJ Moon @ Club Synthetic", date: "2026-12-12", location: "Club Synthetic", status: "confirmed",
  artist_id: "artist-a", promoter_id: P1, booking_id: BOOKING, start_time: "21:30:00", fee_amount_minor: 150000, fee_currency: "EUR",
}
const openEvent = () => EventPage({ params: Promise.resolve({ id: EVENT }) })

it("event page shows the start time, the fee snapshot and a link back to the booking", async () => {
  mocks.getEvent.mockResolvedValue(stored)
  render(await openEvent())
  expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("21:30")
  expect((screen.getByLabelText("Fee amount") as HTMLInputElement).value).toBe("1500.00")
  expect((screen.getByLabelText("Fee currency") as HTMLSelectElement).value).toBe("EUR")
  expect(screen.getByRole("link", { name: "Open booking" }).getAttribute("href")).toBe(`/dashboard/bookings/${BOOKING}`)
  expect(screen.getByText(/Editing it here does not change the booking/)).toBeTruthy()
})

it("event page shows no booking link and empty fields for an event created directly", async () => {
  mocks.getEvent.mockResolvedValue({ ...stored, booking_id: null, start_time: null, fee_amount_minor: null, fee_currency: null })
  render(await openEvent())
  expect(screen.queryByRole("link", { name: "Open booking" })).toBeNull()
  expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("")
  expect((screen.getByLabelText("Fee amount") as HTMLInputElement).value).toBe("")
  expect((screen.getByLabelText("Fee currency") as HTMLSelectElement).value).toBe("")
})

it("event page sends start time and fee only when edited", async () => {
  mocks.getEvent.mockResolvedValue(stored)
  mocks.updateEvent.mockResolvedValue({ success: true })
  render(await openEvent())
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalledTimes(1))
  const untouched = mocks.updateEvent.mock.calls[0][1]
  for (const field of ["start_time", "fee_amount_minor", "fee_currency", "booking_id"]) expect(untouched).not.toHaveProperty(field)
})

it("event page saves an edited start time and fee in minor units, and clears them", async () => {
  mocks.getEvent.mockResolvedValue(stored)
  mocks.updateEvent.mockResolvedValue({ success: true })
  const view = render(await openEvent())
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "22:15" } })
  fireEvent.change(screen.getByLabelText("Fee amount"), { target: { value: "1800,5" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalledTimes(1))
  expect(mocks.updateEvent.mock.calls[0][1]).toMatchObject({ start_time: "22:15", fee_amount_minor: 180050, fee_currency: "EUR" })
  expect(mocks.updateEvent.mock.calls[0][1]).not.toHaveProperty("booking_id")
  view.unmount()

  render(await openEvent())
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "" } })
  fireEvent.change(screen.getByLabelText("Fee amount"), { target: { value: "" } })
  fireEvent.change(screen.getByLabelText("Fee currency"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalledTimes(2))
  expect(mocks.updateEvent.mock.calls[1][1]).toMatchObject({ start_time: null, fee_amount_minor: null, fee_currency: null })
})

it.each([
  ["1500", "", "Enter both fee amount and currency, or clear both"],
  ["", "EUR", "Enter both fee amount and currency, or clear both"],
  ["12.345", "EUR", "Enter a fee with at most two decimals and no grouping separators"],
  ["-5", "EUR", "Fee must be zero or greater"],
  ["10.5", "JPY", "Enter a whole-number JPY fee without separators"],
])("event page rejects fee %j %j before calling the server and keeps the draft", async (amount, currency, message) => {
  mocks.getEvent.mockResolvedValue({ ...stored, fee_amount_minor: null, fee_currency: null })
  render(await openEvent())
  fireEvent.change(screen.getByLabelText("Fee amount"), { target: { value: amount } })
  fireEvent.change(screen.getByLabelText("Fee currency"), { target: { value: currency } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect((await screen.findByRole("alert")).textContent).toBe(message)
  expect(mocks.updateEvent).not.toHaveBeenCalled()
  expect((screen.getByLabelText("Fee amount") as HTMLInputElement).value).toBe(amount)
})

// --- Deleting a booking that has an event (Simone, 2026-11-26) --------------------------

const HAS_EVENT = "This booking has an event, so it cannot be deleted. Cancel the booking instead; its event is cancelled with it."

it("disables Delete for a booking that has an event and says to cancel it instead", () => {
  render(<EventBookingClient booking={booking} promoters={promoters} linkedEvent={{ id: EVENT, title: "DJ Moon @ Club Synthetic" }} today="2026-11-23" />)
  const remove = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement
  expect(remove.disabled).toBe(true)
  expect(document.getElementById(remove.getAttribute("aria-describedby") ?? "")?.textContent).toBe(HAS_EVENT)
  fireEvent.click(remove)
  expect(screen.queryByText("Delete this booking?")).toBeNull()
  expect(mocks.deleteBooking).not.toHaveBeenCalled()
})

// #33 + #35 together: payment rows (007 RESTRICT FK) and a linked event (008 BB011) both block delete.
const payment: BookingPayment = {
  voided_at: null, void_kind: null, void_reason: null, replaces_payment_id: null,
  id: "pay-1", booking_id: BOOKING, kind: "deposit", amount_minor: 30000, currency: "EUR", due_on: null, paid_on: null, note: null,
}

it.each([
  ["an event and payments", { id: EVENT, title: "DJ Moon @ Club Synthetic" }, [payment], HAS_EVENT],
  ["payments only", null, [payment], BOOKING_HAS_PAYMENTS_MESSAGE],
] as const)("disables Delete for a booking with %s and names the reason", (_case, linkedEvent, payments, hint) => {
  render(<EventBookingClient booking={booking} promoters={promoters} linkedEvent={linkedEvent} payments={payments} today="2026-11-23" />)
  const remove = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement
  expect(remove.disabled).toBe(true)
  expect(document.getElementById(remove.getAttribute("aria-describedby") ?? "")?.textContent).toBe(hint)
  fireEvent.click(remove)
  expect(mocks.deleteBooking).not.toHaveBeenCalled()
})

it.each([null, "unavailable"] as const)("keeps Delete available when the linked event is %s", (linkedEvent) => {
  render(<EventBookingClient booking={booking} promoters={promoters} linkedEvent={linkedEvent} today="2026-11-23" />)
  expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByText(HAS_EVENT)).toBeNull()
})

it("shows the cancel hint and refreshes when the database refuses the delete (event linked meanwhile)", async () => {
  mocks.deleteBooking.mockResolvedValue({ success: false, error: HAS_EVENT })
  render(<EventBookingClient booking={booking} promoters={promoters} linkedEvent={null} today="2026-11-23" />)
  fireEvent.click(screen.getByRole("button", { name: "Delete" }))
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })) })
  expect(mocks.deleteBooking).toHaveBeenCalledExactlyOnceWith(BOOKING)
  expect(screen.getByRole("alert").textContent).toBe(HAS_EVENT)
  expect(screen.queryByText("Delete this booking?")).toBeNull()
  expect(mocks.router.refresh).toHaveBeenCalledOnce()
  expect(mocks.router.push).not.toHaveBeenCalled()
})
