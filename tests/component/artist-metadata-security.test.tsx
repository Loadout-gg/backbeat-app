// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Artist } from "@/lib/actions/artists"
const { getArtist, updateArtist, router, navigation } = vi.hoisted(() => ({
  getArtist: vi.fn(), updateArtist: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  navigation: { params: "" },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(navigation.params),
  usePathname: () => "/dashboard/artists/artist-a",
}))
vi.mock("@/lib/actions/artists", () => ({ getArtist, updateArtist }))
vi.mock("@/components/dashboard/new-booking-modal", () => ({ NewBookingModal: () => null }))
import { ArtistProfileClient } from "@/app/dashboard/artists/[id]/artist-profile-client"
import EditArtistPage from "@/app/dashboard/artists/[id]/edit/page"

beforeEach(() => {
  getArtist.mockReset()
  updateArtist.mockReset().mockResolvedValue({ success: false, error: "Synthetic stop" })
  router.push.mockReset()
  navigation.params = ""
})
afterEach(cleanup)
const links = [
  { type: 42, url: "https://example.test" },
  { type: "Broken", url: {} },
  { type: "Website", url: "example.test/artist" },
  { type: "Unsafe", url: "javascript:alert(1)" },
]
const documents = [
  { name: { invalid: true }, url: "https://example.test" },
  { name: "Broken URL", url: 42 },
  { name: "Rider", url: "/storage/rider.pdf" },
  { name: "Name only" },
  { name: "Legacy archive", url: "ftp://example.test/rider" },
]
function fixture(social: unknown, docs: unknown): Artist {
  return {
    id: "artist-a", name: "Synthetic", stage_name: "Synthetic Act",
    social_links: social, documents: docs, genres: [], fee: 0, currency: null,
  } as unknown as Artist
}

it.each([false, true])("BB-05: safely renders mixed social metadata, JSON=%s", (serialized) => {
  render(<ArtistProfileClient artist={fixture(serialized ? JSON.stringify(links) : links, [])}
    bookings={[]} events={[]} calendarToday="2030-01-01" />)
  expect(screen.getByRole("heading", { name: "Synthetic Act" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Website" }).getAttribute("href"))
    .toBe("https://example.test/artist")
  expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull()
  expect(screen.getByTitle("Unsafe").getAttribute("aria-disabled")).toBe("true")
})

it.each([false, true])("BB-05: safely renders legacy documents, JSON=%s", (serialized) => {
  navigation.params = "tab=documents"
  render(<ArtistProfileClient artist={fixture([], serialized ? JSON.stringify(documents) : documents)}
    bookings={[]} events={[]} calendarToday="2030-01-01" />)
  expect(screen.getByText("Rider")).toBeTruthy()
  expect(screen.getByText("Name only")).toBeTruthy()
  expect(screen.getByText("Legacy archive")).toBeTruthy()
  const views = screen.getAllByRole("link", { name: "View" })
  expect(views).toHaveLength(1)
  expect(views[0].getAttribute("href")).toBe("/storage/rider.pdf")
  expect(screen.getAllByRole("button", { name: "View" })
    .every(button => (button as HTMLButtonElement).disabled)).toBe(true)
})

it.each([false, true])("BB-05: unrelated editor saves do not clean legacy metadata, JSON=%s", async serialized => {
  getArtist.mockResolvedValueOnce(fixture(
    serialized ? JSON.stringify(links) : links,
    serialized ? JSON.stringify(documents) : documents,
  ))
  render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  fireEvent.change(await screen.findByRole("textbox", { name: /^Name$/ }), {
    target: { value: "Changed name only" },
  })
  expect(screen.getByText("Website: example.test/artist")).toBeTruthy()
  for (let step = 1; step < 4; step++) {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  }
  fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
  await waitFor(() => expect(updateArtist).toHaveBeenCalledOnce())
  const payload = updateArtist.mock.calls[0][1]
  expect(payload.name).toBe("Changed name only")
  expect(payload).not.toHaveProperty("social_links")
  expect(payload).not.toHaveProperty("documents")
})
