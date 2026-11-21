// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { ArtistProfileClient } from "@/app/dashboard/artists/[id]/artist-profile-client"
import type { Artist } from "@/lib/actions/artists"
import type { EventWithRelations } from "@/lib/actions/events"

vi.mock("@/components/dashboard/new-booking-modal", () => ({ NewBookingModal: () => null }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard/artists/artist-a",
}))
afterEach(cleanup)

const artist = { id: "artist-a", name: "Alice", stage_name: "DJ Alice" } as Artist
const event = (overrides: Partial<EventWithRelations>): EventWithRelations => ({
  id: "event-a", artist_id: "artist-a", date: "2026-10-02", title: "Autumn show", location: "Rome",
  status: "confirmed", promoter_id: null, workspace_id: "w", created_at: "", artists: null, promoters: null,
  ...overrides,
})
const renderOverview = (events: EventWithRelations[], calendarError = false) => {
  render(<ArtistProfileClient artist={artist} bookings={[]} events={events} calendarError={calendarError} calendarToday="2026-10-01" />)
  return screen.getByRole("region", { name: "Upcoming events" })
}

it("lists only this artist's active events from today on, soonest first", () => {
  const section = renderOverview([
    event({ id: "later", date: "2026-11-05", title: "Later show", location: null, status: "in_progress" }),
    event({ id: "today", date: "2026-10-01", title: "Tonight" }),
    event({ id: "past", date: "2026-09-30", title: "Yesterday" }),
    event({ id: "cancelled", date: "2026-10-10", title: "Cancelled show", status: "cancelled" }),
    event({ id: "other", artist_id: "artist-b", date: "2026-10-03", title: "Someone else" }),
  ])
  const items = within(section).getAllByRole("listitem")
  expect(items.map(item => within(item).getByText(/Tonight|Later show/).textContent)).toEqual(["Tonight", "Later show"])
  expect(within(items[0]).getByText("Oct")).toBeTruthy()
  expect(within(items[0]).getByText("1", { exact: true })).toBeTruthy()
  expect(within(items[0]).getByText("Rome")).toBeTruthy()
  expect(within(items[0]).getByText("Confirmed")).toBeTruthy()
  expect(within(items[1]).getByText("In progress")).toBeTruthy()
  expect(within(section).queryByText(/Yesterday|Cancelled show|Someone else/)).toBeNull()
  expect(within(section).getByRole("link", { name: "View all in calendar" }).getAttribute("href")).toBe("/dashboard/artists/artist-a?tab=calendar")
  expect(within(section).queryByText(/Showing the next/)).toBeNull()
})

it("shows the next five and says how many there are in total", () => {
  const section = renderOverview(Array.from({ length: 7 }, (_, index) =>
    event({ id: `event-${index}`, date: `2026-10-0${7 - index}`, title: `Show ${7 - index}` })))
  expect(within(section).getAllByRole("listitem").map(item => within(item).getByText(/^Show \d$/).textContent))
    .toEqual(["Show 1", "Show 2", "Show 3", "Show 4", "Show 5"])
  expect(within(section).getByText("Showing the next 5 of 7 upcoming events.")).toBeTruthy()
})

it("shows an honest empty state without a calendar link", () => {
  const section = renderOverview([event({ date: "2026-09-01" })])
  expect(within(section).getByText("No upcoming events.")).toBeTruthy()
  expect(within(section).queryByRole("link")).toBeNull()
  expect(within(section).queryByRole("alert")).toBeNull()
})

it("shows a read error with retry instead of claiming there are no events", () => {
  const section = renderOverview([], true)
  expect(within(section).getByRole("alert").textContent).toContain("Unable to load this artist\u2019s events")
  expect(within(section).getByRole("button", { name: "Retry loading events" })).toBeTruthy()
  expect(within(section).queryByText("No upcoming events.")).toBeNull()
  expect(within(section).queryByRole("link")).toBeNull()
})
