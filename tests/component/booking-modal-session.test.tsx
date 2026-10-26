// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Artist } from "@/lib/actions/artists"
import type { Booking } from "@/lib/actions/bookings"

const { createBooking, getArtists, router } = vi.hoisted(() => ({
  createBooking: vi.fn(),
  getArtists: vi.fn(),
  router: { push: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/actions/bookings", () => ({ createBooking }))
vi.mock("@/lib/actions/artists", () => ({ getArtists }))

import { NewBookingModal } from "@/components/dashboard/new-booking-modal"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const artistA: Artist = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  stage_name: "Artist A",
  name: "A",
  real_name: "A",
  surname: null,
  email: null,
  phone: null,
  notes: null,
  created_at: "",
  updated_at: null,
  location: null,
  genre: null,
  genres: [],
  fee: null,
  base_rate: null,
  currency: null,
  travel_fee: null,
  pricing_notes: null,
  social_links: [],
  overview: null,
  dj_equipment: null,
  sound_system: null,
  allergies: null,
  special_diet: null,
  special_needs: null,
  documents: [],
  profile_image_url: null,
}
const artistB: Artist = {
  ...artistA,
  id: "22222222-2222-4222-8222-222222222222",
  stage_name: "Artist B",
  name: "B",
  real_name: "B",
}
function bookingFor(artist: Artist, id: string, date = "2030-01-02"): Booking {
  return {
    id,
    workspace_id: artist.workspace_id,
    artist_id: artist.id,
    date,
    start_time: "10:30:00",
    duration_minutes: null,
    notes: null,
    fee_amount_minor: null,
    fee_currency: null,
    venue_name: null,
    venue_address: null,
    contact_name_main: null,
    contact_phone_main: null,
    contact_email_main: null,
    status: "in_progress",
    created_at: "",
    updated_at: "",
  }
}
type SaveResult = Awaited<ReturnType<typeof import("@/lib/actions/bookings").createBooking>>

beforeEach(() => {
  createBooking.mockReset()
  getArtists.mockReset().mockResolvedValue([])
  router.push.mockReset()
})
afterEach(cleanup)

function enterDate(value: string) {
  fireEvent.change(screen.getByLabelText("Select date"), { target: { value } })
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Save on calendar" }))
}

it.each([
  ["reopen-same", "success"],
  ["reopen-other", "success"],
  ["switch-other", "success"],
  ["reopen-same", "returned"],
  ["reopen-other", "thrown"],
  ["switch-other", "returned"],
  ["switch-other", "thrown"],
] as const)(
  "BB-09: ignores old %s-session %s completion without releasing a newer save",
  async (transition, outcome) => {
    const old = deferred<SaveResult>()
    const next = deferred<SaveResult>()
    createBooking.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const onOpenChange = vi.fn()
    const props = { open: true, onOpenChange, preselectedArtist: artistA }
    const view = render(<NewBookingModal {...props} />)

    enterDate("2030-01-02")
    submit()
    expect(createBooking).toHaveBeenCalledOnce()

    if (transition !== "switch-other") {
      view.rerender(<NewBookingModal {...props} open={false} />)
    }
    const nextArtist = transition === "reopen-same" ? artistA : artistB
    view.rerender(<NewBookingModal {...props} preselectedArtist={nextArtist} />)

    enterDate("2030-01-03")
    expect((screen.getByRole("button", { name: "Save on calendar" }) as HTMLButtonElement).disabled)
      .toBe(false)
    submit()
    expect(createBooking).toHaveBeenCalledTimes(2)

    await act(async () => {
      if (outcome === "thrown") old.reject(new Error("PRIVATE_OLD_FAILURE"))
      else if (outcome === "returned") old.resolve({ success: false, error: "OLD_RETURNED_FAILURE" })
      else old.resolve({ success: true, booking: bookingFor(artistA, "old-booking") })
    })

    expect((screen.getByLabelText("Select date") as HTMLInputElement).value).toBe("2030-01-03")
    expect((screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText(/Booking successfully added/)).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      next.resolve({
        success: true,
        booking: bookingFor(nextArtist, "current-booking", "2030-01-03"),
      })
    })
    expect(screen.getByText(nextArtist.stage_name, { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Start event setup" }))
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/bookings/current-booking")
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  },
)

it.each(["success", "thrown"] as const)(
  "BB-09: does not run completion callbacks while closed after %s",
  async (outcome) => {
    const old = deferred<SaveResult>()
    createBooking.mockReturnValueOnce(old.promise)
    const onOpenChange = vi.fn()
    const props = { open: true, onOpenChange, preselectedArtist: artistA }
    const view = render(<NewBookingModal {...props} />)
    enterDate("2030-01-02")
    submit()
    view.rerender(<NewBookingModal {...props} open={false} />)

    await act(async () => {
      if (outcome === "success") {
        old.resolve({ success: true, booking: bookingFor(artistA, "old-booking") })
      } else old.reject(new Error("PRIVATE_CLOSED_FAILURE"))
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    view.rerender(<NewBookingModal {...props} />)
    expect((screen.getByLabelText("Select date") as HTMLInputElement).value).toBe("")
    expect(screen.queryByText(/Booking successfully added/)).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  },
)

it("BB-09: preserves a pending draft on same-ID RSC refresh and confirms the submitted snapshot", async () => {
  const pending = deferred<SaveResult>()
  createBooking.mockReturnValueOnce(pending.promise)
  const props = { open: true, onOpenChange: vi.fn(), preselectedArtist: artistA }
  const view = render(<NewBookingModal {...props} />)

  enterDate("2030-01-02")
  fireEvent.change(screen.getByPlaceholderText("Type your message here."), {
    target: { value: "Submitted note" },
  })
  submit()
  view.rerender(
    <NewBookingModal {...props} preselectedArtist={{ ...artistA, stage_name: "Refreshed name" }} />,
  )
  expect((screen.getByLabelText("Select date") as HTMLInputElement).value).toBe("2030-01-02")
  expect((screen.getByPlaceholderText("Type your message here.") as HTMLTextAreaElement).value)
    .toBe("Submitted note")
  expect(screen.getByRole("button", { name: "Saving..." })).toBeTruthy()

  await act(async () => {
    pending.resolve({ success: true, booking: bookingFor(artistA, "saved-booking") })
  })
  expect(screen.getByText("Artist A", { exact: true })).toBeTruthy()
  expect(screen.queryByText("Refreshed name")).toBeNull()
  expect(createBooking).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ artistId: artistA.id, notes: "Submitted note" }),
  )
})

it("BB-09: guards same-tick repeated save activation", async () => {
  const pending = deferred<SaveResult>()
  createBooking.mockReturnValueOnce(pending.promise)
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={artistA} />)
  enterDate("2030-01-02")
  const save = screen.getByRole("button", { name: "Save on calendar" })
  act(() => {
    save.click()
    save.click()
  })
  expect(createBooking).toHaveBeenCalledOnce()
  expect(screen.getByRole("status").textContent).toContain("does not cancel")

  await act(async () => pending.resolve({ success: false, error: "Try again" }))
  expect((screen.getByRole("button", { name: "Save on calendar" }) as HTMLButtonElement).disabled)
    .toBe(false)
})

it("BB-09: rejects mismatched response identity rather than presenting a mixed confirmation", async () => {
  createBooking.mockResolvedValueOnce({
    success: true,
    booking: bookingFor(artistB, "wrong-booking"),
  })
  render(<NewBookingModal open onOpenChange={vi.fn()} preselectedArtist={artistA} />)
  enterDate("2030-01-02")
  submit()
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to confirm")
  expect(screen.queryByRole("button", { name: "Start event setup" })).toBeNull()
  expect(router.push).not.toHaveBeenCalled()
})

it("BB-09: ignores a save that settles after unmount", async () => {
  const pending = deferred<SaveResult>()
  createBooking.mockReturnValueOnce(pending.promise)
  const onOpenChange = vi.fn()
  const view = render(<NewBookingModal open onOpenChange={onOpenChange} preselectedArtist={artistA} />)
  enterDate("2030-01-02")
  submit()
  view.unmount()
  await act(async () => pending.resolve({ success: true, booking: bookingFor(artistA, "late") }))
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(router.push).not.toHaveBeenCalled()
})

it("BB-12: distinguishes roster read failure from an empty roster and retries", async () => {
  getArtists.mockRejectedValueOnce(new Error("PRIVATE_ROSTER_ERROR")).mockResolvedValueOnce([])
  render(<NewBookingModal open onOpenChange={vi.fn()} />)

  expect((await screen.findByRole("alert")).textContent).toBe("Unable to load artists. Please try again.")
  expect(screen.queryByText("No artists available in your workspace")).toBeNull()
  expect(screen.queryByRole("button", { name: "Add artist" })).toBeNull()
  expect(screen.queryByText(/PRIVATE_ROSTER_ERROR/)).toBeNull()

  fireEvent.click(screen.getByRole("button", { name: "Retry loading artists" }))
  expect(await screen.findByText("No artists available in your workspace")).toBeTruthy()
  expect(screen.queryByRole("alert")).toBeNull()
  expect(getArtists).toHaveBeenCalledTimes(2)
})

it.each(["success", "thrown"] as const)(
  "BB-12: ignores a stale roster %s after another open has loaded",
  async (outcome) => {
    const old = deferred<Artist[]>()
    const current = deferred<Artist[]>()
    getArtists.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const props = { open: true, onOpenChange: vi.fn() }
    const view = render(<NewBookingModal {...props} />)
    view.rerender(<NewBookingModal {...props} open={false} />)
    view.rerender(<NewBookingModal {...props} />)
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(2))

    await act(async () => current.resolve([artistB]))
    expect(screen.getByText("Artist B", { exact: true })).toBeTruthy()

    await act(async () => {
      if (outcome === "success") old.resolve([artistA])
      else old.reject(new Error("STALE_ROSTER_FAILURE"))
    })
    expect(screen.getByText("Artist B", { exact: true })).toBeTruthy()
    expect(screen.queryByText("Artist A", { exact: true })).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  },
)

it("BB-12: old roster finalization cannot release a newer roster loading state", async () => {
  const old = deferred<Artist[]>()
  const current = deferred<Artist[]>()
  getArtists.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
  const props = { open: true, onOpenChange: vi.fn() }
  const view = render(<NewBookingModal {...props} />)
  view.rerender(<NewBookingModal {...props} open={false} />)
  view.rerender(<NewBookingModal {...props} />)

  await act(async () => old.resolve([artistA]))
  expect(screen.queryByText("Artist A", { exact: true })).toBeNull()
  expect(screen.queryByText("No artists available in your workspace")).toBeNull()

  await act(async () => current.resolve([]))
  expect(screen.getByText("No artists available in your workspace")).toBeTruthy()
})

it("BB-12: a stale roster rejection cannot affect a new preselected-artist session", async () => {
  const old = deferred<Artist[]>()
  getArtists.mockReturnValueOnce(old.promise)
  const props = { open: true, onOpenChange: vi.fn() }
  const view = render(<NewBookingModal {...props} />)
  view.rerender(<NewBookingModal {...props} preselectedArtist={artistB} />)
  enterDate("2030-01-03")

  await act(async () => old.reject(new Error("STALE_ROSTER_FAILURE")))
  expect(screen.getByText("Artist B", { exact: true })).toBeTruthy()
  expect((screen.getByLabelText("Select date") as HTMLInputElement).value).toBe("2030-01-03")
  expect(screen.queryByRole("alert")).toBeNull()
})
