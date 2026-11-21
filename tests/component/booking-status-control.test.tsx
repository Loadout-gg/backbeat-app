// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
const mocks = vi.hoisted(() => ({
  updateBooking: vi.fn(), updateBookingStatus: vi.fn(), deleteBooking: vi.fn(), getBookings: vi.fn(), refresh: vi.fn(),
}))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), back: vi.fn() }),
}))
vi.mock("@/lib/actions/bookings", () => ({
  updateBooking: mocks.updateBooking, updateBookingStatus: mocks.updateBookingStatus,
  deleteBooking: mocks.deleteBooking, getBookings: mocks.getBookings,
}))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import BookingsPage from "@/app/dashboard/bookings/page"
import type { Booking, BookingWithArtist } from "@/lib/actions/bookings"
import type { BookingStatus } from "@/lib/booking-status"

const TODAY = "2026-11-21"
const base: BookingWithArtist = {
  fee_amount_minor: null, fee_currency: null, hold_expires_on: null,
  id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-12-12", start_time: "19:00:00",
  venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
  duration_minutes: 60, notes: null, status: "in_progress", created_at: "2026-01-02", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: "EUR", profile_image_url: null },
}
const editor = (overrides: Partial<BookingWithArtist> = {}, artistBookings: readonly Booking[] | null = []) =>
  <EventBookingClient booking={{ ...base, ...overrides }} artistBookings={artistBookings} today={TODAY} />
const statusSection = () => within(screen.getByRole("region", { name: "Status" }))
const actions = () => within(screen.getByRole("group", { name: "Change status" })).getAllByRole("button").map(button => button.textContent)

