// @vitest-environment jsdom
// UX2 items 4-9: what a status change and a form save each apply to, draft-date labelling,
// the post-status Bookings filter, lifecycle copy, unconfirmed saves and changed-fields-only saves.
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
const mocks = vi.hoisted(() => ({
  updateBooking: vi.fn(), updateBookingStatus: vi.fn(), deleteBooking: vi.fn(), refresh: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), back: vi.fn() }) }))
vi.mock("@/lib/actions/bookings", () => ({
  updateBooking: mocks.updateBooking, updateBookingStatus: mocks.updateBookingStatus, deleteBooking: mocks.deleteBooking,
}))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import type { BookingWithArtist } from "@/lib/actions/bookings"

const TODAY = "2026-11-23"
const base: BookingWithArtist = {
  fee_amount_minor: null, fee_currency: null, hold_expires_on: null,
  id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-12-12", start_time: "19:00:00",
  venue_name: "Old Hall", venue_address: "1 Main St", contact_name_main: "Alex", contact_phone_main: "+39 1", contact_email_main: "alex@backbeat.test",
  duration_minutes: 60, notes: "Load-in 17:00", status: "in_progress", created_at: "2026-01-02", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: "EUR", profile_image_url: null },
}
const statusSection = () => within(screen.getByRole("region", { name: "Status" }))

beforeEach(() => {
  mocks.updateBooking.mockReset().mockResolvedValue({ success: true })
  mocks.updateBookingStatus.mockReset().mockResolvedValue({ success: true })
  mocks.refresh.mockReset()
})
afterEach(cleanup)

// Item 4
it("states next to the status controls that a status change applies now to the saved date, edits need Update booking", () => {
  render(<EventBookingClient booking={base} today={TODAY} />)
  const scope = statusSection().getByText(/Status changes apply immediately/)
  expect(scope.textContent).toContain("to the saved booking on 12 Dec 2026")
  expect(scope.textContent).toContain("saved only with Update booking")
  expect(statusSection().getByRole("group", { name: "Change status" })).toBeTruthy()
})

// Item 5
it("labels which date status, hold priority and the same-day notice refer to while the date draft is unsaved", () => {
  render(<EventBookingClient
    booking={{ ...base, status: "hold" }}
    today={TODAY}
    holdPosition={{ rank: 1, total: 2 }}
    sameDayBookingCounts={{ "2026-12-12": 1, "2026-12-20": 1 }}
  />)
  // Saved date: no draft label, notice is plain.
  expect(screen.queryByText(/changed but not saved/)).toBeNull()
  expect(screen.queryByText(/not saved yet/)).toBeNull()
  expect(screen.getByText("This artist already has another booking on this date.")).toBeTruthy()

  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "2026-12-20" } })
  expect(statusSection().getByText(/changed but not saved/).textContent).toMatch(
    /Status, hold priority and\s+hold expiry still refer to the saved date, 12 Dec 2026\./,
  )
  expect(statusSection().getByText("Hold priority 1 of 2")).toBeTruthy()
  const notice = document.getElementById("booking-same-day")!
  expect(notice.textContent).toBe("For the new date 20 Dec 2026 (not saved yet): This artist already has another booking on this date.")

  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "2026-12-12" } })
  expect(screen.queryByText(/changed but not saved|not saved yet/)).toBeNull()
})

// Item 6
it.each([
  ["in_progress", "Confirm booking", "confirmed", "View confirmed bookings"],
  ["in_progress", "Place on hold", "hold", "View hold bookings"],
  ["confirmed", "Cancel booking", "cancelled", "View cancelled bookings"],
] as const)("after %s -> %s offers the Bookings filter where the record now is", async (status, label, target, link) => {
  render(<EventBookingClient booking={{ ...base, status }} today={TODAY} />)
  expect(statusSection().queryByRole("link")).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })) })
  // "Cancel booking" asks first (in-app dialog); every other transition applies at once.
  if (label === "Cancel booking") await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, cancel booking" })) })
  expect(statusSection().getByRole("link", { name: link }).getAttribute("href")).toBe(`/dashboard/bookings?status=${target}`)
})
it("offers no filter link when the status change fails", async () => {
  mocks.updateBookingStatus.mockResolvedValueOnce({ success: false, error: "This status change is not allowed." })
  render(<EventBookingClient booking={base} today={TODAY} />)
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm booking" })) })
  expect(statusSection().getByRole("alert")).toBeTruthy()
  expect(statusSection().queryByRole("link")).toBeNull()
})

