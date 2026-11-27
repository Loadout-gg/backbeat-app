// @vitest-environment jsdom
// Owner E2E on staging, 2026-11-27: cancel confirmation, no reopen of a converted cancelled
// booking, no delete of a booking-linked event, read-only status of the event of a cancelled
// booking, and no "saved" message next to stale data.
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  updateBooking: vi.fn(), updateBookingStatus: vi.fn(), deleteBooking: vi.fn(),
  createBookingPayment: vi.fn(), updateBookingPayment: vi.fn(), voidBookingPayment: vi.fn(),
  createEventFromBooking: vi.fn(), getBookingEventLink: vi.fn(),
  getEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), listPromoters: vi.fn(), getEventBookingStatus: vi.fn(), getArtists: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), back: vi.fn() },
}))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => mocks.router,
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (listener: (event: string, session: { user: { id: string } }) => void) => {
    listener("INITIAL_SESSION", { user: { id: "member-a" } })
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  },
} }) }))
vi.mock("@/lib/actions/bookings", () => ({
  updateBooking: mocks.updateBooking, updateBookingStatus: mocks.updateBookingStatus, deleteBooking: mocks.deleteBooking,
}))
vi.mock("@/lib/actions/booking-payments", () => ({
  createBookingPayment: mocks.createBookingPayment, updateBookingPayment: mocks.updateBookingPayment, voidBookingPayment: mocks.voidBookingPayment,
}))
vi.mock("@/lib/actions/booking-events", () => ({
  createEventFromBooking: mocks.createEventFromBooking, getBookingEventLink: mocks.getBookingEventLink,
}))
vi.mock("@/lib/actions/events", () => ({
  getEvent: mocks.getEvent, updateEvent: mocks.updateEvent, deleteEvent: mocks.deleteEvent,
  listPromoters: mocks.listPromoters, getEventBookingStatus: mocks.getEventBookingStatus,
}))
vi.mock("@/lib/actions/artists", () => ({ getArtists: mocks.getArtists }))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import EventPage from "@/app/dashboard/events/[id]/page"
import type { BookingWithArtist } from "@/lib/actions/bookings"
import type { BookingPayment } from "@/lib/booking-finance"

const TODAY = "2026-11-23"
const BOOKING = "11111111-1111-4111-8111-111111111111"
const EVENT = "44444444-4444-4444-8444-444444444444"
const linkedEvent = { id: EVENT, title: "DJ Moon @ Club Synthetic" }
const booking: BookingWithArtist = {
  fee_amount_minor: 100000, fee_currency: "EUR", hold_expires_on: null, promoter_id: null,
  commission_type: null, commission_value: null, commission_mode: null, tax_note: null,
  id: BOOKING, workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-12-12", start_time: "21:30:00",
  venue_name: "Club Synthetic", venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
  duration_minutes: 60, notes: null, status: "confirmed", created_at: "2026-01-02", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: "EUR", profile_image_url: null },
}
const statusSection = () => within(screen.getByRole("region", { name: "Status" }))
const editor = (overrides: Partial<BookingWithArtist> = {}, props: Partial<React.ComponentProps<typeof EventBookingClient>> = {}) =>
  <EventBookingClient booking={{ ...booking, ...overrides }} today={TODAY} linkedEvent={null} {...props} />

// router.refresh() as a transition that stays pending until the test releases it: the
// refreshed server copy "arrives" only on release, as on staging (~3 s).
const gate: { set: ((promise: Promise<void> | null) => void) | null } = { set: null }
function Waiter({ promise }: { promise: Promise<void> }) { React.use(promise); return null }
function Harness({ children }: { children: React.ReactNode }) {
  const [promise, setPromise] = React.useState<Promise<void> | null>(null)
  React.useLayoutEffect(() => { gate.set = setPromise }, [])
  return <>{children}<React.Suspense fallback={null}>{promise && <Waiter promise={promise} />}</React.Suspense></>
}
function holdRefresh() {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  mocks.router.refresh.mockImplementation(() => gate.set?.(pending))
  return async () => { await act(async () => { release(); await pending }) }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) if ("mockReset" in mock) mock.mockReset()
  for (const mock of Object.values(mocks.router)) mock.mockReset()
  mocks.updateBooking.mockResolvedValue({ success: true })
  mocks.updateBookingStatus.mockResolvedValue({ success: true })
  mocks.getArtists.mockResolvedValue([{ id: "artist-a", name: "Luna", stage_name: "DJ Moon" }])
  mocks.listPromoters.mockResolvedValue([])
})
afterEach(cleanup)

// --- 1. Cancel booking asks first -------------------------------------------------------