beforeEach(() => {
  mocks.updateBookingStatus.mockResolvedValue({ success: true })
  mocks.updateBooking.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it.each([
  ["in_progress", "2026-12-12", ["Place on hold", "Mark as option", "Confirm booking", "Cancel booking"]],
  ["hold", "2026-12-12", ["Mark as option", "Confirm booking", "Cancel booking", "Reopen as in progress"]],
  ["option", "2026-12-12", ["Confirm booking", "Cancel booking", "Place on hold"]],
  ["confirmed", "2026-12-12", ["Cancel booking"]],
  ["confirmed", TODAY, ["Cancel booking", "Mark as completed"]],
  ["confirmed", "2026-11-01", ["Cancel booking", "Mark as completed"]],
  ["cancelled", "2026-12-12", ["Reopen as in progress"]],
] as const)("offers only graph transitions for %s on %s", (status, date, expected) => {
  render(editor({ status, date }))
  expect(actions()).toEqual([...expected])
})
it("offers no transition for a completed booking and says why", () => {
  render(editor({ status: "completed", date: "2026-11-01" }))
  expect(screen.queryByRole("group", { name: "Change status" })).toBeNull()
  expect(statusSection().getByText("A completed booking cannot change status.")).toBeTruthy()
})
it("does not offer completion when the server date is unknown", () => {
  render(<EventBookingClient booking={{ ...base, status: "confirmed", date: "2020-01-01" }} />)
  expect(screen.queryByRole("button", { name: "Mark as completed" })).toBeNull()
  expect(screen.queryByText("This show date has passed. Mark as completed?")).toBeNull()
})
it.each([["2026-11-20", true], [TODAY, false], ["2026-11-22", false]] as const)("hints at completion for a confirmed show on %s: %s", (date, shown) => {
  render(editor({ status: "confirmed", date }))
  expect(screen.queryByText("This show date has passed. Mark as completed?") !== null).toBe(shown)
})
it.each([
  ["in_progress", "Place on hold", "hold", "Status changed to hold."],
  ["hold", "Mark as option", "option", "Status changed to option."],
  ["option", "Confirm booking", "confirmed", "Status changed to confirmed."],
  ["confirmed", "Cancel booking", "cancelled", "Status changed to cancelled."],
  ["cancelled", "Reopen as in progress", "in_progress", "Status changed to in progress."],
] as const)("sends %s -> %s with the status the user saw and refreshes", async (from, label, to, notice) => {
  render(editor({ status: from }))
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })) })
  expect(mocks.updateBookingStatus).toHaveBeenCalledExactlyOnceWith("booking-a", to, from)
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(statusSection().getByRole("status").textContent).toBe(notice)
  expect(mocks.updateBooking).not.toHaveBeenCalled()
})
it("completes a past confirmed booking", async () => {
  render(editor({ status: "confirmed", date: "2026-11-01" }))
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark as completed" })) })
  expect(mocks.updateBookingStatus).toHaveBeenCalledExactlyOnceWith("booking-a", "completed", "confirmed")
})
it.each([
  "This booking was changed elsewhere. Reload and try again.",
  "Booking not found",
  "This status change is not allowed.",
])("shows the rejection %j as an alert without claiming success", async (error) => {
  mocks.updateBookingStatus.mockResolvedValueOnce({ success: false, error })
  render(editor())
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm booking" })) })
  expect(statusSection().getByRole("alert").textContent).toBe(error)
  expect(statusSection().queryByRole("status")).toBeNull()
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(statusSection().getByText("In progress", { exact: true })).toBeTruthy()
})
it("reports an unconfirmed outcome when the request throws, and allows a retry", async () => {
  mocks.updateBookingStatus.mockRejectedValueOnce(new Error("PRIVATE_NETWORK_DETAIL"))
  render(editor())
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm booking" })) })
  expect(statusSection().getByRole("alert").textContent).toBe("Unable to confirm the status change. Reload the booking before retrying.")
  expect(screen.queryByText(/PRIVATE_NETWORK_DETAIL/)).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm booking" })) })
  expect(mocks.updateBookingStatus).toHaveBeenCalledTimes(2)
  expect(statusSection().queryByRole("alert")).toBeNull()
})
it("ignores further status clicks while one change is pending", async () => {
  let settle!: (value: { success: boolean }) => void
  mocks.updateBookingStatus.mockReturnValueOnce(new Promise(resolve => { settle = resolve }))
  render(editor())
  fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }))
  const pending = await screen.findByRole("button", { name: "Updating..." })
  expect(pending.getAttribute("aria-disabled")).toBe("true")
  fireEvent.click(screen.getByRole("button", { name: "Cancel booking" }))
  fireEvent.click(pending)
  expect(mocks.updateBookingStatus).toHaveBeenCalledOnce()
  await act(async () => settle({ success: true }))
  expect(screen.getByRole("button", { name: "Confirm booking" }).getAttribute("aria-disabled")).toBe("false")
})
it("shows the hold expiry field only on hold and saves it with Update booking", async () => {
  const { unmount } = render(editor({ status: "option" }))
  expect(screen.queryByLabelText("Hold expires on (optional)")).toBeNull()
  unmount()
  render(editor({ status: "hold", hold_expires_on: "2026-12-01" }))
  const field = screen.getByLabelText("Hold expires on (optional)") as HTMLInputElement
  expect(field.value).toBe("2026-12-01")
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  expect(mocks.updateBooking.mock.calls[0][1]).not.toHaveProperty("hold_expires_on")
  expect(mocks.updateBooking.mock.calls[0][1]).not.toHaveProperty("status")
  fireEvent.change(field, { target: { value: "2026-12-05" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  expect(mocks.updateBooking.mock.calls[1][1]).toMatchObject({ hold_expires_on: "2026-12-05" })
  fireEvent.change(field, { target: { value: "" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) })
  expect(mocks.updateBooking.mock.calls[2][1]).toMatchObject({ hold_expires_on: null })
})
it.each([["2026-11-20", true], [TODAY, false], [null, false]] as const)("flags a hold expiring on %s as expired: %s", (hold_expires_on, expired) => {
  render(editor({ status: "hold", hold_expires_on }))
  expect(statusSection().queryByText("Hold expired") !== null).toBe(expired)
  expect(statusSection().getByText("Hold", { exact: true })).toBeTruthy()
})
it("shows the derived hold priority only when holds compete for the same artist and date", () => {
  const other = { ...base, id: "booking-0", status: "hold" as BookingStatus, created_at: "2026-01-01" }
  const mine = { ...base, status: "hold" as BookingStatus }
  const { unmount } = render(editor({ status: "hold" }, [mine, other]))
  expect(statusSection().getByText("Hold priority 2 of 2")).toBeTruthy()
  unmount()
  render(editor({ status: "hold" }, [mine, { ...other, date: "2027-01-01" }]))
  expect(screen.queryByText(/Hold priority/)).toBeNull()
})
it("lists hold and option filters and derives expired and priority badges from the full list", async () => {
  vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00Z`), toFake: ["Date"] })
  const row = (id: string, extra: Partial<Booking>) => ({ ...base, id, date: "2030-01-02", ...extra })
  mocks.getBookings.mockResolvedValue([
    row("first", { status: "hold", created_at: "2026-01-01", hold_expires_on: "2026-11-01" }),
    row("second", { status: "hold", created_at: "2026-01-02" }),
    row("opt", { status: "option" }),
  ])
  render(await BookingsPage({ searchParams: Promise.resolve({ status: "hold" }) }))
  const nav = within(screen.getByRole("navigation", { name: "Filter bookings by status" }))
  expect(nav.getByRole("link", { name: "Hold" }).getAttribute("aria-current")).toBe("page")
  expect(nav.getByRole("link", { name: "Option" }).getAttribute("href")).toBe("/dashboard/bookings?status=option")
  const rows = screen.getAllByRole("listitem")
  expect(rows).toHaveLength(2)
  expect(within(rows[0]).getByText("Hold expired")).toBeTruthy()
  expect(within(rows[0]).getByText("Hold priority 1 of 2")).toBeTruthy()
  expect(within(rows[1]).queryByText("Hold expired")).toBeNull()
  expect(within(rows[1]).getByText("Hold priority 2 of 2")).toBeTruthy()
})
