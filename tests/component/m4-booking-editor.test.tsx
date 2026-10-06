// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }) }))
vi.mock("@/lib/actions/bookings", () => ({ updateBooking: vi.fn(), deleteBooking: vi.fn() }))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import type { BookingWithArtist } from "@/lib/actions/bookings"
const booking: BookingWithArtist = {
  fee_amount_minor: null, fee_currency: null,
  id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-10-12", start_time: "19:00:00",
  venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
  duration_minutes: 60, notes: "Original note", status: "in_progress", created_at: "", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: "EUR", profile_image_url: null },
}
afterEach(cleanup)
it.each([
  ["£", 400, "£400"], ["GBP", 400, "£400"],
  ["€", 400, "€400"], ["EUR", 400, "€400"],
  ["$", 400, "$400"], ["USD", 400, "$400"],
  ["CHF", 400, "CHF 400"], ["credits", 400, "credits 400"],
  [null, 400, "400 (currency unavailable)"], ["", 400, "400 (currency unavailable)"],
  ["   ", 400, "400 (currency unavailable)"], ["GBP", 0, "£0"],
  [null, 0, "0 (currency unavailable)"], ["USD", 1234.5, "$1,234.5"],
  ["GBP", null, "N/A"],
] as const)("presents artist currency %s and fee %s as %s", (currency, fee, display) => {
  render(<EventBookingClient booking={{ ...booking, artist: { ...booking.artist, fee, currency } }} />)
  expect(screen.getByText(display, { exact: true })).toBeTruthy()
})

it("displays a saved booking artist rate in pounds", () => {
  render(<EventBookingClient booking={{ ...booking, artist: { ...booking.artist, fee: 400, currency: "GBP" } }} />)
  expect(screen.getByText("£400", { exact: true })).toBeTruthy()
})
it.each([[0, "€0"], [null, "N/A"]] as const)("presents EUR fee %s as %s", (fee, display) => {
  render(<EventBookingClient booking={{ ...booking, artist: { ...booking.artist, fee } }} />)
  expect(screen.getByText(display, { exact: true })).toBeTruthy()
})
it("uses named keyboard tabs and retains Performance drafts across all panels", async () => {
  render(<EventBookingClient booking={booking} />)
  fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "Unsaved venue" } })
  fireEvent.change(screen.getByLabelText("Note", { exact: true }), { target: { value: "Unsaved note" } })
  const tabs = within(screen.getByRole("tablist", { name: "Booking sections" }))
  expect(tabs.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Performance", "Financial", "Travel", "Accommodation", "Documents", "Artist contacts"])
  const performance = tabs.getByRole("tab", { name: "Performance", selected: true })
  expect(screen.getByRole("tabpanel", { name: "Performance" })).toBeTruthy()
  performance.focus()
  fireEvent.keyDown(performance, { key: "ArrowRight" })
  await waitFor(() => expect(tabs.getByRole("tab", { name: "Financial", selected: true })).toBe(document.activeElement))
  expect(within(screen.getByRole("tabpanel", { name: "Financial" })).getByLabelText("Booking fee amount")).toBeTruthy()
  fireEvent.keyDown(document.activeElement!, { key: "End" })
  await waitFor(() => expect(tabs.getByRole("tab", { name: "Artist contacts", selected: true })).toBe(document.activeElement))
  fireEvent.keyDown(document.activeElement!, { key: "Home" })
  await waitFor(() => expect(performance.getAttribute("aria-selected")).toBe("true"))
  expect((screen.getByLabelText("Venue name") as HTMLInputElement).value).toBe("Unsaved venue")
  expect((screen.getByLabelText("Note", { exact: true }) as HTMLTextAreaElement).value).toBe("Unsaved note")
  fireEvent.keyDown(performance, { key: "ArrowLeft" })
  await waitFor(() => expect(tabs.getByRole("tab", { name: "Artist contacts", selected: true })).toBe(document.activeElement))
  for (const name of ["Financial", "Travel", "Accommodation", "Documents", "Artist contacts"]) {
    act(() => tabs.getByRole("tab", { name }).focus())
    await waitFor(() => {
      const panel = screen.getByRole("tabpanel", { name })
      if (name === "Financial") expect(within(panel).getByLabelText("Booking fee amount")).toBeTruthy()
      else expect(panel.textContent).toContain("This section is coming soon.")
    })
  }
})
it("associates exact supported time and note labels with editable controls", () => {
  render(<EventBookingClient booking={booking} />)
  for (const [label, value] of [["Start time", "19:00"], ["Duration", "01:00"], ["Note", "Original note"]]) {
    const control = screen.getByLabelText(label, { exact: true }) as HTMLInputElement
    expect(control.value).toBe(value)
    expect(control.matches(":disabled")).toBe(false)
    control.focus()
    expect(document.activeElement).toBe(control)
  }
})
