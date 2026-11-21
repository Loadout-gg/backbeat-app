// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { redirect } from "next/navigation"

const mocks = vi.hoisted(() => ({
  listPromoterDirectory: vi.fn(), getPromoter: vi.fn(), createPromoter: vi.fn(), updatePromoter: vi.fn(), deletePromoter: vi.fn(),
  createEvent: vi.fn(), listPromoters: vi.fn(), getArtists: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
}))
vi.mock("@/lib/actions/promoters", () => ({
  listPromoterDirectory: mocks.listPromoterDirectory, getPromoter: mocks.getPromoter,
  createPromoter: mocks.createPromoter, updatePromoter: mocks.updatePromoter, deletePromoter: mocks.deletePromoter,
}))
vi.mock("@/lib/actions/events", () => ({ createEvent: mocks.createEvent, listPromoters: mocks.listPromoters }))
vi.mock("@/lib/actions/artists", () => ({ getArtists: mocks.getArtists }))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => mocks.router,
}))
import PromotersPage from "@/app/dashboard/promoters/page"
import NewPromoterPage from "@/app/dashboard/promoters/new/page"
import EditPromoterPage from "@/app/dashboard/promoters/[id]/edit/page"
import NewEventPage from "@/app/dashboard/events/new/page"

const ID = "11111111-1111-4111-8111-111111111111"
const marta = { id: ID, name: "Marta Rossi", company_name: "Nightwave Srl", email: "marta@example.com", phone: "+39 079 123", notes: "Pays in 30 days" }
beforeEach(() => {
  for (const mock of Object.values(mocks)) if ("mockReset" in mock) mock.mockReset()
  mocks.router.push.mockReset(); mocks.router.refresh.mockReset()
  mocks.listPromoters.mockResolvedValue([])
  mocks.getArtists.mockResolvedValue([])
})
afterEach(cleanup)

it("lists promoters with contact details and an edit link each", async () => {
  mocks.listPromoterDirectory.mockResolvedValue([marta, { id: "p2", name: "Luca Bianchi", company_name: null, email: null, phone: null }])
  render(await PromotersPage())
  const items = within(screen.getByRole("list", { name: "Promoters" })).getAllByRole("listitem")
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByRole("heading", { name: "Marta Rossi" })).toBeTruthy()
  expect(within(items[0]).getByText("Nightwave Srl")).toBeTruthy()
  expect(within(items[0]).getByText("marta@example.com")).toBeTruthy()
  expect(within(items[0]).getByText("+39 079 123")).toBeTruthy()
  expect(within(items[0]).queryByText("Pays in 30 days")).toBeNull()
  expect(within(items[0]).getByRole("link", { name: "Edit Marta Rossi" }).getAttribute("href")).toBe(`/dashboard/promoters/${ID}/edit`)
  expect(within(items[1]).getByRole("link", { name: "Edit Luca Bianchi" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Add promoter" }).getAttribute("href")).toBe("/dashboard/promoters/new")
})

it("shows the empty state only when the read succeeds with no promoters", async () => {
  mocks.listPromoterDirectory.mockResolvedValue([])
  render(await PromotersPage())
  expect(screen.getByText(/No promoters yet/)).toBeTruthy()
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.getAllByRole("link", { name: "Add promoter" })).toHaveLength(2)
})

it("shows a safe read error with retry instead of an empty directory", async () => {
  mocks.listPromoterDirectory.mockRejectedValue(new Error("private database detail"))
  render(await PromotersPage())
  expect(screen.getByRole("alert").textContent).toBe("Unable to load promoters. Please refresh and try again.")
  expect(screen.queryByText(/No promoters yet/)).toBeNull()
  expect(screen.queryByText("private database detail")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Retry loading promoters" }))
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1)
})

it("lets the onboarding redirect propagate from the directory read", async () => {
  mocks.listPromoterDirectory.mockImplementation(async () => redirect("/onboarding"))
  await expect(PromotersPage()).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;[^;]*;\/onboarding;/) })
})

