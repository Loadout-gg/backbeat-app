// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { updateBooking, refresh } = vi.hoisted(() => ({ updateBooking: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), back: vi.fn() }) }))
vi.mock("@/lib/actions/bookings", () => ({ updateBooking, deleteBooking: vi.fn() }))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import type { BookingWithArtist } from "@/lib/actions/bookings"

const booking: BookingWithArtist = {
  id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a", date: "2030-01-18", start_time: "21:30:00",
  fee_amount_minor: 105000, fee_currency: "EUR", duration_minutes: 90, notes: "Soundcheck at 19:00",
  venue_name: "North Hall", venue_address: "42 Harbour Road", contact_name_main: "Alex Venue",
  contact_phone_main: "+39 0600000000", contact_email_main: "alex@backbeat.test",
  status: "in_progress", created_at: "", updated_at: "",
  artist: { id: "artist-a", stage_name: "Blue Orbit", name: "Dana", surname: null, location: null, fee: 1200, currency: "EUR", profile_image_url: null },
}

function pendingSave() {
  let resolve!: (value: { success: boolean; error?: string }) => void
  const promise = new Promise<{ success: boolean; error?: string }>(done => { resolve = done })
  updateBooking.mockReturnValueOnce(promise)
  return resolve
}

afterEach(() => { cleanup(); updateBooking.mockReset(); refresh.mockReset() })

async function financialPanel() {
  act(() => screen.getByRole("tab", { name: "Financial" }).focus())
  return screen.findByLabelText("Booking fee amount")
}

it("associates negative-fee feedback with the amount and sends focus directly to correction", async () => {
  render(<EventBookingClient booking={booking} />)
  const amount = await financialPanel() as HTMLInputElement
  const currency = screen.getByLabelText("Booking fee currency")
  fireEvent.change(amount, { target: { value: "-10" } })
  const save = screen.getByRole("button", { name: "Update booking" })
  save.focus()
  fireEvent.click(save)
  const error = await screen.findByRole("alert")
  expect(error.textContent).toBe("Booking fee must be zero or greater")
  expect.soft(amount.getAttribute("aria-invalid")).toBe("true")
  expect.soft(amount.getAttribute("aria-describedby")?.split(" ")).toContain(error.id)
  expect.soft(error.id).not.toBe("")
  expect.soft(amount.parentElement?.contains(error)).toBe(true)
  expect.soft(currency.getAttribute("aria-invalid")).not.toBe("true")
  expect(document.activeElement).toBe(amount)
  expect(amount.value).toBe("-10")
  expect(updateBooking).not.toHaveBeenCalled()
  fireEvent.change(amount, { target: { value: "900" } })
  expect(screen.queryByRole("alert")).toBeNull()
  expect(amount.getAttribute("aria-invalid")).not.toBe("true")
  updateBooking.mockResolvedValueOnce({ success: true })
  save.focus()
  fireEvent.click(save)
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(document.activeElement).toBe(save)
  expect(updateBooking).toHaveBeenCalledWith(booking.id, expect.objectContaining({ fee_amount_minor: 90000, fee_currency: "EUR", start_time: "21:30", duration_minutes: 90, contact_name_main: "Alex Venue", notes: booking.notes }))
})

it.each([
  ["", "EUR", "Booking fee amount", "Booking fee currency"],
  ["1050", "", "Booking fee currency", "Booking fee amount"],
])("targets only the missing field for amount %s and currency %s", async (value, code, missingLabel, validLabel) => {
  render(<EventBookingClient booking={booking} />)
  fireEvent.change(await financialPanel(), { target: { value } })
  fireEvent.change(screen.getByLabelText("Booking fee currency"), { target: { value: code } })
  // Financial validation remains reachable when submitting from another panel.
  act(() => screen.getByRole("tab", { name: "Performance" }).focus())
  const save = screen.getByRole("button", { name: "Update booking" })
  save.focus()
  fireEvent.click(save)
  const error = await screen.findByRole("alert")
  const missing = screen.getByLabelText(missingLabel)
  const valid = screen.getByLabelText(validLabel)
  expect(missing.getAttribute("aria-invalid")).toBe("true")
  expect(missing.getAttribute("aria-describedby")?.split(" ")).toContain(error.id)
  expect(valid.getAttribute("aria-invalid")).not.toBe("true")
  expect(valid.getAttribute("aria-describedby")).toBe("booking-fee-help")
  expect(missing.parentElement?.contains(error)).toBe(true)
  expect(document.activeElement).toBe(missing)
  expect(updateBooking).not.toHaveBeenCalled()
})

