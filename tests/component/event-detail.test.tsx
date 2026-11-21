// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { redirect } from "next/navigation"

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(), updateEvent: vi.fn(), listPromoters: vi.fn(), listEvents: vi.fn(), getArtists: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
}))
vi.mock("@/lib/actions/events", () => ({
  getEvent: mocks.getEvent, updateEvent: mocks.updateEvent, listPromoters: mocks.listPromoters, listEvents: mocks.listEvents,
}))
vi.mock("@/lib/actions/artists", () => ({ getArtists: mocks.getArtists }))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => mocks.router,
}))
import EventPage from "@/app/dashboard/events/[id]/page"
import EventsPage from "@/app/dashboard/events/page"

const ID = "11111111-1111-4111-8111-111111111111"
const stored = { id: ID, title: "Synthetic Night", date: "2030-03-01", location: "Rome", status: "confirmed", artist_id: "artist-a", promoter_id: "promoter-a" }
const open = (id = ID) => EventPage({ params: Promise.resolve({ id }) })
beforeEach(() => {
  for (const mock of Object.values(mocks)) if ("mockReset" in mock) mock.mockReset()
  mocks.router.push.mockReset(); mocks.router.refresh.mockReset()
  mocks.getEvent.mockResolvedValue(stored)
  mocks.getArtists.mockResolvedValue([{ id: "artist-a", name: "Alice Rossi", stage_name: "DJ Alice" }])
  mocks.listPromoters.mockResolvedValue([{ id: "promoter-a", name: "Marta Rossi", company_name: "Nightwave Srl" }])
})
afterEach(cleanup)

it("shows the stored event with its artist stage name and promoter selected", async () => {
  render(await open())
  expect(screen.getByRole("heading", { level: 1, name: "Synthetic Night" })).toBeTruthy()
  expect((screen.getByLabelText("Title *") as HTMLInputElement).value).toBe("Synthetic Night")
  expect((screen.getByLabelText("Date *") as HTMLInputElement).value).toBe("2030-03-01")
  expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Rome")
  expect(screen.getByRole("combobox", { name: "Status" }).textContent).toBe("Confirmed")
  expect(screen.getByRole("combobox", { name: "Artist" }).textContent).toBe("DJ Alice")
  expect(screen.getByRole("combobox", { name: "Promoter" }).textContent).toBe("Marta Rossi (Nightwave Srl)")
  expect(screen.queryByText("Alice Rossi")).toBeNull()
})

it("saves edited fields, keeps the untouched links and returns to the list", async () => {
  mocks.updateEvent.mockResolvedValue({ success: true })
  render(await open())
  fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Synthetic Night II" } })
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/dashboard/events"))
  expect(mocks.updateEvent).toHaveBeenCalledWith(ID, {
    title: "Synthetic Night II", date: "2030-03-01", location: null, status: "confirmed", artist_id: "artist-a", promoter_id: "promoter-a",
  })
})

it("sends null for an event without artist or promoter", async () => {
  mocks.getEvent.mockResolvedValue({ ...stored, artist_id: null, promoter_id: null })
  mocks.updateEvent.mockResolvedValue({ success: true })
  render(await open())
  expect(screen.getByRole("combobox", { name: "Artist" }).textContent).toBe("None")
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalledTimes(1))
  expect(mocks.updateEvent.mock.calls[0][1]).toMatchObject({ artist_id: null, promoter_id: null })
})

it("validates before calling the server and keeps the draft", async () => {
  render(await open())
  fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "   " } })
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Milan" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect((await screen.findByRole("alert")).textContent).toBe("Event title is required")
  expect(mocks.updateEvent).not.toHaveBeenCalled()
  expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Milan")
})

it("shows a server refusal, keeps the draft and allows a retry", async () => {
  mocks.updateEvent.mockResolvedValueOnce({ success: false, error: "Unable to save the event. Please try again." })
  mocks.updateEvent.mockResolvedValueOnce({ success: true })
  render(await open())
  fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Renamed" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect((await screen.findByRole("alert")).textContent).toBe("Unable to save the event. Please try again.")
  expect((screen.getByLabelText("Title *") as HTMLInputElement).value).toBe("Renamed")
  expect(mocks.router.push).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/dashboard/events"))
})

it("does not claim a result when the save call fails, and blocks duplicate submits meanwhile", async () => {
  let reject: (error: Error) => void = () => {}
  mocks.updateEvent.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  render(await open())
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  const saving = await screen.findByRole("button", { name: "Saving..." })
  expect((saving as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(saving)
  expect(mocks.updateEvent).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error("network")) })
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to confirm whether the event was saved")
})

it("refuses to save an event whose stored status is not supported, without rewriting it", async () => {
  mocks.getEvent.mockResolvedValue({ ...stored, status: "completed" })
  render(await open())
  expect(screen.getByRole("combobox", { name: "Status" }).textContent).toBe("completed (not supported)")
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect((await screen.findByRole("alert")).textContent).toBe("Choose a valid status")
  expect(mocks.updateEvent).not.toHaveBeenCalled()
})

it("answers not found for an event outside the workspace", async () => {
  mocks.getEvent.mockResolvedValue(null)
  await expect(open()).rejects.toMatchObject({ digest: expect.stringContaining("404") })
  expect(mocks.getArtists).not.toHaveBeenCalled()
})

it("shows an honest error with retry when the options cannot be loaded, not an editable form", async () => {
  mocks.listPromoters.mockRejectedValue(new Error("private database detail"))
  render(await open())
  expect(screen.getByRole("alert").textContent).toContain("Unable to load the artist and promoter options")
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
  expect(screen.queryByText("private database detail")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Retry loading event" }))
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1)
})

it("lets the onboarding redirect propagate from the options read", async () => {
  mocks.getArtists.mockImplementation(async () => redirect("/onboarding"))
  await expect(open()).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;[^;]*;\/onboarding;/) })
})

it("links each event in the list to its detail page", async () => {
  mocks.listEvents.mockResolvedValue([{ id: ID, title: "Synthetic Night", date: "2030-03-01", location: null, status: "confirmed", artists: null, promoters: null }])
  render(await EventsPage())
  expect(screen.getByRole("heading", { name: "Synthetic Night" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Synthetic Night" }).getAttribute("href")).toBe(`/dashboard/events/${ID}`)
})
