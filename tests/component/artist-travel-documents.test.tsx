// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
const m = vi.hoisted(() => ({
  refresh: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), dob: vi.fn(), restore: vi.fn(),
  end: vi.fn(), resume: vi.fn(), reserve: vi.fn(), finalize: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn() }) }))
vi.mock("@/lib/actions/artist-travel-documents", () => ({
  createArtistTravelDocument: m.create, updateArtistTravelDocument: m.update,
  deleteArtistTravelDocument: m.remove, updateArtistDateOfBirth: m.dob, restoreArtistTravelDocument: m.restore,
  endArtistRelationship: m.end, resumeArtistRelationship: m.resume,
  reserveTravelDocumentScan: m.reserve, finalizeTravelDocumentScan: m.finalize,
}))
import { ArtistTravelDocumentsSection } from "@/components/dashboard/artist-travel-documents-section"
import type { ArtistTravelProfile } from "@/lib/actions/artist-travel-documents"

const FILE = "11111111-1111-4111-8111-111111111111"
const LINK = "https://project.supabase.co/storage/v1/object/sign/x?token=T"
const fetchMock = vi.fn()
const assign = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  assign.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  Object.defineProperty(window, "location", { configurable: true, value: { assign } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const profile: ArtistTravelProfile = {
  artistId: "artist-a", dateOfBirth: "1990-02-03",
  documents: [
    { id: "doc-1", artist_id: "artist-a", doc_type: "passport", number: "YA0000001", issuing_country: "France", nationality: "Italian",
      issued_on: "2016-01-02", expires_on: "2026-01-01", holder_name: "MOON LUNA", scan: { fileId: FILE, state: "ready", mediaType: "application/pdf", byteSize: 1_572_864 } },
    { id: "doc-2", artist_id: "artist-a", doc_type: "id_card", number: "CA00001", issuing_country: null, nationality: null,
      issued_on: null, expires_on: "2031-01-01", holder_name: null, scan: null },
  ],
  archived: [], relationshipEndedAt: null, activity: [], scansEnabled: true,
}
const renderSection = (value: ArtistTravelProfile | null = profile) =>
  render(<ArtistTravelDocumentsSection artistId="artist-a" profile={value} today="2026-11-23" />)
const pdfFile = (name = "passport.pdf", type = "application/pdf", size?: number) => {
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], name, { type })
  if (size !== undefined) Object.defineProperty(file, "size", { value: size })
  return file
}

