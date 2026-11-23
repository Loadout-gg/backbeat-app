// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
const m = vi.hoisted(() => ({
  refresh: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), dob: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn() }) }))
vi.mock("@/lib/actions/artist-travel-documents", () => ({
  createArtistTravelDocument: m.create, updateArtistTravelDocument: m.update,
  deleteArtistTravelDocument: m.remove, updateArtistDateOfBirth: m.dob,
}))
import { ArtistTravelDocumentsSection } from "@/components/dashboard/artist-travel-documents-section"
afterEach(cleanup)

const profile = {
  artistId: "artist-a", dateOfBirth: "1990-02-03",
  documents: [{ id: "doc-1", artist_id: "artist-a", doc_type: "passport" as const, number: "YA0000001", issuing_country: "Italy", expires_on: "2026-01-01", holder_name: "Luna Moon" }],
}
const renderSection = (value: typeof profile | null = profile) =>
  render(<ArtistTravelDocumentsSection artistId="artist-a" profile={value} today="2026-11-23" />)

it("shows the date of birth and documents with an expired marker", () => {
  renderSection()
  expect((screen.getByLabelText("Date of birth") as HTMLInputElement).value).toBe("1990-02-03")
  const card = screen.getByRole("article", { name: "Travel document: Passport" })
  expect(card.textContent).toContain("YA0000001")
  expect(card.textContent).toContain("2026-01-01 (expired)")
})

it("shows an unavailable state instead of an empty list", () => {
  renderSection(null)
  expect(screen.getByText("Travel documents could not be loaded. Reload the page to try again.")).toBeTruthy()
  expect(screen.queryByLabelText("Date of birth")).toBeNull()
  expect(screen.queryByRole("button", { name: "Add travel document" })).toBeNull()
})

it("rejects a future date of birth before the server and saves a cleared one as null", async () => {
  m.dob.mockResolvedValueOnce({ success: true })
  renderSection()
  const form = screen.getByRole("form", { name: "Artist date of birth" })
  fireEvent.change(within(form).getByLabelText("Date of birth"), { target: { value: "2026-11-24" } })
  fireEvent.click(within(form).getByRole("button", { name: "Save date of birth" }))
  expect((await within(form).findByRole("alert")).textContent).toBe("Date of birth cannot be in the future")
  expect(m.dob).not.toHaveBeenCalled()
  fireEvent.change(within(form).getByLabelText("Date of birth"), { target: { value: "" } })
  fireEvent.click(within(form).getByRole("button", { name: "Save date of birth" }))
  await waitFor(() => expect(m.dob).toHaveBeenCalledWith("artist-a", null))
  expect(await within(form).findByText("Date of birth saved.")).toBeTruthy()
})

it("adds a document, keeps the draft after a failure and retries once per click", async () => {
  m.create.mockResolvedValueOnce({ success: false, error: "Unable to save the travel document. Please try again." }).mockResolvedValueOnce({ success: true })
  renderSection()
  fireEvent.click(screen.getByRole("button", { name: "Add travel document" }))
  const form = screen.getByRole("form", { name: "New travel document" })
  fireEvent.click(within(form).getByRole("button", { name: "Add travel document" }))
  expect((await within(form).findByRole("alert")).textContent).toBe("Enter the document number")
  fireEvent.change(within(form).getByLabelText("Document type"), { target: { value: "id_card" } })
  fireEvent.change(within(form).getByLabelText("Document number"), { target: { value: "CA00001" } })
  fireEvent.click(within(form).getByRole("button", { name: "Add travel document" }))
  expect(await within(form).findByText("Unable to save the travel document. Please try again.")).toBeTruthy()
  expect((within(form).getByLabelText("Document number") as HTMLInputElement).value).toBe("CA00001")
  fireEvent.click(within(form).getByRole("button", { name: "Add travel document" }))
  await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce())
  expect(m.create).toHaveBeenCalledTimes(2)
  expect(m.create).toHaveBeenLastCalledWith("artist-a", expect.objectContaining({ doc_type: "id_card", number: "CA00001" }))
})

it("edits and deletes a document through confirmation", async () => {
  m.update.mockResolvedValueOnce({ success: true })
  m.remove.mockResolvedValueOnce({ success: true })
  renderSection()
  fireEvent.click(screen.getByRole("button", { name: "Edit travel document: Passport" }))
  const form = screen.getByRole("form", { name: "Edit travel document" })
  expect((within(form).getByLabelText("Document number") as HTMLInputElement).value).toBe("YA0000001")
  fireEvent.change(within(form).getByLabelText("Expiry date"), { target: { value: "2034-01-01" } })
  fireEvent.click(within(form).getByRole("button", { name: "Save travel document" }))
  await waitFor(() => expect(m.update).toHaveBeenCalledWith("artist-a", "doc-1", expect.objectContaining({ expires_on: "2034-01-01" })))
  fireEvent.click(await screen.findByRole("button", { name: "Delete travel document: Passport" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
  await waitFor(() => expect(m.remove).toHaveBeenCalledWith("artist-a", "doc-1"))
})
