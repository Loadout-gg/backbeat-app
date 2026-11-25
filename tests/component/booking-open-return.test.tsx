// @vitest-environment jsdom
// UX2 items 1-3: the creation confirmation opens the saved booking, returns to the
// page the user started from and does not promise the upcoming calendar for past dates.
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ArtistOption } from "@/lib/actions/artists"
import type { Booking } from "@/lib/actions/bookings"

const { createBooking, getArtists, router } = vi.hoisted(() => ({
  createBooking: vi.fn(),
  getArtists: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/actions/bookings", () => ({ createBooking }))
vi.mock("@/lib/actions/artists", () => ({ getArtists }))

import { NewBookingModal } from "@/components/dashboard/new-booking-modal"

const BOOKING_ID = "44444444-4444-4444-8444-444444444444"
const artist = {
  id: "11111111-1111-4111-8111-111111111111",
  stage_name: "Nova Sound",
  name: "Nova",
  real_name: "Nova",
  surname: null,
  genre: null,
  genres: [],
  location: null,
  base_rate: null,
  currency: null,
  profile_image_url: null,
} as unknown as ArtistOption

function saved(date: string): Booking {
  return {
    id: BOOKING_ID, workspace_id: "33333333-3333-4333-8333-333333333333", artist_id: artist.id, date,
    start_time: "10:30:00", duration_minutes: null, notes: null, fee_amount_minor: null, fee_currency: null,
    venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
    status: "in_progress", created_at: "", updated_at: "",
  }
}

beforeEach(() => {
  createBooking.mockReset()
  getArtists.mockReset().mockResolvedValue([])
  router.push.mockReset()
  router.refresh.mockReset()
})
afterEach(cleanup)

async function createFrom(origin: "dashboard" | "artist" | undefined, date: string, calendarToday: string | null = "2026-11-23") {
  createBooking.mockResolvedValueOnce({ success: true, booking: saved(date) })
  const onOpenChange = vi.fn()
  render(<NewBookingModal open onOpenChange={onOpenChange} preselectedArtist={artist} calendarToday={calendarToday ?? undefined} returnTo={origin} />)
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: date } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  return onOpenChange
}

it.each([["dashboard"], ["artist"]] as const)("from the %s, the confirmation names artist and date and opens the saved booking id", async (origin) => {
  const onOpenChange = await createFrom(origin, "2030-01-02")
  expect(screen.getByRole("heading", { name: "Booking saved for Nova Sound on January 2, 2030 (Wednesday)" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Start event setup" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Open booking" }))
  expect(router.push).toHaveBeenCalledExactlyOnceWith(`/dashboard/bookings/${BOOKING_ID}`)
  expect(router.push.mock.calls[0][0]).not.toMatch(/events/)
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
})

it.each([
  [undefined, "Back to dashboard"],
  ["dashboard", "Back to dashboard"],
  ["artist", "Back to artist profile"],
] as const)("returnTo=%s closes the confirmation in place with %j and refreshes that page", async (origin, label) => {
  const onOpenChange = await createFrom(origin, "2030-01-02")
  expect(screen.queryByRole("button", { name: origin === "artist" ? "Back to dashboard" : "Back to artist profile" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: label }))
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  expect(router.refresh).toHaveBeenCalledOnce()
  expect(router.push).not.toHaveBeenCalled()
})

it.each([["dashboard"], ["artist"]] as const)("the confirmation close icon from the %s also stays on the starting page", async (origin) => {
  const onOpenChange = await createFrom(origin, "2030-01-02")
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  expect(router.push).not.toHaveBeenCalled()
})

it("for a past date does not promise the upcoming calendar and points to Bookings", async () => {
  await createFrom("artist", "2026-11-01")
  expect(screen.getByText(/This date is in the past, so the booking does not appear in the artist.s upcoming calendar\. Find it in Bookings\./)).toBeTruthy()
  expect(screen.queryByText(/It appears in/)).toBeNull()
})

it("for today or a future date says where it appears", async () => {
  await createFrom("dashboard", "2026-11-23")
  expect(screen.getByText(/It appears in the artist.s upcoming calendar and in Bookings\./)).toBeTruthy()
  expect(screen.queryByText(/in the past/)).toBeNull()
})

it("without a server today makes no calendar promise", async () => {
  await createFrom("dashboard", "2030-01-02", null)
  expect(screen.getByText("Find it in Bookings.")).toBeTruthy()
  expect(screen.queryByText(/upcoming calendar/)).toBeNull()
})

it("an unconfirmed save keeps the details and points to Bookings, not to a blind retry", async () => {
  createBooking.mockRejectedValueOnce(new Error("PRIVATE_NETWORK_DETAIL"))
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={artist} calendarToday="2026-11-23" />)
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value: "2026-11-01" } })
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Keep me" } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save on calendar" })) })
  const alert = screen.getByRole("alert")
  expect(alert.textContent).toContain("could not be confirmed")
  expect(alert.textContent).toContain("check Bookings before saving again")
  expect(alert.textContent).not.toMatch(/calendar|PRIVATE/)
  expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Keep me")
  expect((screen.getByLabelText("Select date") as HTMLInputElement).value).toBe("2026-11-01")
})