it("Cancel booking opens an in-app confirmation and changes nothing until confirmed", async () => {
  render(editor({}, { linkedEvent }))
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel booking" })) })
  const dialog = screen.getByRole("alertdialog", { name: "Cancel this booking?" })
  expect(mocks.updateBookingStatus).not.toHaveBeenCalled()
  const copy = within(dialog).getByText(/cannot be undone/).textContent ?? ""
  expect(copy).toContain("The event created from this booking is cancelled with it")
  expect(copy).toContain("the booking cannot be reopened")
  expect(copy).toContain("Recorded payments are kept; void them separately if needed.")
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Yes, cancel booking" })) })
  expect(mocks.updateBookingStatus).toHaveBeenCalledExactlyOnceWith(BOOKING, "cancelled", "confirmed")
  expect(screen.queryByRole("alertdialog")).toBeNull()
})

it("Keep booking closes the confirmation without any request", async () => {
  render(editor({}, { linkedEvent }))
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel booking" })) })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Keep booking" })) })
  expect(screen.queryByRole("alertdialog")).toBeNull()
  expect(mocks.updateBookingStatus).not.toHaveBeenCalled()
})

it.each([
  [null, "It has no event, so it can be reopened as in progress later."],
  ["unavailable", "The event of this booking could not be checked."],
] as const)("the confirmation copy for linkedEvent=%s does not claim more than is known", async (linked, expected) => {
  render(editor({}, { linkedEvent: linked }))
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel booking" })) })
  const dialog = screen.getByRole("alertdialog", { name: "Cancel this booking?" })
  expect(dialog.textContent).toContain(expected)
  expect(dialog.textContent).toContain("Recorded payments are kept")
  if (linked === null) expect(dialog.textContent).not.toContain("cannot be undone")
})

it("no native dialog is used", async () => {
  const confirm = vi.spyOn(window, "confirm")
  const alert = vi.spyOn(window, "alert")
  render(editor({}, { linkedEvent }))
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel booking" })) })
  expect(confirm).not.toHaveBeenCalled()
  expect(alert).not.toHaveBeenCalled()
})

// --- 2. A cancelled converted booking is never reopened ---------------------------------

it("a cancelled booking with an event offers no reopen and points to a new booking", () => {
  render(editor({ status: "cancelled" }, { linkedEvent }))
  expect(screen.queryByRole("button", { name: "Reopen as in progress" })).toBeNull()
  expect(statusSection().getByText(/Rebook with a new booking\./)).toBeTruthy()
  const cta = statusSection().getByRole("link", { name: "Open DJ Moon to create a new booking" })
  expect(cta.getAttribute("href")).toBe("/dashboard/artists/artist-a")
  expect(statusSection().queryByText("No status change is available right now.")).toBeNull()
})

it.each([null, "unavailable"] as const)("a cancelled booking with linkedEvent=%s still offers reopen (the database decides)", (linked) => {
  render(editor({ status: "cancelled" }, { linkedEvent: linked }))
  expect(screen.getByRole("button", { name: "Reopen as in progress" })).toBeTruthy()
  expect(screen.queryByText(/Rebook with a new booking/)).toBeNull()
})

// --- 5. No "saved" next to stale data ---------------------------------------------------