it.each(["returned", "thrown"])("releases the pending guard after a %s failure without moving focus and permits retry", async failure => {
  let settle!: () => void
  updateBooking.mockImplementationOnce(() => new Promise((resolve, reject) => {
    settle = () => failure === "returned" ? resolve({ success: false, error: "Save denied" }) : reject(new Error("Offline"))
  }))
  render(<EventBookingClient booking={booking} />)
  const save = screen.getByRole("button", { name: "Update booking" }) as HTMLButtonElement
  save.focus()
  fireEvent.click(save)
  // Operators can move elsewhere while saving; completion must not steal focus back.
  const note = screen.getByLabelText("Note", { exact: true })
  note.focus()
  await act(async () => settle())
  expect((await screen.findByRole("alert")).textContent).toContain(failure === "returned" ? "Save denied" : "Unable to save booking")
  expect(document.activeElement).toBe(note)
  expect(save.disabled).toBe(false)
  expect(save.getAttribute("aria-disabled")).toBe("false")
  expect(screen.getByRole("status").textContent).toBe("")
  expect(refresh).not.toHaveBeenCalled()
  updateBooking.mockResolvedValueOnce({ success: true })
  fireEvent.click(save)
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(updateBooking).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole("alert")).toBeNull()
  expect(document.activeElement).toBe(note)
})

it("preserves same-ID drafts on refreshed props and never replays consumed validation focus", async () => {
  const { rerender } = render(<EventBookingClient booking={booking} />)
  const performanceDraft = {
    "Booking date": "2030-01-22", "Start time": "00:30", "Duration": "01:30", "Venue name": "New Hall",
    "Venue Address": "New address", "Contact name (main)": "Sam", "Phone number": "+44 2000000000", "Email": "sam@backbeat.test", "Note": "New note",
  }
  for (const [label, value] of Object.entries(performanceDraft)) fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
  fireEvent.change(await financialPanel(), { target: { value: "-10" } })
  const save = screen.getByRole("button", { name: "Update booking" })
  fireEvent.click(save)
  await screen.findByRole("alert")
  const currency = screen.getByLabelText("Booking fee currency")
  currency.focus()
  rerender(<EventBookingClient booking={{ ...booking, notes: "Fresh server note", fee_amount_minor: 0, fee_currency: "USD", artist: { ...booking.artist } }} />)
  expect(document.activeElement).toBe(currency)
  expect((screen.getByLabelText("Booking fee amount") as HTMLInputElement).value).toBe("-10")
  expect((currency as HTMLSelectElement).value).toBe("EUR")
  // Even unmounting/remounting the Financial panel must not replay error focus.
  act(() => screen.getByRole("tab", { name: "Performance" }).focus())
  for (const [label, value] of Object.entries(performanceDraft)) expect((screen.getByLabelText(label, { exact: true }) as HTMLInputElement).value).toBe(value)
  await financialPanel()
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Financial" }))
  fireEvent.change(screen.getByLabelText("Booking fee amount"), { target: { value: "900" } })
  updateBooking.mockResolvedValueOnce({ success: true })
  fireEvent.click(save)
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(updateBooking).toHaveBeenCalledWith(booking.id, {
    date: "2030-01-22", start_time: "00:30", duration_minutes: 90, notes: "New note", venue_name: "New Hall",
    venue_address: "New address", contact_name_main: "Sam", contact_phone_main: "+44 2000000000", contact_email_main: "sam@backbeat.test",
    fee_amount_minor: 90000, fee_currency: "EUR",
  })
})