it("creates a promoter and returns to the directory", async () => {
  mocks.createPromoter.mockResolvedValue({ success: true, promoter: { id: ID, name: "Marta Rossi", company_name: null } })
  render(<NewPromoterPage />)
  fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Marta Rossi" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "marta@example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "Add promoter" }))
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/dashboard/promoters"))
  expect(mocks.createPromoter).toHaveBeenCalledWith({ name: "Marta Rossi", company_name: "", email: "marta@example.com", phone: "", notes: "" })
})

it("validates before calling the server and keeps the draft", async () => {
  render(<NewPromoterPage />)
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Nightwave Srl" } })
  fireEvent.click(screen.getByRole("button", { name: "Add promoter" }))
  expect((await screen.findByRole("alert")).textContent).toBe("Promoter name is required")
  expect(mocks.createPromoter).not.toHaveBeenCalled()
  expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("Nightwave Srl")
})

it("shows a server refusal, keeps the draft and does not navigate", async () => {
  mocks.createPromoter.mockResolvedValue({ success: false, error: "Unable to save the promoter. Please try again." })
  render(<NewPromoterPage />)
  fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Marta Rossi" } })
  fireEvent.click(screen.getByRole("button", { name: "Add promoter" }))
  expect((await screen.findByRole("alert")).textContent).toBe("Unable to save the promoter. Please try again.")
  expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe("Marta Rossi")
  expect(mocks.router.push).not.toHaveBeenCalled()
})

it("does not claim a result when the save call itself fails, and blocks duplicate submits meanwhile", async () => {
  let reject: (error: Error) => void = () => {}
  mocks.createPromoter.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  render(<NewPromoterPage />)
  fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Marta Rossi" } })
  fireEvent.click(screen.getByRole("button", { name: "Add promoter" }))
  const saving = await screen.findByRole("button", { name: "Saving..." })
  expect((saving as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(saving)
  expect(mocks.createPromoter).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error("network")) })
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to confirm whether the promoter was saved")
})

it("edits an existing promoter with its stored values", async () => {
  mocks.getPromoter.mockResolvedValue(marta)
  mocks.updatePromoter.mockResolvedValue({ success: true, promoter: { id: ID, name: "Marta R.", company_name: "Nightwave Srl" } })
  render(await EditPromoterPage({ params: Promise.resolve({ id: ID }) }))
  expect(screen.getByRole("heading", { name: "Edit promoter" })).toBeTruthy()
  expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Pays in 30 days")
  fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Marta R." } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/dashboard/promoters"))
  expect(mocks.updatePromoter).toHaveBeenCalledWith(ID, {
    name: "Marta R.", company_name: "Nightwave Srl", email: "marta@example.com", phone: "+39 079 123", notes: "Pays in 30 days",
  })
  expect(mocks.createPromoter).not.toHaveBeenCalled()
})

