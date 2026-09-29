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
it("displays a persisted zero base rate instead of a missing rate", () => {
  render(<ArtistProfileClient artist={{ id: "artist-a", stage_name: "DJ Moon", fee: 0, currency: "$" } as Artist} bookings={[]} events={[]} calendarToday="2026-09-29" />)
  expect(screen.getByText("$0/event")).toBeTruthy()
})
