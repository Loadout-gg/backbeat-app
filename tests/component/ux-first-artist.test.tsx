// @vitest-environment jsdom
// EXP-01 / EXP-02 (Alberto's product review 2026-11-23, item 1): first-artist path,
// distinct artist list states and a single-submit add-artist form.
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { Artist } from "@/lib/actions/artists"
import type { ArtistDirectoryEntry } from "@/lib/artist-list"

const mocks = vi.hoisted(() => ({
  createArtist: vi.fn(),
  getArtists: vi.fn(),
  getBookings: vi.fn(),
  directory: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  bookingModal: vi.fn(),
}))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/artists/new-artist-id",
}))
vi.mock("@/lib/actions/artists", () => ({ createArtist: mocks.createArtist, getArtists: mocks.getArtists }))
vi.mock("@/lib/actions/bookings", () => ({ getBookings: mocks.getBookings, createBooking: vi.fn() }))
vi.mock("@/lib/actions/artist-directory", () => ({ listArtistDirectory: mocks.directory }))
vi.mock("@/lib/actions/artist-export", () => ({ exportArtistsCsv: vi.fn() }))
vi.mock("@/components/dashboard/new-booking-modal", () => ({
  NewBookingModal: (props: { open: boolean; preselectedArtist?: { id: string } | null }) => {
    mocks.bookingModal(props)
    return props.open ? <div role="dialog" aria-label="New booking">{props.preselectedArtist?.id ?? "none"}</div> : null
  },
}))

import { DashboardContent } from "@/app/dashboard/dashboard-content"
import BookingsPage from "@/app/dashboard/bookings/page"
import ArtistsPage from "@/app/dashboard/artists/page"
import NewArtistPage from "@/app/dashboard/artists/new/page"
import { ArtistProfileClient } from "@/app/dashboard/artists/[id]/artist-profile-client"

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.getArtists.mockResolvedValue([])
})
afterEach(cleanup)

const dashboardProps = (totalArtists: number) => ({
  welcomeMessage: "Welcome back",
  stats: { eventsInProgress: 0, bookingsInProgress: 0, totalArtists, totalPromoters: 0 },
  eventsInProgress: [],
  bookings: [],
  calendarToday: "2026-11-23",
})
const entry = (id: string, stage_name: string): ArtistDirectoryEntry => ({
  id, name: null, surname: null, stage_name, genres: ["House"], location: "Rome", fee: null, currency: null,
})

// Item 1
it("1: with zero artists the dashboard's first action is Add first artist", () => {
  render(<DashboardContent {...dashboardProps(0)} />)
  const actions = within(screen.getByRole("region", { name: "Quick actions" }))
  const controls = [...actions.getAllByRole("link"), ...actions.getAllByRole("button")]
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  expect(controls[0].textContent).toBe("Add first artist")
  expect(controls[0].getAttribute("href")).toBe("/dashboard/artists/new")
  const bookings = within(screen.getByRole("region", { name: "Bookings in progress" }))
  expect(bookings.getByRole("link", { name: "Add first artist" }).getAttribute("href")).toBe("/dashboard/artists/new")
  expect(bookings.queryByRole("button", { name: "New booking" })).toBeNull()
})

