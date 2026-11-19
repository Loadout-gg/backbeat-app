// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const { createEvent, getArtists, listPromoters, router } = vi.hoisted(() => ({
  createEvent: vi.fn(),
  getArtists: vi.fn(),
  listPromoters: vi.fn(),
  router: { push: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/actions/artists", () => ({ getArtists }))
vi.mock("@/lib/actions/events", () => ({ createEvent, listPromoters }))

import NewEventPage from "@/app/dashboard/events/new/page"

const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
  getArtists.mockReset().mockResolvedValue([
    { id: "artist-a", name: "Private Real Name", stage_name: "DJ Luna" },
    { id: "artist-b", name: "", stage_name: "Unknown" },
  ])
  listPromoters.mockReset().mockResolvedValue([])
  createEvent.mockReset()
  router.push.mockReset()
})
afterEach(() => {
  cleanup()
  if (original) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  }
})

async function openArtistSelect() {
  render(<NewEventPage />)
  const field = screen.getByText("Artist", { selector: "label" }).parentElement as HTMLElement
  const control = within(field).getByRole("combobox")
  await waitFor(() => expect(control.hasAttribute("disabled")).toBe(false))
  fireEvent.keyDown(control, { key: "Enter" })
  return control
}

it("lists artists by stage name rather than the stored real name", async () => {
  await openArtistSelect()
  expect(await screen.findByRole("option", { name: "DJ Luna" })).toBeTruthy()
  expect(screen.getByRole("option", { name: "Unknown" })).toBeTruthy()
  expect(screen.queryByRole("option", { name: "Private Real Name" })).toBeNull()
})

it("still submits the selected artist's id", async () => {
  createEvent.mockResolvedValueOnce({ success: false, error: "Synthetic stop" })
  await openArtistSelect()
  fireEvent.click(await screen.findByRole("option", { name: "DJ Luna" }))
  fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Synthetic Night" } })
  fireEvent.change(screen.getByLabelText("Date *"), { target: { value: "2030-03-01" } })
  fireEvent.click(screen.getByRole("button", { name: "Create event" }))
  await waitFor(() => expect(createEvent).toHaveBeenCalledOnce())
  expect(createEvent.mock.calls[0][0]).toEqual(expect.objectContaining({ artist_id: "artist-a" }))
})
