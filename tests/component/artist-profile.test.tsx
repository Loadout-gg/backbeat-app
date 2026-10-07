// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { ArtistProfileClient } from "@/app/dashboard/artists/[id]/artist-profile-client"
import type { Artist } from "@/lib/actions/artists"

const navigation = vi.hoisted(() => ({ params: "", push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.params),
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/dashboard/artists/artist-a",
}))
vi.mock("@/components/dashboard/new-booking-modal", () => ({ NewBookingModal: () => null }))
const artist = { id: "artist-a", name: "Alice", stage_name: "DJ Alice" } as Artist
beforeEach(() => { navigation.params = "" })
afterEach(cleanup)

it.each(["DJ Alice", "TheMidnightEchoCollective".repeat(5)])(
  "uses a wrapping mobile layout contract for profile actions and every tab with name %s",
  (stageName) => {
    // jsdom checks the reflow contract, not pixel geometry. Chrome must verify
    // scrollWidth/reachability at 320px and 390px for both name lengths.
    navigation.params = "tab=calendar"
    const { container } = render(<ArtistProfileClient artist={{ ...artist, stage_name: stageName }} bookings={[]} events={[]} calendarToday="2026-09-29" />)
    const root = container.firstElementChild!
    expect(root.classList.contains("min-w-0")).toBe(true)
    expect(root.classList.contains("p-4")).toBe(true)
    expect(root.classList.contains("[overflow-wrap:anywhere]")).toBe(true)
    const heading = screen.getByRole("heading", { level: 1, name: stageName })
    expect(heading.parentElement?.classList.contains("min-w-0")).toBe(true)
    const header = heading.parentElement!.parentElement!.parentElement!
    expect(header.classList.contains("flex-col")).toBe(true)
    const actions = screen.getByRole("button", { name: "New Booking" }).parentElement!
    expect(actions.classList.contains("flex-wrap")).toBe(true)
    expect(within(actions).getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/dashboard/artists/artist-a/edit")
    expect(within(actions).getByRole("button", { name: "Message" }).hasAttribute("disabled")).toBe(true)
    const tabs = screen.getByRole("tablist")
    expect(tabs.classList.contains("flex-wrap")).toBe(true)
    expect(within(tabs).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Overview", "Calendar", "Documents", "Special requirements"])
    for (const tab of within(tabs).getAllByRole("tab")) expect(tab.classList.contains("flex-none")).toBe(true)
    const calendar = container.querySelector('[data-slot="calendar"]')!
    expect(calendar.classList.contains("w-full")).toBe(true)
    expect(calendar.classList.contains("p-0")).toBe(true)
    for (const day of within(screen.getByRole("grid")).getAllByRole("gridcell")) {
      expect(day.classList.contains("min-w-0")).toBe(true)
      expect(day.classList.contains("flex-1")).toBe(true)
    }
    for (const content of container.querySelectorAll('[data-slot="card-content"]')) {
      expect(content.classList.contains("p-4")).toBe(true)
      expect(content.classList.contains("sm:p-6")).toBe(true)
    }
  },
)

it("does not expose the four unavailable footer destinations as links", () => {
  render(<ArtistProfileClient artist={artist} bookings={[]} events={[]} calendarToday="2026-09-29" />)
  const footer = screen.getByRole("contentinfo")
  expect(within(footer).queryAllByRole("link")).toEqual([])
  expect(within(footer).getByText("Terms, Privacy, Help and Contact are currently unavailable.")).toBeTruthy()
  expect(within(footer).getByText("© 2025 Backbeat. All rights reserved.")).toBeTruthy()
})