it("1: with artists the dashboard keeps New booking first and the plain Add artist label", () => {
  render(<DashboardContent {...dashboardProps(3)} />)
  const actions = within(screen.getByRole("region", { name: "Quick actions" }))
  expect(actions.queryByRole("link", { name: "Add first artist" })).toBeNull()
  const newBooking = actions.getByRole("button", { name: "New booking" })
  const addArtist = actions.getByRole("link", { name: "Add artist" })
  expect(Boolean(newBooking.compareDocumentPosition(addArtist) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
})

it("1: the empty Bookings list offers the add-artist way out", async () => {
  mocks.getBookings.mockResolvedValueOnce([])
  render(await BookingsPage())
  expect(screen.getByText("No bookings in your workspace yet.")).toBeTruthy()
  expect(screen.getByRole("link", { name: "Add artist" }).getAttribute("href")).toBe("/dashboard/artists/new")
  expect(screen.getByRole("link", { name: "View artists" }).getAttribute("href")).toBe("/dashboard/artists")
})

it("1: a Bookings read error does not offer the empty-list way out", async () => {
  mocks.getBookings.mockRejectedValueOnce(new Error("private"))
  render(await BookingsPage())
  expect(screen.getByRole("alert")).toBeTruthy()
  expect(screen.queryByRole("link", { name: "Add artist" })).toBeNull()
})

// Item 2
it("2: a load error, an empty roster and a search with no results are three distinct states", async () => {
  mocks.directory.mockRejectedValueOnce(new Error("private directory failure"))
  const failed = render(await ArtistsPage())
  const error = screen.getByRole("alert")
  expect(error.textContent).toBe("Unable to load artists. Your roster was not changed; please try again.")
  expect(screen.getByRole("button", { name: "Retry loading artists" })).toBeTruthy()
  expect(screen.queryByText(/No artists yet/)).toBeNull()
  expect(screen.queryByText(/No artists match/)).toBeNull()
  expect(screen.queryByText(/private directory failure/)).toBeNull()
  expect((screen.getByRole("searchbox", { name: "Search artists" }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "Retry loading artists" }))
  expect(mocks.refresh).toHaveBeenCalledOnce()
  failed.unmount()

  mocks.directory.mockResolvedValueOnce([])
  const empty = render(await ArtistsPage())
  expect(screen.getByText("No artists yet. Add your first artist to get started.")).toBeTruthy()
  expect(screen.getByRole("link", { name: "Add first artist" }).getAttribute("href")).toBe("/dashboard/artists/new")
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByText(/No artists match/)).toBeNull()
  empty.unmount()

  mocks.directory.mockResolvedValueOnce([entry("a", "Aurora"), entry("b", "Boreal")])
  render(await ArtistsPage())
  fireEvent.change(screen.getByRole("searchbox", { name: "Search artists" }), { target: { value: "zzz" } })
  expect(screen.getByText("No artists match your search.")).toBeTruthy()
  expect(screen.getByText(/clear the search to see all 2 artists/)).toBeTruthy()
  expect(screen.queryByText(/No artists yet/)).toBeNull()
  expect(screen.queryByRole("alert")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Show all artists" }))
  expect(screen.getByRole("link", { name: "Aurora" })).toBeTruthy()
  expect((screen.getByRole("searchbox", { name: "Search artists" }) as HTMLInputElement).value).toBe("")
})

// Items 3-6: add-artist form
function fillStageNameAndSave(stageName = "Only Required") {
  fireEvent.change(screen.getByRole("textbox", { name: "Stage name" }), { target: { value: stageName } })
  for (let step = 1; step < 4; step++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("button", { name: "Save and complete" }))
}

it("3: stage name is marked required from the first render", () => {
  render(<NewArtistPage />)
  const input = screen.getByRole("textbox", { name: "Stage name" }) as HTMLInputElement
  expect(input.required).toBe(true)
  expect(input.getAttribute("aria-required")).toBe("true")
  expect(screen.getByText("*").getAttribute("aria-hidden")).toBe("true")
  expect(input.getAttribute("aria-describedby")).toBe("stage_name-hint")
  expect(document.getElementById("stage_name-hint")?.textContent).toMatch(/^Required\./)
  for (const name of ["Name", "Surname", "Artist location", "Email"]) {
    const other = screen.getByLabelText(name) as HTMLInputElement
    expect(other.required).toBe(false)
  }
})

it("4: image and document upload are not offered as working actions", () => {
  render(<NewArtistPage />)
  expect(screen.queryByRole("button", { name: /Upload image/ })).toBeNull()
  expect(screen.getByText("Image upload is not available yet")).toBeTruthy()
  fireEvent.change(screen.getByRole("textbox", { name: "Stage name" }), { target: { value: "X" } })
  for (const step of [3, 4]) {
    while (!screen.queryByRole("heading", { name: step === 3 ? "Documents" : "Supporting documentation" })) {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    }
    const upload = screen.getByRole("button", { name: "Upload documents (unavailable)" }) as HTMLButtonElement
    expect(upload.disabled).toBe(true)
    expect(screen.getByText("Document upload is not available yet")).toBeTruthy()
    expect(screen.queryByText(/click to upload/)).toBeNull()
  }
})

it("5: saving only the required field lands on the new artist's profile", async () => {
  mocks.createArtist.mockResolvedValueOnce({ success: true, artistId: "new-artist-id" })
  render(<NewArtistPage />)
  fillStageNameAndSave()
  expect(await screen.findByText("Artist successfully added.")).toBeTruthy()
  expect(mocks.createArtist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stage_name: "Only Required", name: undefined, documents: undefined }))
  fireEvent.click(screen.getByRole("button", { name: "Ok" }))
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/dashboard/artists/new-artist-id")
})

it("5: the profile it lands on starts a booking with that artist preselected", () => {
  const artist = { id: "new-artist-id", name: "Only Required", stage_name: "Only Required" } as Artist
  render(<ArtistProfileClient artist={artist} bookings={[]} events={[]} calendarToday="2026-11-23" />)
  fireEvent.click(screen.getAllByRole("button", { name: "New booking" })[0])
  expect(screen.getByRole("dialog", { name: "New booking" }).textContent).toBe("new-artist-id")
  expect(mocks.bookingModal).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, preselectedArtist: artist }))
})

it.each([
  ["Ok", () => fireEvent.click(screen.getByRole("button", { name: "Ok" }))],
  ["X", () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }))],
  ["Esc", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })],
])("6: closing the confirmation with %s cannot submit the artist a second time", async (_way, close) => {
  mocks.createArtist.mockResolvedValue({ success: true, artistId: "new-artist-id" })
  render(<NewArtistPage />)
  fillStageNameAndSave()
  expect(await screen.findByText("Artist successfully added.")).toBeTruthy()
  close()
  await waitFor(() => expect(screen.queryByText("Artist successfully added.")).toBeNull())
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/dashboard/artists/new-artist-id")
  const save = screen.getByRole("button", { name: "Save and complete" }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.click(save)
  expect(mocks.createArtist).toHaveBeenCalledOnce()
})
