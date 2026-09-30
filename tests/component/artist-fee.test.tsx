// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ArtistProfileClient } from "@/app/dashboard/artists/[id]/artist-profile-client"
import type { Artist } from "@/lib/actions/artists"
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard/artists/artist-a",
}))
vi.mock("@/components/dashboard/new-booking-modal", () => ({ NewBookingModal: () => null }))
afterEach(cleanup)
it.each([
  ["£", 400, "£400"], ["GBP", 400, "£400"],
  ["€", 400, "€400"], ["EUR", 400, "€400"],
  ["$", 400, "$400"], ["USD", 400, "$400"],
  ["CHF", 400, "CHF 400"], ["credits", 400, "credits 400"],
  [null, 400, "400 (currency unavailable)"], ["", 400, "400 (currency unavailable)"],
  ["   ", 400, "400 (currency unavailable)"], ["GBP", 0, "£0"],
  [null, 0, "0 (currency unavailable)"], ["USD", 1234.5, "$1,234.5"],
  ["GBP", null, "N/A"], ["GBP", undefined, "N/A"], [undefined, 400, "400 (currency unavailable)"],
] as const)("presents artist currency %s and fee %s as %s per event", (currency, fee, display) => {
  render(<ArtistProfileClient artist={{ id: "artist-a", stage_name: "DJ Moon", fee, currency } as Artist} bookings={[]} events={[]} calendarToday="2026-09-29" />)
  const rate = screen.getByText("Base rate").parentElement
  expect(rate?.textContent).toBe(`Base rate${fee == null ? "Not specified" : `${display}/event`}`)
})

it("shows an unavailable denomination instead of guessing dollars", () => {
  render(<ArtistProfileClient artist={{ id: "artist-a", stage_name: "DJ Moon", fee: 400, currency: null } as Artist} bookings={[]} events={[]} calendarToday="2026-09-29" />)
  expect(screen.getByText("400 (currency unavailable)/event", { exact: true })).toBeTruthy()
})
it("displays a persisted zero base rate instead of a missing rate", () => {
  render(<ArtistProfileClient artist={{ id: "artist-a", stage_name: "DJ Moon", fee: 0, currency: "$" } as Artist} bookings={[]} events={[]} calendarToday="2026-09-29" />)
  expect(screen.getByText("$0/event")).toBeTruthy()
})
