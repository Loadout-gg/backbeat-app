// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
const { updateBooking, refresh } = vi.hoisted(() => ({ updateBooking: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), back: vi.fn() }) }))
vi.mock("@/lib/actions/bookings", () => ({ updateBooking, deleteBooking: vi.fn() }))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import type { BookingWithArtist } from "@/lib/actions/bookings"
const booking: BookingWithArtist = {
  id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-10-12", start_time: "19:00:00",
  venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
  duration_minutes: 60, notes: "Original note", status: "in_progress", created_at: "", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: null, profile_image_url: null },
}
const venueContact = {
  venue_name: "Moon Hall", venue_address: "12 Orbit Road", contact_name_main: "Alex Moon",
  contact_phone_main: "+39 123 456", contact_email_main: "alex@example.com",
}
const fieldLabels = {
  venue_name: "Venue name", venue_address: "Venue Address", contact_name_main: "Contact name (main)",
  contact_phone_main: "Phone number", contact_email_main: "Email",
} as const
it.each([
  venueContact,
  Object.fromEntries(Object.keys(venueContact).map(key => [key, null])),
  Object.fromEntries(Object.keys(venueContact).map(key => [key, undefined])),
])(
  "initializes venue and main contact from booking values %j", (fields) => {
    render(<EventBookingClient booking={{ ...booking, ...fields }} />)
    for (const [key, label] of Object.entries(fieldLabels)) {
      const input = screen.getAllByPlaceholderText(label === "Venue Address" ? "Venue address" : label === "Contact name (main)" ? "Contact name" : label)[0] as HTMLInputElement
      expect(input.value).toBe(fields[key as keyof typeof fields] ?? "")
    }
  },
)
it("enables the date and five approved venue/contact fields with unique labels and an email input", () => {
  const { container } = render(<EventBookingClient booking={booking} />)
  const approved = Object.values(fieldLabels).map(label => screen.getByLabelText(label))
  for (const input of approved) {
    expect(input.matches(":disabled")).toBe(false)
    expect(input.id).not.toBe("")
    expect(container.querySelectorAll(`[id="${input.id}"]`)).toHaveLength(1)
    input.focus()
    expect(document.activeElement).toBe(input)
  }
  expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email")
  const enabled = Array.from(container.querySelectorAll("input:not([type=time])")).filter(input => !input.matches(":disabled"))
  expect(enabled).toEqual([screen.getByLabelText("Booking date"), ...approved])
})
it.each(["edited", "blank"])("submits explicit %s venue and main contact strings", async (mode) => {
  updateBooking.mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={{ ...booking, ...venueContact }} />)
  const draft = Object.fromEntries(Object.entries(venueContact).map(([key, value]) => [key, mode === "blank" ? "" : key === "contact_email_main" ? "edited@example.com" : ` ${value} edited `]))
  for (const [key, label] of Object.entries(fieldLabels)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: draft[key] } })
  }
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(updateBooking).toHaveBeenCalledWith(booking.id, {
    start_time: "19:00", duration_minutes: 60, notes: "Original note", ...draft,
  }))
  expect(refresh).toHaveBeenCalledOnce()
})
it.each(["returned", "thrown"])("preserves the new-field draft across %s failure and retry", async (failure) => {
  if (failure === "returned") updateBooking.mockResolvedValueOnce({ success: false, error: "Save denied" })
  else updateBooking.mockRejectedValueOnce(new Error("Network unavailable"))
  updateBooking.mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={{ ...booking, ...venueContact }} />)
  const draft = { venue_name: "New venue", venue_address: "", contact_name_main: "New contact", contact_phone_main: "", contact_email_main: "new@example.com" }
  for (const [key, label] of Object.entries(fieldLabels)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: draft[key as keyof typeof draft] } })
  }
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  expect((await screen.findByRole("alert")).textContent).toContain(failure === "returned" ? "Save denied" : "Unable to save booking. Please try again.")
  expect(refresh).not.toHaveBeenCalled()
  for (const [key, label] of Object.entries(fieldLabels)) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(draft[key as keyof typeof draft])
  }
  const payload = { start_time: "19:00", duration_minutes: 60, notes: "Original note", ...draft }
  expect(updateBooking).toHaveBeenNthCalledWith(1, booking.id, payload)
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(updateBooking).toHaveBeenCalledTimes(2)
  expect(updateBooking).toHaveBeenNthCalledWith(2, booking.id, payload)
  expect(screen.queryByRole("alert")).toBeNull()
})
afterEach(() => {
  cleanup()
  updateBooking.mockReset()
  refresh.mockReset()
})
it.each([
  ["19:00:00", "09:00", "AM", "10:00 AM"],
  ["09:00:00", "19:00", "PM", "8:00 PM"],
  ["19:00:00", "00:00", "AM", "1:00 AM"],
  ["09:00:00", "12:00", "PM", "1:00 PM"],
  ["09:00:00", "23:30", "PM", "12:30 AM"],
])("saves a 24-hour edit from %s to %s with matching end time", async (initial, edited, period, end) => {
  updateBooking.mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={{ ...booking, start_time: initial }} />)
  fireEvent.change(screen.getByDisplayValue(initial.slice(0, 5)), { target: { value: edited } })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(updateBooking).toHaveBeenCalledWith(booking.id, {
    start_time: edited, duration_minutes: 60, notes: "Original note",
    venue_name: "", venue_address: "", contact_name_main: "", contact_phone_main: "", contact_email_main: "",
  }))
  expect(screen.getByText(end)).toBeTruthy()
  expect(screen.getByText(period)).toBeTruthy()
  expect(screen.queryByRole("combobox")).toBeNull()
})
it("disables unsaved placeholder inputs, nested buttons and the driver checkbox", () => {
  render(<EventBookingClient booking={booking} />)
  const placeholders = ["Event type", "Expected audience", "Artist name", "Driver name", "Driver phone number", "Distance"]
  for (const placeholder of placeholders) {
    for (const input of screen.getAllByPlaceholderText(placeholder)) {
      expect(input.matches(":disabled"), placeholder).toBe(true)
      input.focus()
      expect(document.activeElement).not.toBe(input)
      expect((input as HTMLInputElement).value).toBe("")
    }
  }
  for (const placeholder of ["Contact name", "Phone number", "Email"]) {
    const secondary = screen.getAllByPlaceholderText(placeholder)[1]
    expect(secondary.matches(":disabled")).toBe(true)
    secondary.focus()
    expect(document.activeElement).not.toBe(secondary)
    expect((secondary as HTMLInputElement).value).toBe("")
  }
  const addArtist = screen.getByRole("button", { name: "Add artist" })
  expect(addArtist.matches(":disabled")).toBe(true)
  addArtist.focus()
  expect(document.activeElement).not.toBe(addArtist)
  const checkbox = screen.getByRole("checkbox", { name: "Same driver Inbound/Outbound" })
  expect(checkbox.matches(":disabled")).toBe(true)
  fireEvent.click(checkbox)
  expect(checkbox.getAttribute("aria-checked")).toBe("true")
  expect(screen.getByText("Not available yet: event type, expected audience, lineup, driver and secondary contact fields are not saved.")).toBeTruthy()
  expect(screen.getByDisplayValue("19:00").matches(":disabled")).toBe(false)
  expect(screen.getByDisplayValue("Original note").matches(":disabled")).toBe(false)
  expect(screen.getByRole("button", { name: "Update booking" }).matches(":disabled")).toBe(false)
})
it("shows returned save errors without refreshing and allows retry", async () => {
  updateBooking.mockResolvedValueOnce({ success: false, error: "Save denied" }).mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={booking} />)
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  expect((await screen.findByRole("alert")).textContent).toContain("Save denied")
  expect(refresh).not.toHaveBeenCalled()
  expect((screen.getByRole("button", { name: "Update booking" }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(screen.queryByRole("alert")).toBeNull()
})
it("recovers from a thrown save promise and retains user input", async () => {
  updateBooking.mockRejectedValueOnce(new Error("Network unavailable"))
  render(<EventBookingClient booking={booking} />)
  fireEvent.change(screen.getByDisplayValue("Original note"), { target: { value: "Keep this edit" } })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to save booking. Please try again.")
  expect((screen.getByRole("button", { name: "Update booking" }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByDisplayValue("Keep this edit")).toBeTruthy()
  expect(refresh).not.toHaveBeenCalled()
})

it("edits a booking date without changing other supported values", async () => {
  updateBooking.mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={booking} />)
  const date = screen.getByLabelText("Booking date") as HTMLInputElement
  expect(date.type).toBe("date")
  expect(date.value).toBe(booking.date)
  fireEvent.change(date, { target: { value: "2026-10-26" } })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(updateBooking).toHaveBeenCalledWith(booking.id, {
    date: "2026-10-26", start_time: "19:00", duration_minutes: 60,
    notes: "Original note", venue_name: "", venue_address: "",
    contact_name_main: "", contact_phone_main: "", contact_email_main: "",
  }))
  expect(refresh).toHaveBeenCalledOnce()
})
it("rejects an empty date before calling the action", async () => {
  render(<EventBookingClient booking={booking} />)
  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  expect((await screen.findByRole("alert")).textContent).toContain("valid booking date")
  expect(updateBooking).not.toHaveBeenCalled()
})
it.each(["returned", "thrown"])("keeps the date draft after %s save failure", async failure => {
  if (failure === "returned") updateBooking.mockResolvedValueOnce({ success: false, error: "Save failed" })
  else updateBooking.mockRejectedValueOnce(new Error("offline"))
  render(<EventBookingClient booking={booking} />)
  fireEvent.change(screen.getByLabelText("Booking date"), { target: { value: "2026-10-26" } })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await screen.findByRole("alert")
  expect((screen.getByLabelText("Booking date") as HTMLInputElement).value).toBe("2026-10-26")
  expect(refresh).not.toHaveBeenCalled()
  updateBooking.mockResolvedValueOnce({ success: true })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
})