it("DATA-01 / LIFE-04 shows the card fields separately and an explicit expired state", () => {
  renderSection()
  expect((screen.getByLabelText("Date of birth") as HTMLInputElement).value).toBe("1990-02-03")
  const card = screen.getByRole("article", { name: "Travel document: Passport" })
  for (const [label, value] of [["Number", "YA0000001"], ["Name on document", "MOON LUNA"], ["Nationality", "Italian"],
    ["Issuing country", "France"], ["Issued", "2016-01-02"], ["Expires", "2026-01-01"]]) {
    expect(within(card).getByText(label).nextElementSibling?.textContent).toBe(value)
  }
  expect(within(card).getByText("Expired")).toBeTruthy()
  expect(within(card).getByText("PDF, 1.5 MB")).toBeTruthy()
  const valid = screen.getByRole("article", { name: "Travel document: ID card" })
  expect(within(valid).queryByText("Expired")).toBeNull()
  expect(within(valid).getByText("No scan uploaded.")).toBeTruthy()
  // An expired document is still usable history: its scan can be downloaded.
  expect(within(card).getByRole("button", { name: "Download scan: Passport" })).toBeTruthy()
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

it("DATA-01 adds a document with nationality and issue date, keeps the draft after a failure and retries once per click", async () => {
  m.create.mockResolvedValueOnce({ success: false, error: "Unable to save the travel document. Please try again." }).mockResolvedValueOnce({ success: true })
  renderSection()
  fireEvent.click(screen.getByRole("button", { name: "Add travel document" }))
  const form = screen.getByRole("form", { name: "New travel document" })
  fireEvent.click(within(form).getByRole("button", { name: "Add travel document" }))
  expect((await within(form).findByRole("alert")).textContent).toBe("Enter the document number")
  fireEvent.change(within(form).getByLabelText("Document type"), { target: { value: "id_card" } })
  fireEvent.change(within(form).getByLabelText("Document number"), { target: { value: "CA00001" } })
  fireEvent.change(within(form).getByLabelText("Nationality"), { target: { value: "Italian" } })
  fireEvent.change(within(form).getByLabelText("Issue date"), { target: { value: "2024-02-29" } })
  fireEvent.click(within(form).getByRole("button", { name: "Add travel document" }))
  expect(await within(form).findByText("Unable to save the travel document. Please try again.")).toBeTruthy()
  expect((within(form).getByLabelText("Document number") as HTMLInputElement).value).toBe("CA00001")
  fireEvent.click(within(form).getByRole("button", { name: "Add travel document" }))
  await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce())
  expect(m.create).toHaveBeenCalledTimes(2)
  expect(m.create).toHaveBeenLastCalledWith("artist-a", { doc_type: "id_card", number: "CA00001", issuing_country: "", nationality: "Italian", issued_on: "2024-02-29", expires_on: "", holder_name: "" })
  // CORE-06: the form has no reason field.
  expect(Object.keys(m.create.mock.calls[0][1])).not.toContain("reason")
})

it("CORE-01 edits a document and deletes it through one inline confirmation (recoverable)", async () => {
  m.update.mockResolvedValueOnce({ success: true })
  m.remove.mockResolvedValueOnce({ success: true })
  renderSection()
  fireEvent.click(screen.getByRole("button", { name: "Edit travel document: Passport" }))
  const form = screen.getByRole("form", { name: "Edit travel document" })
  expect((within(form).getByLabelText("Document number") as HTMLInputElement).value).toBe("YA0000001")
  expect((within(form).getByLabelText("Nationality") as HTMLInputElement).value).toBe("Italian")
  fireEvent.change(within(form).getByLabelText("Expiry date"), { target: { value: "2034-01-01" } })
  fireEvent.click(within(form).getByRole("button", { name: "Save travel document" }))
  await waitFor(() => expect(m.update).toHaveBeenCalledWith("artist-a", "doc-1", expect.objectContaining({ expires_on: "2034-01-01", nationality: "Italian", issuing_country: "France" })))
  fireEvent.click(await screen.findByRole("button", { name: "Delete travel document: Passport" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
  await waitFor(() => expect(m.remove).toHaveBeenCalledWith("artist-a", "doc-1"))
})

it("URL-01 / CORE-06 download is one tap: no prompt, no reason, a same-origin POST with the file id, then the link", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: LINK }) })
  const prompt = vi.spyOn(window, "prompt")
  const confirm = vi.spyOn(window, "confirm")
  renderSection()
  fireEvent.click(screen.getByRole("button", { name: "Download scan: Passport" }))
  await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith(LINK))
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/travel-documents/files/${FILE}/download`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", credentials: "same-origin",
  })
  expect(prompt).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.queryByRole("textbox", { name: /reason/i })).toBeNull()
  // The link is never rendered or kept in the page.
  expect(document.body.innerHTML).not.toContain("token=T")
})

it("CORE-05 a refused or failed download shows fixed copy and navigates nowhere; a double tap sends one request", async () => {
  let release!: (value: unknown) => void
  fetchMock.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  renderSection()
  const button = screen.getByRole("button", { name: "Download scan: Passport" })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  release({ ok: false, json: async () => ({ error: "This scan is not available. Reload the page and try again." }) })
  expect((await screen.findByText("This scan is not available. Reload the page and try again.")).getAttribute("role")).toBe("alert")
  fetchMock.mockRejectedValueOnce(new Error("offline"))
  fireEvent.click(button)
  expect(await screen.findByText("Unable to download the scan. Please try again.")).toBeTruthy()
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: 42 }) })
  fireEvent.click(button)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  expect(assign).not.toHaveBeenCalled()
})

it("FILE-01 upload: reserve, send the file to the one-time link without overwrite, then the server check", async () => {
  m.reserve.mockResolvedValueOnce({ success: true, fileId: "file-new", uploadUrl: "https://project.supabase.co/upload?token=UP" })
  m.finalize.mockResolvedValueOnce({ success: true })
  fetchMock.mockResolvedValueOnce({ ok: true })
  renderSection()
  fireEvent.change(screen.getByLabelText("Upload scan: ID card"), { target: { files: [pdfFile("id.pdf", "")] } })
  await waitFor(() => expect(m.finalize).toHaveBeenCalledWith("artist-a", "file-new"))
  expect(m.reserve).toHaveBeenCalledExactlyOnceWith("artist-a", "doc-2")
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe("https://project.supabase.co/upload?token=UP")
  expect(init).toMatchObject({ method: "PUT", headers: { "x-upsert": "false" }, credentials: "omit" })
  const sent = (init.body as FormData).get("") as File
  // The declared type comes from the observed bytes, and the user's file name is not sent.
  expect(sent.type).toBe("application/pdf")
  expect(sent.name).toBe("scan")
  expect(await screen.findByText("Scan uploaded.")).toBeTruthy()
  expect(m.refresh).toHaveBeenCalledOnce()
})

it.each([
  ["a file that is not a PDF, JPEG, PNG or HEIC", () => new File(["<svg onload='x()'/>"], "passport.pdf", { type: "application/pdf" }), "Use a PDF, JPEG, PNG or HEIC file."],
  ["a file over 10 MB", () => pdfFile("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1), "The file must be 10 MB or smaller."],
  ["an empty file", () => pdfFile("empty.pdf", "application/pdf", 0), "The file must be 10 MB or smaller."],
])("FILE-01 %s is refused in the browser before anything is reserved", async (_label, file, message) => {
  renderSection()
  fireEvent.change(screen.getByLabelText("Replace scan: Passport"), { target: { files: [file()] } })
  expect(await screen.findByText(message)).toBeTruthy()
  expect(m.reserve).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})

it("FILE-01 / LIFE-10 a failed transfer or a rejected server check never reports success; the current scan stays", async () => {
  m.reserve.mockResolvedValue({ success: true, fileId: "file-new", uploadUrl: "https://project.supabase.co/upload?token=UP" })
  fetchMock.mockResolvedValueOnce({ ok: false })
  renderSection()
  const input = screen.getByLabelText("Replace scan: Passport")
  fireEvent.change(input, { target: { files: [pdfFile()] } })
  expect(await screen.findByText("Unable to upload the scan. Please try again.")).toBeTruthy()
  expect(m.finalize).not.toHaveBeenCalled()
  fetchMock.mockResolvedValueOnce({ ok: true })
  m.finalize.mockResolvedValueOnce({ success: false, error: "The file was not accepted. Use a PDF, JPEG, PNG or HEIC file of 10 MB or less." })
  fireEvent.change(input, { target: { files: [pdfFile()] } })
  expect(await screen.findByText("The file was not accepted. Use a PDF, JPEG, PNG or HEIC file of 10 MB or less.")).toBeTruthy()
  expect(screen.queryByText("Scan replaced.")).toBeNull()
  expect(m.refresh).not.toHaveBeenCalled()
  expect(within(screen.getByRole("article", { name: "Travel document: Passport" })).getByText("PDF, 1.5 MB")).toBeTruthy()
})

it("flag off: cards stay fully usable, scan controls are absent and the section says why", () => {
  renderSection({ ...profile, scansEnabled: false })
  expect(screen.getByText("Scan upload and download are not enabled yet. Document details can be recorded now.")).toBeTruthy()
  expect(screen.queryByRole("button", { name: /Download scan/ })).toBeNull()
  expect(screen.queryByLabelText(/Upload scan|Replace scan/)).toBeNull()
  expect(screen.getByRole("button", { name: "Edit travel document: Passport" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Add travel document" })).toBeTruthy()
})

it("LIFE-06 / LIFE-07 a missing scan is never offered for download; a restored one is, with its pending check stated", () => {
  renderSection({ ...profile, documents: [
    { ...profile.documents[0], scan: { fileId: FILE, state: "missing", mediaType: "application/pdf", byteSize: 10 } },
    { ...profile.documents[1], scan: { fileId: "f2", state: "restore_pending", mediaType: "image/heic", byteSize: 2048 } },
  ] })
  const missing = screen.getByRole("article", { name: "Travel document: Passport" })
  expect(within(missing).getByText("The scan file is missing. Upload it again.")).toBeTruthy()
  expect(within(missing).queryByRole("button", { name: /Download scan/ })).toBeNull()
  expect(within(missing).getByLabelText("Replace scan: Passport")).toBeTruthy()
  const restored = screen.getByRole("article", { name: "Travel document: ID card" })
  expect(within(restored).getByText("HEIC, 2 KB (checked on first download after a restore)")).toBeTruthy()
  expect(within(restored).getByRole("button", { name: "Download scan: ID card" })).toBeTruthy()
})

const archived = [
  { id: "old-1", doc_type: "passport" as const, holder_name: "MOON LUNA", expires_on: "2020-01-01", archived_at: "2026-11-01T10:00:00+00:00",
    restore_until: "2027-11-01T10:00:00+00:00", cause: "deleted" as const, restorable: true, hasScan: true },
  { id: "old-2", doc_type: "id_card" as const, holder_name: null, expires_on: null, archived_at: "2025-10-01T10:00:00+00:00",
    restore_until: "2026-10-01T10:00:00+00:00", cause: "relationship_ended" as const, restorable: false, hasScan: false },
]

it("LIFE-07 / LIFE-08 deleted documents: recovery view with the window, expired state kept, restore in one tap, nothing downloadable", async () => {
  m.restore.mockResolvedValueOnce({ success: true })
  renderSection({ ...profile, archived })
  const row = screen.getByRole("article", { name: "Deleted travel document: Passport" })
  expect(row.textContent).toContain("Deleted 2026-11-01. Can be restored until 2027-11-01.")
  expect(within(row).getByText("Expired")).toBeTruthy()
  expect(row.textContent).not.toContain("YA0000001")
  expect(within(row).queryByRole("button", { name: /Download/ })).toBeNull()
  const closed = screen.getByRole("article", { name: "Deleted travel document: ID card" })
  expect(closed.textContent).toContain("Relationship ended 2025-10-01. Can no longer be restored.")
  expect(within(closed).queryByRole("button", { name: /Restore/ })).toBeNull()
  fireEvent.click(within(row).getByRole("button", { name: "Restore travel document: Passport" }))
  await waitFor(() => expect(m.restore).toHaveBeenCalledExactlyOnceWith("artist-a", "old-1"))
  expect(m.refresh).toHaveBeenCalledOnce()
})

it("LIFE-08 a refused restore shows the fixed copy and keeps the row", async () => {
  m.restore.mockResolvedValueOnce({ success: false, error: "This travel document can no longer be restored." })
  renderSection({ ...profile, archived })
  fireEvent.click(screen.getByRole("button", { name: "Restore travel document: Passport" }))
  expect(await screen.findByText("This travel document can no longer be restored.")).toBeTruthy()
  expect(m.refresh).not.toHaveBeenCalled()
})

it("LIFE-05 end relationship asks once, then archives through its own action; nothing else is touched", async () => {
  m.end.mockResolvedValueOnce({ success: true })
  renderSection()
  fireEvent.click(screen.getByRole("button", { name: "End relationship with this artist" }))
  expect(m.end).not.toHaveBeenCalled()
  expect(screen.getByText("End the relationship and delete this artist's travel documents?")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Yes, end relationship" }))
  await waitFor(() => expect(m.end).toHaveBeenCalledExactlyOnceWith("artist-a"))
  expect(m.remove).not.toHaveBeenCalled()
  expect(m.refresh).toHaveBeenCalledOnce()
})

it("LIFE-05 while ended: no add, no restore, resume is explicit and restores nothing by itself", async () => {
  m.resume.mockResolvedValueOnce({ success: true })
  renderSection({ ...profile, documents: [], archived, relationshipEndedAt: "2026-11-20T09:00:00+00:00" })
  expect(screen.queryByRole("button", { name: "Add travel document" })).toBeNull()
  expect(screen.queryByRole("button", { name: /Restore travel document/ })).toBeNull()
  expect(screen.getByText(/Ended on 2026-11-20\./)).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Resume relationship" }))
  await waitFor(() => expect(m.resume).toHaveBeenCalledExactlyOnceWith("artist-a"))
  expect(m.restore).not.toHaveBeenCalled()
})

it("AUD-01 / AUD-03 activity is readable in place: action, who (no ids), booking context, and what a download entry means", () => {
  renderSection({ ...profile, activity: [
    { id: "e1", action: "download_issued", detail: null, documentId: "doc-1", actor: "you", withBooking: true, occurredAt: "2026-11-27T10:05:09.123+00:00" },
    { id: "e2", action: "download_not_issued", detail: "signer_failed", documentId: "doc-1", actor: "member", withBooking: false, occurredAt: "2026-11-27T10:04:00+00:00" },
    { id: "e3", action: "document_purged", detail: null, documentId: "gone", actor: "system", withBooking: false, occurredAt: "2026-10-01T00:00:00+00:00" },
    { id: "e4", action: "something_new", detail: null, documentId: null, actor: "member", withBooking: false, occurredAt: "2026-09-01T00:00:00+00:00" },
  ] })
  const list = screen.getByText("Activity (4 latest)").closest("details")!
  expect(list.textContent).toContain("2026-11-27 10:05Scan download link issuedYou, from a booking")
  expect(list.textContent).toContain("Scan download link not issuedTeam member")
  expect(list.textContent).toContain("Document removed for goodSystem")
  expect(list.textContent).toContain("Recorded actionTeam member")
  expect(list.textContent).toContain("A download entry means the app issued a link, not that the file was saved or forwarded.")
})

it("keeps what the member typed: fields are locked while the submitted draft is in flight and unlocked with the draft after a failure", async () => {
  let finish!: (value: { success: boolean; error?: string }) => void
  m.create.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  renderSection()
  fireEvent.click(screen.getByRole("button", { name: "Add travel document" }))
  const form = screen.getByRole("form", { name: "New travel document" })
  const number = within(form).getByLabelText("Document number") as HTMLInputElement
  fireEvent.change(number, { target: { value: "CA00001" } })
  fireEvent.click(within(form).getByRole("button", { name: "Add travel document" }))
  await waitFor(() => expect(m.create).toHaveBeenCalledOnce())
  // Nothing can be edited after the click, so nothing typed later can be dropped on success.
  expect(number.closest("fieldset")!.disabled).toBe(true)
  expect(number.matches(":disabled")).toBe(true)
  expect((within(form).getByLabelText("Nationality") as HTMLInputElement).matches(":disabled")).toBe(true)
  finish({ success: false, error: "Unable to save the travel document. Please try again." })
  expect(await within(form).findByText("Unable to save the travel document. Please try again.")).toBeTruthy()
  expect(number.matches(":disabled")).toBe(false)
  expect(number.value).toBe("CA00001")
})