it("answers not found for a promoter outside the workspace", async () => {
  mocks.getPromoter.mockResolvedValue(null)
  await expect(EditPromoterPage({ params: Promise.resolve({ id: ID }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") })
})

it("adds a promoter from the new event form, selects it and keeps the event draft", async () => {
  mocks.createPromoter.mockResolvedValue({ success: true, promoter: { id: ID, name: "Marta Rossi", company_name: "Nightwave Srl" } })
  mocks.createEvent.mockResolvedValue({ success: true, eventId: "event-a" })
  render(<NewEventPage />)
  const add = screen.getByRole("button", { name: "Add promoter" })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Synthetic Night" } })
  fireEvent.change(screen.getByLabelText("Date *"), { target: { value: "2030-03-01" } })
  fireEvent.click(add)
  const dialog = await screen.findByRole("dialog", { name: "Add promoter" })
  fireEvent.change(within(dialog).getByLabelText("Name *"), { target: { value: "Marta Rossi" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Add promoter" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  // Saving the promoter must not submit the event form underneath.
  expect(mocks.createEvent).not.toHaveBeenCalled()
  expect((screen.getByLabelText("Title *") as HTMLInputElement).value).toBe("Synthetic Night")
  const promoterField = screen.getByText("Promoter", { selector: "label" }).parentElement?.parentElement as HTMLElement
  await waitFor(() => expect(within(promoterField).getByRole("combobox").textContent).toBe("Marta Rossi (Nightwave Srl)"))
  fireEvent.click(screen.getByRole("button", { name: "Create event" }))
  await waitFor(() => expect(mocks.createEvent).toHaveBeenCalledTimes(1))
  expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "Synthetic Night", date: "2030-03-01", promoter_id: ID }))
})

it("closes the add promoter dialog on cancel without selecting anything", async () => {
  mocks.createEvent.mockResolvedValue({ success: true, eventId: "event-a" })
  render(<NewEventPage />)
  const add = screen.getByRole("button", { name: "Add promoter" })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  const dialog = await screen.findByRole("dialog", { name: "Add promoter" })
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(mocks.createPromoter).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Synthetic Night" } })
  fireEvent.change(screen.getByLabelText("Date *"), { target: { value: "2030-03-01" } })
  fireEvent.click(screen.getByRole("button", { name: "Create event" }))
  await waitFor(() => expect(mocks.createEvent).toHaveBeenCalledTimes(1))
  expect(mocks.createEvent.mock.calls[0][0].promoter_id).toBeUndefined()
})

it("keeps the add promoter dialog open while its save is in flight", async () => {
  let resolve: (value: unknown) => void = () => {}
  mocks.createPromoter.mockImplementation(() => new Promise((done) => { resolve = done }))
  render(<NewEventPage />)
  const add = screen.getByRole("button", { name: "Add promoter" })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  const dialog = await screen.findByRole("dialog", { name: "Add promoter" })
  expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText("Name *"), { target: { value: "Marta Rossi" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Add promoter" }))
  await within(dialog).findByRole("button", { name: "Saving..." })
  // Escape and the close button cannot dismiss a dialog whose save has not answered yet.
  expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull()
  fireEvent.keyDown(dialog, { key: "Escape" })
  expect(screen.getByRole("dialog", { name: "Add promoter" })).toBeTruthy()
  await act(async () => { resolve({ success: true, promoter: { id: ID, name: "Marta Rossi", company_name: null } }) })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(mocks.createPromoter).toHaveBeenCalledTimes(1)
})

it("lets the dialog be dismissed again after a save that did not confirm", async () => {
  mocks.createPromoter.mockRejectedValue(new Error("network"))
  render(<NewEventPage />)
  const add = screen.getByRole("button", { name: "Add promoter" })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  const dialog = await screen.findByRole("dialog", { name: "Add promoter" })
  fireEvent.change(within(dialog).getByLabelText("Name *"), { target: { value: "Marta Rossi" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Add promoter" }))
  expect((await within(dialog).findByRole("alert")).textContent).toContain("Unable to confirm")
  fireEvent.keyDown(dialog, { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
})

const luca = { id: "p2", name: "Luca Bianchi", company_name: null, email: null, phone: null }
it("filters the directory as you type and reports how many match", async () => {
  mocks.listPromoterDirectory.mockResolvedValue([marta, luca])
  render(await PromotersPage())
  expect(screen.getByRole("status").textContent).toBe("2 promoters")
  fireEvent.change(screen.getByRole("searchbox", { name: "Search promoters" }), { target: { value: "nightwave" } })
  expect(within(screen.getByRole("list", { name: "Promoters" })).getAllByRole("listitem")).toHaveLength(1)
  expect(screen.getByRole("heading", { name: "Marta Rossi" })).toBeTruthy()
  expect(screen.queryByRole("heading", { name: "Luca Bianchi" })).toBeNull()
  expect(screen.getByRole("status").textContent).toBe("1 of 2 promoters")
})

it("explains an empty search and restores the list on clear", async () => {
  mocks.listPromoterDirectory.mockResolvedValue([marta, luca])
  render(await PromotersPage())
  fireEvent.change(screen.getByRole("searchbox", { name: "Search promoters" }), { target: { value: "nobody" } })
  expect(screen.getByText("No promoters match your search.")).toBeTruthy()
  expect(screen.queryByText(/No promoters yet/)).toBeNull()
  expect(screen.getByRole("status").textContent).toBe("0 of 2 promoters")
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }))
  expect(within(screen.getByRole("list", { name: "Promoters" })).getAllByRole("listitem")).toHaveLength(2)
})

it("does not offer search when there are no promoters, nor delete when adding one", async () => {
  mocks.listPromoterDirectory.mockResolvedValue([])
  render(await PromotersPage())
  expect(screen.queryByRole("searchbox")).toBeNull()
  cleanup()
  render(<NewPromoterPage />)
  expect(screen.queryByRole("button", { name: "Delete promoter" })).toBeNull()
})

it("deletes a promoter only after confirmation, then returns to the directory", async () => {
  mocks.getPromoter.mockResolvedValue(marta)
  mocks.deletePromoter.mockResolvedValue({ success: true })
  render(await EditPromoterPage({ params: Promise.resolve({ id: ID }) }))
  expect(screen.getByText(/Events linked to this promoter are kept/)).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Delete promoter" }))
  expect(mocks.deletePromoter).not.toHaveBeenCalled()
  expect(screen.getByText("Delete Marta Rossi?")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/dashboard/promoters"))
  expect(mocks.deletePromoter).toHaveBeenCalledWith(ID)
  expect(mocks.updatePromoter).not.toHaveBeenCalled()
})

it("cancelling the confirmation deletes nothing", async () => {
  mocks.getPromoter.mockResolvedValue(marta)
  render(await EditPromoterPage({ params: Promise.resolve({ id: ID }) }))
  fireEvent.click(screen.getByRole("button", { name: "Delete promoter" }))
  const confirm = screen.getByText("Delete Marta Rossi?").parentElement as HTMLElement
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }))
  expect(screen.getByRole("button", { name: "Delete promoter" })).toBeTruthy()
  expect(mocks.deletePromoter).not.toHaveBeenCalled()
  expect(mocks.router.push).not.toHaveBeenCalled()
})

it("shows a refused delete, stays on the page and allows a retry", async () => {
  mocks.getPromoter.mockResolvedValue(marta)
  mocks.deletePromoter.mockResolvedValueOnce({ success: false, error: "Unable to delete the promoter. Please try again." })
  mocks.deletePromoter.mockResolvedValueOnce({ success: true })
  render(await EditPromoterPage({ params: Promise.resolve({ id: ID }) }))
  fireEvent.click(screen.getByRole("button", { name: "Delete promoter" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
  expect((await screen.findByRole("alert")).textContent).toBe("Unable to delete the promoter. Please try again.")
  expect(mocks.router.push).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/dashboard/promoters"))
})

it("does not claim a result when the delete call fails, and ignores duplicate clicks while it runs", async () => {
  mocks.getPromoter.mockResolvedValue(marta)
  let reject: (error: Error) => void = () => {}
  mocks.deletePromoter.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  render(await EditPromoterPage({ params: Promise.resolve({ id: ID }) }))
  fireEvent.click(screen.getByRole("button", { name: "Delete promoter" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
  const deleting = await screen.findByRole("button", { name: "Deleting..." })
  fireEvent.click(deleting)
  expect(mocks.deletePromoter).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error("network")) })
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to confirm whether the promoter was deleted")
  expect(mocks.router.push).not.toHaveBeenCalled()
})