// Item 7
it("does not present an expiry as automatic cancellation", () => {
  render(<EventBookingClient booking={{ ...base, status: "hold", hold_expires_on: "2026-11-20" }} today={TODAY} />)
  expect(statusSection().getByText("Hold expired")).toBeTruthy()
  expect(statusSection().getByText(/The booking stays on hold until you change its status; nothing was cancelled\./)).toBeTruthy()
  expect(screen.getByText(/it is not cancelled or changed automatically/)).toBeTruthy()
})
it.each([
  ["confirmed", "2026-11-01"],
  ["completed", "2026-11-01"],
] as const)("says Completed means the show took place, not a payment (%s)", (status, date) => {
  render(<EventBookingClient booking={{ ...base, status, date }} today={TODAY} />)
  expect(statusSection().getByText("Completed means the show took place. It does not record a payment.")).toBeTruthy()
})
it("does not explain completion where it is not reachable", () => {
  render(<EventBookingClient booking={base} today={TODAY} />)
  expect(screen.queryByText(/Completed means/)).toBeNull()
})

// Item 8
it.each([
  ["thrown", /The result could not be confirmed/],
  ["not found", /not found in your current workspace, so the changes were not saved/],
  ["returned", /Unable to save booking\. Please try again\./],
] as const)("a %s save failure is shown next to Update booking and keeps the draft", async (kind, copy) => {
  if (kind === "thrown") mocks.updateBooking.mockRejectedValueOnce(new Error("PRIVATE"))
  else mocks.updateBooking.mockResolvedValueOnce({ success: false, error: kind === "not found" ? "Booking not found" : "Unable to save booking. Please try again." })
  render(<EventBookingClient booking={base} today={TODAY} />)
  fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "Draft Hall" } })
  fireEvent.change(screen.getByLabelText("Note", { exact: true }), { target: { value: "Draft note" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  const alert = screen.getByRole("alert")
  expect(alert.textContent).toMatch(copy)
  expect(alert.textContent).not.toMatch(/PRIVATE|create a new booking/i)
  expect(alert.parentElement).toBe(screen.getByRole("button", { name: "Update booking" }).parentElement)
  expect((screen.getByLabelText("Venue name") as HTMLInputElement).value).toBe("Draft Hall")
  expect((screen.getByLabelText("Note", { exact: true }) as HTMLTextAreaElement).value).toBe("Draft note")
  expect(mocks.refresh).not.toHaveBeenCalled()
})

// Item 9
type Stored = Record<string, unknown>
/** Applies a patch the way updateBooking persists validation.data: omitted keys stay, blank text clears. */
function persist(row: Stored, patch: Stored): Stored {
  const next = { ...row }
  for (const [key, value] of Object.entries(patch)) next[key] = typeof value === "string" && value.trim() === "" ? null : value
  return next
}
async function save(view: ReturnType<typeof render>) {
  await act(async () => { fireEvent.click(within(view.container).getByRole("button", { name: "Update booking" })) })
}

it("two editors: A changes the venue, B changes the fee from the same loaded copy, and both survive", async () => {
  let server: Stored = { ...base }
  const a = render(<EventBookingClient booking={base} today={TODAY} />)
  const b = render(<EventBookingClient booking={base} today={TODAY} />)

  fireEvent.change(within(a.container).getByLabelText("Venue name"), { target: { value: "New Hall" } })
  await save(a)
  const patchA = mocks.updateBooking.mock.calls[0][1]
  expect(patchA).toEqual({ venue_name: "New Hall" })
  server = persist(server, patchA)

  act(() => within(b.container).getByRole("tab", { name: "Financial" }).focus())
  fireEvent.change(await within(b.container).findByLabelText("Booking fee amount"), { target: { value: "500" } })
  fireEvent.change(within(b.container).getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  await save(b)
  const patchB = mocks.updateBooking.mock.calls[1][1]
  expect(patchB).toEqual({ fee_amount_minor: 50000, fee_currency: "EUR" })
  for (const key of ["venue_name", "venue_address", "start_time", "duration_minutes", "notes", "contact_name_main", "contact_phone_main", "contact_email_main", "date"]) {
    expect(patchB).not.toHaveProperty(key)
  }
  server = persist(server, patchB)
  expect(server).toMatchObject({ venue_name: "New Hall", fee_amount_minor: 50000, fee_currency: "EUR", notes: "Load-in 17:00", start_time: "19:00:00" })
})

it("after a refresh brings another editor's change, an untouched field is still not rewritten", async () => {
  const view = render(<EventBookingClient booking={base} today={TODAY} />)
  // Another editor saved a new venue; this page's refresh delivers it while the input keeps the loaded draft.
  view.rerender(<EventBookingClient booking={{ ...base, venue_name: "Other editor's hall", artist: { ...base.artist } }} today={TODAY} />)
  fireEvent.change(within(view.container).getByLabelText("Note", { exact: true }), { target: { value: "Updated note" } })
  await save(view)
  expect(mocks.updateBooking.mock.calls[0][1]).toEqual({ notes: "Updated note" })
})

it("an intentional clear is still sent, and a second save sends only what changed since the first", async () => {
  const view = render(<EventBookingClient booking={base} today={TODAY} />)
  const scope = within(view.container)
  fireEvent.change(scope.getByLabelText("Venue name"), { target: { value: "" } })
  fireEvent.change(scope.getByLabelText("Note", { exact: true }), { target: { value: "" } })
  fireEvent.change(scope.getByLabelText("Email"), { target: { value: "" } })
  await save(view)
  const cleared = mocks.updateBooking.mock.calls[0][1]
  expect(cleared).toEqual({ venue_name: "", notes: null, contact_email_main: "" })
  expect(persist({ ...base }, cleared)).toMatchObject({ venue_name: null, notes: null, contact_email_main: null, venue_address: "1 Main St" })

  fireEvent.change(scope.getByLabelText("Venue address"), { target: { value: "2 Side St" } })
  await save(view)
  expect(mocks.updateBooking.mock.calls[1][1]).toEqual({ venue_address: "2 Side St" })
})

it("whitespace-only edits to trimmed fields are not sent as changes", async () => {
  const view = render(<EventBookingClient booking={base} today={TODAY} />)
  fireEvent.change(within(view.container).getByLabelText("Venue name"), { target: { value: " Old Hall " } })
  fireEvent.change(within(view.container).getByLabelText("Start time"), { target: { value: "20:00" } })
  await save(view)
  expect(mocks.updateBooking.mock.calls[0][1]).toEqual({ start_time: "20:00" })
})

it("after an unconfirmed save, restoring a field to its loaded value is still sent until a save is confirmed", async () => {
  const view = render(<EventBookingClient booking={{ ...base, fee_amount_minor: 10000, fee_currency: "EUR" }} today={TODAY} />)
  const scope = within(view.container)
  act(() => scope.getByRole("tab", { name: "Financial" }).focus())
  const amount = await scope.findByLabelText("Booking fee amount")
  fireEvent.change(amount, { target: { value: "200" } })
  act(() => scope.getByRole("tab", { name: "Performance" }).focus())
  fireEvent.change(await scope.findByLabelText("Venue name"), { target: { value: "Maybe Hall" } })
  // The write may have committed, but its response is lost.
  mocks.updateBooking.mockRejectedValueOnce(new Error("response lost"))
  await save(view)
  expect(mocks.updateBooking.mock.calls[0][1]).toEqual({ fee_amount_minor: 20000, fee_currency: "EUR", venue_name: "Maybe Hall" })
  expect(scope.getByRole("alert").textContent).toContain("could not be confirmed")

  // The user restores the loaded values: they must be written, not suppressed as "unchanged".
  fireEvent.change(scope.getByLabelText("Venue name"), { target: { value: "Old Hall" } })
  act(() => scope.getByRole("tab", { name: "Financial" }).focus())
  fireEvent.change(await scope.findByLabelText("Booking fee amount"), { target: { value: "100" } })
  await save(view)
  expect(mocks.updateBooking.mock.calls[1][1]).toEqual({ fee_amount_minor: 10000, fee_currency: "EUR", venue_name: "Old Hall" })
  expect(scope.getByRole("status").textContent).toBe("Booking saved.")

  // Confirmed: the uncertainty is cleared and untouched fields are no longer sent.
  act(() => scope.getByRole("tab", { name: "Performance" }).focus())
  fireEvent.change(await scope.findByLabelText("Note", { exact: true }), { target: { value: "Only this" } })
  await save(view)
  expect(mocks.updateBooking.mock.calls[2][1]).toEqual({ notes: "Only this" })
})

it("a returned (not committed) failure does not make fields uncertain", async () => {
  mocks.updateBooking.mockResolvedValueOnce({ success: false, error: "Unable to save booking. Please try again." })
  const view = render(<EventBookingClient booking={base} today={TODAY} />)
  fireEvent.change(within(view.container).getByLabelText("Venue name"), { target: { value: "Rejected Hall" } })
  await save(view)
  fireEvent.change(within(view.container).getByLabelText("Venue name"), { target: { value: "Old Hall" } })
  fireEvent.change(within(view.container).getByLabelText("Note", { exact: true }), { target: { value: "New note" } })
  await save(view)
  expect(mocks.updateBooking.mock.calls[1][1]).toEqual({ notes: "New note" })
})
