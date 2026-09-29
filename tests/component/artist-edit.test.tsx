// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
const { getArtist, updateArtist, router } = vi.hoisted(() => ({
  getArtist: vi.fn(), updateArtist: vi.fn(), router: { push: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/actions/artists", () => ({ getArtist, updateArtist }))
import EditArtistPage from "@/app/dashboard/artists/[id]/edit/page"

afterEach(cleanup)
const clearableTextFields = [
  ["name", "Name", 1], ["surname", "Surname", 1], ["location", "Artist location", 1],
  ["contact_name", "Contact name", 1], ["phone", "Phone number", 1],
  ["pricing_notes", "Additional note", 1], ["overview", "About artist", 2],
  ["dj_equipment", "DJ Equipment", 2], ["sound_system", "Sound System", 2],
  ["allergies", "Allergies", 4], ["special_diet", "Special Diet", 4],
  ["special_needs", "Special Needs & Accessibility", 4],
] as const
it.each(clearableTextFields)("submits explicit clearing for %s from the existing wizard", async (field, label, step) => {
  getArtist.mockResolvedValueOnce({ id: "artist-a", stage_name: "DJ Moon", name: "Luna", [field]: "Existing", notes: "Contact: Existing" })
  updateArtist.mockResolvedValueOnce({ success: false, error: "Synthetic save denied" })
  render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  await screen.findByRole("textbox", { name: "Stage name" })
  for (let current = 1; current < step; current++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  const input = screen.getByRole("textbox", { name: label })
  expect((input as HTMLInputElement).value).toBe("Existing")
  fireEvent.change(input, { target: { value: "" } })
  for (let current = step; current < 4; current++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
  await waitFor(() => expect(updateArtist).toHaveBeenCalledOnce())
  expect(updateArtist).toHaveBeenCalledWith("artist-a", expect.objectContaining({ [field]: "" }))
})
it("submits an explicit empty email when the existing email is cleared in the edit wizard", async () => {
  getArtist.mockResolvedValueOnce({ id: "artist-a", stage_name: "DJ Moon", name: "Luna", email: "artist@example.test" })
  updateArtist.mockResolvedValueOnce({ success: false, error: "Synthetic save denied" })
  render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  const email = await screen.findByRole("textbox", { name: "Email" })
  expect((email as HTMLInputElement).value).toBe("artist@example.test")
  fireEvent.change(email, { target: { value: "" } })
  for (let step = 1; step < 4; step++) {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  }
  fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
  await waitFor(() => expect(updateArtist).toHaveBeenCalledOnce())
  expect(updateArtist).toHaveBeenCalledWith("artist-a", expect.objectContaining({
    email: "", stage_name: "DJ Moon", name: "Luna", phone: "",
    location: "", fee: null, social_links: [],
  }))
  expect(await screen.findByText("Synthetic save denied")).toBeTruthy()
  expect((screen.getByRole("button", { name: "Save and Complete" }) as HTMLButtonElement).disabled).toBe(false)
  expect(router.push).not.toHaveBeenCalled()
})

it("submits empty social links and genres after removing their final existing entries", async () => {
  getArtist.mockResolvedValueOnce({ id: "artist-a", stage_name: "DJ Moon", name: "Luna", social_links: [{ type: "Website", url: "https://example.test" }], genres: ["House"] })
  updateArtist.mockResolvedValueOnce({ success: false, error: "Synthetic save denied" })
  render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  const social = await screen.findByText("Website: https://example.test")
  fireEvent.click(social.parentElement!.querySelector("button")!)
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "House" }))
  for (let i = 2; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
  await waitFor(() => expect(updateArtist).toHaveBeenCalledOnce())
  expect(updateArtist).toHaveBeenCalledWith("artist-a", expect.objectContaining({ social_links: [], genres: [] }))
})

it.each([["", null], ["0", 0]] as const)("submits cleared or zero base rate %j distinctly", async (value, expected) => {
  getArtist.mockResolvedValueOnce({ id: "artist-a", stage_name: "DJ Moon", name: "Luna", fee: 100 })
  updateArtist.mockResolvedValueOnce({ success: false, error: "Synthetic save denied" })
  render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  fireEvent.change(await screen.findByRole("spinbutton", { name: "Base rate" }), { target: { value } })
  for (let i = 1; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
  await waitFor(() => expect(updateArtist).toHaveBeenCalledOnce())
  expect(updateArtist).toHaveBeenCalledWith("artist-a", expect.objectContaining({ fee: expected }))
})

it.each(["returned", "thrown"])("shows an accessible %s save error, retains the draft and permits retry", async (kind) => {
  getArtist.mockResolvedValueOnce({ id: "artist-a", stage_name: "DJ Moon", name: "Luna" })
  if (kind === "thrown") updateArtist.mockRejectedValueOnce(new Error("private backend detail"))
  else updateArtist.mockResolvedValueOnce({ success: false, error: "Synthetic save denied" })
  updateArtist.mockResolvedValueOnce({ success: true })
  render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), { target: { value: "Retained draft" } })
  for (let i = 1; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
  expect((await screen.findByRole("alert")).textContent).toMatch(/save|denied/i)
  expect(screen.queryByText("private backend detail")).toBeNull()
  expect(screen.queryByText("Artist successfully updated.")).toBeNull()
  const save = screen.getByRole("button", { name: "Save and Complete" })
  expect((save as HTMLButtonElement).disabled).toBe(false)
  expect(router.push).not.toHaveBeenCalled()
  fireEvent.click(save)
  expect(await screen.findByRole("dialog")).toBeTruthy()
  expect(updateArtist.mock.calls[1][1].name).toBe("Retained draft")
})
