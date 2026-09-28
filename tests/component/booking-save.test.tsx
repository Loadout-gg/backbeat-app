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
  duration_minutes: 60, notes: "Original note", status: "in_progress", created_at: "", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: null, profile_image_url: null },
}
afterEach(cleanup)
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
  }))
  expect(screen.getByText(end)).toBeTruthy()
  expect(screen.getByText(period)).toBeTruthy()
  expect(screen.queryByRole("combobox")).toBeNull()
})
it("disables unsaved placeholder inputs, nested buttons and the driver checkbox", () => {
  render(<EventBookingClient booking={booking} />)
  const placeholders = ["Venue name", "Venue address", "Event type", "Expected audience", "Artist name", "Driver name", "Driver phone number", "Distance", "Contact name", "Phone number", "Email"]
  for (const placeholder of placeholders) {
    for (const input of screen.getAllByPlaceholderText(placeholder)) {
      expect(input.matches(":disabled"), placeholder).toBe(true)
      input.focus()
      expect(document.activeElement).not.toBe(input)
      expect((input as HTMLInputElement).value).toBe("")
    }
  }
  const addArtist = screen.getByRole("button", { name: "Add artist" })
  expect(addArtist.matches(":disabled")).toBe(true)
  addArtist.focus()
  expect(document.activeElement).not.toBe(addArtist)
  const checkbox = screen.getByRole("checkbox", { name: "Same driver Inbound/Outbound" })
  expect(checkbox.matches(":disabled")).toBe(true)
  fireEvent.click(checkbox)
  expect(checkbox.getAttribute("aria-checked")).toBe("true")
  expect(screen.getByText(/Not available yet.*fields are not saved/)).toBeTruthy()
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