it("Update booking reports saved only once the refreshed page is rendered", async () => {
  const release = holdRefresh()
  render(<Harness>{editor()}</Harness>)
  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "2026-12-13" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  expect(mocks.router.refresh).toHaveBeenCalledOnce()
  expect(screen.queryByText("Booking saved.")).toBeNull()
  const button = screen.getByRole("button", { name: "Saving..." })
  expect(button.getAttribute("aria-disabled")).toBe("true")
  await act(async () => { fireEvent.click(button) })
  expect(mocks.updateBooking).toHaveBeenCalledOnce()
  await release()
  expect(screen.getByText("Booking saved.")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Update booking" }).getAttribute("aria-disabled")).toBe("false")
})

it("a status change reports its notice only once the refreshed page is rendered", async () => {
  const release = holdRefresh()
  render(<Harness>{editor({ status: "in_progress" })}</Harness>)
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm booking" })) })
  expect(statusSection().queryByText("Status changed to confirmed.")).toBeNull()
  expect(statusSection().getByRole("status").textContent).toBe("Updating the page...")
  await release()
  expect(statusSection().getByRole("status").textContent).toBe("Status changed to confirmed.")
})

it("a recorded payment is confirmed only once the refreshed totals are rendered", async () => {
  const release = holdRefresh()
  mocks.createBookingPayment.mockResolvedValue({ success: true })
  const payments: BookingPayment[] = []
  render(<Harness>{editor({}, { draftOwnerId: "member-a", payments })}</Harness>)
  const tab = screen.getByRole("tab", { name: "Financial" })
  tab.focus()
  fireEvent.keyDown(screen.getByRole("tab", { name: "Performance" }), { key: "ArrowRight" })
  await waitFor(() => expect(screen.getByRole("tab", { name: "Financial", selected: true })).toBeTruthy())
  const panel = within(screen.getByRole("tabpanel", { name: "Financial" }))
  await act(async () => { fireEvent.click(panel.getByRole("button", { name: "Add payment" })) })
  fireEvent.change(panel.getByLabelText("Payment amount (EUR)"), { target: { value: "300" } })
  await act(async () => { fireEvent.click(panel.getByRole("button", { name: "Save new payment" })) })
  expect(mocks.createBookingPayment).toHaveBeenCalledOnce()
  const notice = () => within(screen.getByRole("region", { name: "Payments" })).getByRole("status").textContent
  expect(notice()).toBe("Updating payments and totals...")
  // Nothing can be edited against the stale totals meanwhile.
  expect(panel.getByRole("button", { name: "Add payment" }).getAttribute("aria-disabled")).toBe("true")
  await release()
  expect(notice()).toBe("Payment added.")
})

// --- 3 and 4. Event page ----------------------------------------------------------------

const event = {
  id: EVENT, title: "DJ Moon @ Club Synthetic", date: "2026-12-12", location: "Club Synthetic", status: "cancelled",
  artist_id: "artist-a", promoter_id: null, booking_id: BOOKING, start_time: "21:30:00", fee_amount_minor: 100000, fee_currency: "EUR",
}
const openEvent = () => EventPage({ params: Promise.resolve({ id: EVENT }) })

it("an event created from a booking offers no delete and says to cancel the booking instead", async () => {
  mocks.getEvent.mockResolvedValue({ ...event, status: "confirmed" })
  mocks.getEventBookingStatus.mockResolvedValue("confirmed")
  render(await openEvent())
  expect(screen.queryByRole("button", { name: "Delete event" })).toBeNull()
  expect(screen.getByText("Created from a booking: cancel the booking instead. The event is cancelled with it and kept as history.")).toBeTruthy()
  expect(screen.getByRole("link", { name: "Open the booking to cancel it" }).getAttribute("href")).toBe(`/dashboard/bookings/${BOOKING}`)
  expect(mocks.deleteEvent).not.toHaveBeenCalled()
})

it("an event created directly still offers delete", async () => {
  mocks.getEvent.mockResolvedValue({ ...event, status: "confirmed", booking_id: null })
  render(await openEvent())
  expect(screen.getByRole("button", { name: "Delete event" })).toBeTruthy()
  expect(mocks.getEventBookingStatus).not.toHaveBeenCalled()
})

it("the event of a cancelled booking shows its status read-only with the reason", async () => {
  mocks.getEvent.mockResolvedValue(event)
  mocks.getEventBookingStatus.mockResolvedValue("cancelled")
  render(await openEvent())
  expect(mocks.getEventBookingStatus).toHaveBeenCalledWith(BOOKING)
  const status = screen.getByRole("combobox", { name: "Status" }) as HTMLButtonElement
  expect(status.disabled).toBe(true)
  expect(status.textContent).toBe("Cancelled")
  const help = document.getElementById(status.getAttribute("aria-describedby") ?? "")
  expect(help?.textContent).toBe("This event was cancelled with its booking, so its status cannot change. Create a new booking to rebook.")
  mocks.updateEvent.mockResolvedValue({ success: true })
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Club Two" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })) })
  expect(mocks.updateEvent.mock.calls[0][1]).toMatchObject({ status: "cancelled", location: "Club Two" })
})

it.each([["confirmed"], ["unavailable"]] as const)("the event status stays editable when the booking is %s", async (bookingStatus) => {
  mocks.getEvent.mockResolvedValue({ ...event, status: "confirmed" })
  if (bookingStatus === "unavailable") mocks.getEventBookingStatus.mockRejectedValue(new Error("PRIVATE"))
  else mocks.getEventBookingStatus.mockResolvedValue(bookingStatus)
  render(await openEvent())
  expect((screen.getByRole("combobox", { name: "Status" }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByText(/so its status cannot change/)).toBeNull()
})

it("a database refusal (BB010) is shown next to Save, the page stays and nothing is claimed saved", async () => {
  mocks.getEvent.mockResolvedValue(event)
  mocks.getEventBookingStatus.mockRejectedValue(new Error("PRIVATE"))
  mocks.updateEvent.mockResolvedValue({ success: false, error: "This event was cancelled with its booking and cannot be reopened. Create a new booking to rebook." })
  render(await openEvent())
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })) })
  const alert = screen.getByRole("alert")
  expect(alert.textContent).toBe("This event was cancelled with its booking and cannot be reopened. Create a new booking to rebook.")
  // Rendered right before the Save row, not at the top of the form.
  expect(alert.nextElementSibling?.contains(screen.getByRole("button", { name: "Save changes" }))).toBe(true)
  expect(mocks.router.push).not.toHaveBeenCalled()
})