it.each([
  ["1000.50", "EUR", 100050], ["1000.50", "USD", 100050], ["1000,50", "GBP", 100050],
  ["150001", "JPY", 150001], ["0", "USD", 0], ["", "", null],
])("preserves fee semantics for %s %s and clears the acknowledgment on subsequent edits", async (text, code, minor) => {
  updateBooking.mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={booking} />)
  fireEvent.change(await financialPanel(), { target: { value: text } })
  fireEvent.change(screen.getByLabelText("Booking fee currency"), { target: { value: code } })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(screen.getByRole("status").textContent).toBe("Booking saved.")
  expect(updateBooking).toHaveBeenCalledWith(booking.id, expect.objectContaining({ fee_amount_minor: minor, fee_currency: code || null }))
  expect(screen.getByText("€1,200")).toBeTruthy()
  const payload = updateBooking.mock.calls[0][1]
  for (const key of ["artist", "fee", "status"]) expect(payload).not.toHaveProperty(key)
  fireEvent.change(screen.getByLabelText("Booking fee amount"), { target: { value: "12" } })
  expect(screen.getByRole("status").textContent).toBe("")
})

it("clears saved feedback on a Performance edit without moving focus", async () => {
  updateBooking.mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={booking} />)
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Booking saved."))
  const note = screen.getByLabelText("Note", { exact: true })
  note.focus()
  fireEvent.change(note, { target: { value: "Unsaved change" } })
  expect(screen.getByRole("status").textContent).toBe("")
  expect(document.activeElement).toBe(note)
})

it("does not report the current draft as saved when it changes during a pending request", async () => {
  const resolve = pendingSave()
  render(<EventBookingClient booking={booking} />)
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  fireEvent.change(screen.getByLabelText("Note", { exact: true }), { target: { value: "New unsaved note" } })
  await act(async () => resolve({ success: true }))
  expect(screen.getByRole("status").textContent).toBe("")
  expect((screen.getByLabelText("Note", { exact: true }) as HTMLTextAreaElement).value).toBe("New unsaved note")
  expect(updateBooking).toHaveBeenCalledWith(booking.id, expect.objectContaining({ notes: booking.notes }))
})

it("guards repeated activation before React renders the pending state", async () => {
  const resolve = pendingSave()
  render(<EventBookingClient booking={booking} />)
  const save = screen.getByRole("button", { name: "Update booking" })
  act(() => {
    save.click()
    save.click()
  })
  expect(updateBooking).toHaveBeenCalledOnce()
  fireEvent.click(save)
  fireEvent.keyDown(save, { key: "Enter" })
  fireEvent.keyDown(save, { key: " " })
  expect(updateBooking).toHaveBeenCalledOnce()
  await act(async () => resolve({ success: true }))
  expect(refresh).toHaveBeenCalledOnce()
})

it("keeps the save control focusable while pending and exposes a durable saved status through refresh", async () => {
  const resolve = pendingSave()
  const { rerender } = render(<EventBookingClient booking={booking} />)
  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "2030-01-22" } })
  const save = screen.getByRole("button", { name: "Update booking" }) as HTMLButtonElement
  save.focus()
  fireEvent.click(save)
  expect(screen.getByRole("button", { name: "Saving..." })).toBe(save)
  // Chrome blurs native disabled buttons even where jsdom retains their focus.
  expect.soft(save.disabled).toBe(false)
  expect.soft(save.getAttribute("aria-disabled")).toBe("true")
  expect(document.activeElement).toBe(save)
  await act(async () => resolve({ success: true }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(screen.getByRole("status").textContent).toBe("Booking saved.")
  expect(screen.getByRole("button", { name: "Update booking" })).toBe(save)
  expect(document.activeElement).toBe(save)
  rerender(<EventBookingClient booking={{ ...booking, date: "2030-01-22", artist: { ...booking.artist } }} />)
  expect(screen.getByRole("status").textContent).toBe("Booking saved.")
  expect(document.activeElement).toBe(save)
  expect(updateBooking).toHaveBeenCalledWith(booking.id, {
    date: "2030-01-22", start_time: "21:30", duration_minutes: 90, notes: booking.notes,
    venue_name: booking.venue_name, venue_address: booking.venue_address,
    contact_name_main: booking.contact_name_main, contact_phone_main: booking.contact_phone_main, contact_email_main: booking.contact_email_main,
  })
})
