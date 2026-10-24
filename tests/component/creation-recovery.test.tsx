// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { createArtist, createEvent, getArtists, listPromoters, router } = vi.hoisted(() => ({
  createArtist: vi.fn(),
  createEvent: vi.fn(),
  getArtists: vi.fn(),
  listPromoters: vi.fn(),
  router: { push: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/actions/artists", () => ({ createArtist, getArtists }))
vi.mock("@/lib/actions/events", () => ({ createEvent, listPromoters }))

import NewArtistPage from "@/app/dashboard/artists/new/page"
import NewEventPage from "@/app/dashboard/events/new/page"

beforeEach(() => {
  createArtist.mockReset()
  createEvent.mockReset()
  getArtists.mockReset().mockResolvedValue([])
  listPromoters.mockReset().mockResolvedValue([])
  router.push.mockReset()
})
afterEach(cleanup)

it.each(["returned", "thrown"])(
  "BB-10: artist %s creation failure retains the wizard draft and permits retry",
  async (kind) => {
    if (kind === "returned") {
      createArtist.mockResolvedValueOnce({ success: false, error: "Artist validation failed" })
    } else {
      createArtist.mockRejectedValueOnce(new Error("PRIVATE_ARTIST_FAILURE"))
    }
    createArtist.mockResolvedValueOnce({ success: true, artistId: "saved-artist" })

    render(<NewArtistPage />)
    fireEvent.change(screen.getByRole("textbox", { name: "Stage name" }), {
      target: { value: "Retained Stage" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: /^Name$/ }), {
      target: { value: "Retained Name" },
    })
    for (let step = 1; step < 4; step++) {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Special Needs & Accessibility" }), {
      target: { value: "Retained requirements" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(
      kind === "returned" ? /Artist validation failed/ : /Check the artist list before retrying/,
    )
    expect(screen.queryByText(/PRIVATE_ARTIST_FAILURE/)).toBeNull()
    expect(screen.queryByText("Artist successfully added.")).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
    expect((screen.getByRole("textbox", { name: "Special Needs & Accessibility" }) as HTMLTextAreaElement).value)
      .toBe("Retained requirements")
    expect((screen.getByRole("button", { name: "Save and Complete" }) as HTMLButtonElement).disabled)
      .toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
    expect(await screen.findByText("Artist successfully added.")).toBeTruthy()
    expect(createArtist).toHaveBeenCalledTimes(2)
    expect(createArtist.mock.calls[1][0]).toEqual(expect.objectContaining({
      stage_name: "Retained Stage",
      name: "Retained Name",
      special_needs: "Retained requirements",
    }))
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ok" }))
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/artists")
  },
)

it.each(["returned", "thrown"])(
  "BB-10: event %s creation failure retains native form values and permits retry",
  async (kind) => {
    if (kind === "returned") {
      createEvent.mockResolvedValueOnce({ success: false, error: "Event validation failed" })
    } else {
      createEvent.mockRejectedValueOnce(new Error("PRIVATE_EVENT_FAILURE"))
    }
    createEvent.mockResolvedValueOnce({ success: true, eventId: "saved-event" })

    render(<NewEventPage />)
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(false)
    })
    expect(getArtists).toHaveBeenCalledOnce()
    const title = screen.getByLabelText("Title *") as HTMLInputElement
    const date = screen.getByLabelText("Date *") as HTMLInputElement
    const location = screen.getByLabelText("Location") as HTMLInputElement
    fireEvent.change(title, { target: { value: "Retained Event" } })
    fireEvent.change(date, { target: { value: "2030-01-02" } })
    fireEvent.change(location, { target: { value: "Retained Venue" } })
    fireEvent.click(screen.getByRole("button", { name: "Create event" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(
      kind === "returned" ? /Event validation failed/ : /Check the event list before retrying/,
    )
    expect(screen.queryByText(/PRIVATE_EVENT_FAILURE/)).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
    expect([title.value, date.value, location.value]).toEqual([
      "Retained Event", "2030-01-02", "Retained Venue",
    ])
    expect([title.disabled, date.disabled, location.disabled]).toEqual([false, false, false])
    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled)
      .toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "Create event" }))
    await waitFor(() => expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/events"))
    expect(createEvent).toHaveBeenCalledTimes(2)
    expect(createEvent.mock.calls[1][0]).toEqual({
      title: "Retained Event",
      date: "2030-01-02",
      location: "Retained Venue",
      status: "in_progress",
      artist_id: undefined,
      promoter_id: undefined,
    })
    expect(screen.queryByRole("alert")).toBeNull()
  },
)

it.each(["artists", "promoters"] as const)("S15: event %s option failure is visible, retryable and retains native draft", async failed => {
  const reader = failed === "artists" ? getArtists : listPromoters
  reader.mockRejectedValueOnce(new Error("PRIVATE_OPTION_FAILURE"))
  render(<NewEventPage />)
  const title = screen.getByLabelText("Title *") as HTMLInputElement
  const date = screen.getByLabelText("Date *") as HTMLInputElement
  fireEvent.change(title, { target: { value: "Retained event" } })
  fireEvent.change(date, { target: { value: "2030-01-02" } })
  expect((await screen.findByRole("alert")).textContent).toBe("Unable to load event options. Please try again.")
  expect(screen.queryByText(/PRIVATE_OPTION_FAILURE/)).toBeNull()
  const submit = screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  fireEvent.click(submit)
  expect(createEvent).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Retry loading options" }))
  await waitFor(() => expect(submit.disabled).toBe(false))
  expect(screen.queryByRole("alert")).toBeNull()
  expect(title.value).toBe("Retained event")
  expect(date.value).toBe("2030-01-02")
  expect(getArtists).toHaveBeenCalledTimes(2)
  expect(listPromoters).toHaveBeenCalledTimes(2)
})


it.each(["artists", "promoters"] as const)("S15: waits for pending %s options before accepting an event", async pending => {
  let finish!: (rows: unknown[]) => void
  const reader = pending === "artists" ? getArtists : listPromoters
  reader.mockReturnValueOnce(new Promise<unknown[]>(resolve => { finish = resolve }))
  createEvent.mockResolvedValueOnce({ success: true, eventId: "saved-event" })
  render(<NewEventPage />)
  const title = screen.getByLabelText("Title *") as HTMLInputElement
  const date = screen.getByLabelText("Date *") as HTMLInputElement
  fireEvent.change(title, { target: { value: "Retained while loading" } })
  fireEvent.change(date, { target: { value: "2030-01-02" } })
  const submit = screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  fireEvent.submit(title.closest("form")!)
  expect(createEvent).not.toHaveBeenCalled()
  await act(async () => { finish([]) })
  await waitFor(() => expect(submit.disabled).toBe(false))
  expect(screen.queryByRole("alert")).toBeNull()
  expect(title.value).toBe("Retained while loading")
  expect(date.value).toBe("2030-01-02")
  fireEvent.click(submit)
  await waitFor(() => expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/events"))
  expect(createEvent).toHaveBeenCalledExactlyOnceWith({
    title: "Retained while loading", date: "2030-01-02", location: undefined,
    status: "in_progress", artist_id: undefined, promoter_id: undefined,
  })
})
