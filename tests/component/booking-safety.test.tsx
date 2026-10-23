// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { BookingWithArtist } from "@/lib/actions/bookings"

const { updateBooking, deleteBooking, router } = vi.hoisted(() => ({
  updateBooking: vi.fn(),
  deleteBooking: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), back: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/actions/bookings", () => ({ updateBooking, deleteBooking }))

import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"

const booking: BookingWithArtist = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  artist_id: "33333333-3333-4333-8333-333333333333",
  date: "2030-01-18",
  start_time: "21:30:00",
  duration_minutes: 90,
  notes: "Retain this draft",
  fee_amount_minor: null,
  fee_currency: null,
  venue_name: "North Hall",
  venue_address: "42 Harbour Road",
  contact_name_main: "Alex",
  contact_phone_main: null,
  contact_email_main: null,
  status: "in_progress",
  created_at: "",
  updated_at: "",
  artist: {
    id: "33333333-3333-4333-8333-333333333333",
    stage_name: "Blue Orbit",
    name: "Legacy Artist",
    surname: null,
    location: null,
    fee: 400,
    currency: "EUR",
    profile_image_url: null,
  },
}

beforeEach(() => {
  updateBooking.mockReset()
  deleteBooking.mockReset()
  router.push.mockReset()
  router.refresh.mockReset()
  router.back.mockReset()
})
afterEach(cleanup)

it.each([
  { stage_name: null, name: "Legacy Artist", expected: "Legacy Artist" },
  { stage_name: "", name: "Legacy Artist", expected: "Legacy Artist" },
  { stage_name: null, name: null, expected: "Unknown" },
])("BB-08: renders and edits a nullable stage name using $expected", async (value) => {
  // Deliberately models the nullable stored row, which the baseline type overstates.
  const legacy = {
    ...booking,
    artist: {
      ...booking.artist,
      stage_name: value.stage_name,
      name: value.name,
    },
  } as unknown as BookingWithArtist

  updateBooking.mockResolvedValueOnce({ success: true })
  render(<EventBookingClient booking={legacy} />)
  expect(screen.getByRole("heading", { name: value.expected })).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Note", { exact: true }), {
    target: { value: "Updated legacy booking" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Update booking" }))
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce())
  expect(updateBooking).toHaveBeenCalledWith(
    booking.id,
    expect.objectContaining({ notes: "Updated legacy booking" }),
  )
})
