// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
const { createBooking } = vi.hoisted(() => ({ createBooking: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/actions/bookings", () => ({ createBooking }))
vi.mock("@/lib/actions/artists", () => ({ getArtists: vi.fn(async () => []) }))
import { NewBookingModal } from "@/components/dashboard/new-booking-modal"
import type { Artist } from "@/lib/actions/artists"
const artist = { id: "11111111-1111-4111-8111-111111111111", stage_name: "DJ Moon", name: "Luna", base_rate: null } as Artist
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
] as const)("presents artist currency %s and base rate %s as %s", (currency, base_rate, display) => {
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={{ ...artist, base_rate, currency }} />)
  expect(screen.getByText(display, { exact: true })).toBeTruthy()
})

it("displays a pound-denominated artist base rate without changing it to dollars", () => {
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={{ ...artist, base_rate: 400, currency: "£" }} />)
  expect(screen.getByText("£400", { exact: true })).toBeTruthy()
})
it("preserves a booking draft when revalidation returns the same artist", () => {
  const props = { open: true, onOpenChange: vi.fn(), preselectedArtist: artist }
  const view = render(<NewBookingModal {...props} />)
  fireEvent.change(screen.getByPlaceholderText("Pick a date"), { target: { value: "2030-01-02" } })
  fireEvent.change(screen.getByPlaceholderText("Type your message here."), { target: { value: "Persist this draft" } })
  view.rerender(<NewBookingModal {...props} preselectedArtist={{ ...artist }} />)
  expect((screen.getByPlaceholderText("Pick a date") as HTMLInputElement).value).toBe("2030-01-02")
  expect((screen.getByPlaceholderText("Type your message here.") as HTMLTextAreaElement).value).toBe("Persist this draft")
})
it.each(["returned", "thrown"])("shows %s creation failure and recovers saving state", async (failure) => {
  if (failure === "returned") createBooking.mockResolvedValueOnce({ success: false, error: "Cannot create booking" })
  else createBooking.mockRejectedValueOnce(new Error("offline"))
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={artist} />)
  fireEvent.change(screen.getByPlaceholderText("Pick a date"), { target: { value: "2026-10-12" } })
  fireEvent.click(screen.getByRole("button", { name: "Save on calendar" }))
  expect((await screen.findByRole("alert")).textContent).toContain(failure === "returned" ? "Cannot create booking" : "Unable to save booking")
  expect((screen.getByRole("button", { name: "Save on calendar" }) as HTMLButtonElement).disabled).toBe(false)
})
