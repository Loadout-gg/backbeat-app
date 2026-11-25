// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
const server = vi.hoisted(() => ({ exportCsv: vi.fn() }))
vi.mock("@/lib/actions/artist-export", () => ({ exportArtistsCsv: server.exportCsv }))
import ArtistsListClient from "@/app/dashboard/artists/artists-list-client"
import { ARTIST_EXPORT_ERROR } from "@/lib/artist-csv"

const artist = { id: "a", name: "Mila", surname: null, stage_name: "Aurora", genres: [], location: null, fee: null, currency: null }
const createObjectURL = vi.fn(() => "blob:artists")
const revokeObjectURL = vi.fn()
let clicked: HTMLAnchorElement[] = []
beforeEach(() => {
  clicked = []
  vi.clearAllMocks()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it("downloads the server CSV with the server file name", async () => {
  server.exportCsv.mockResolvedValue({ success: true, csv: "﻿Artist ID\r\na\r\n", fileName: "artists-2026-11-23.csv", count: 1 })
  render(<ArtistsListClient artists={[artist]} />)
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }))
  expect(await screen.findByText("Exported 1 artist.")).toBeTruthy()
  expect(server.exportCsv).toHaveBeenCalledOnce()
  expect(clicked).toHaveLength(1)
  expect(clicked[0].download).toBe("artists-2026-11-23.csv")
  expect(clicked[0].getAttribute("href")).toBe("blob:artists")
  const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
  expect(blob.type).toBe("text/csv;charset=utf-8")
  expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:artists")
})

it("shows fixed error copy and downloads nothing on failure", async () => {
  server.exportCsv.mockResolvedValue({ success: false, error: "provider said: permission denied" })
  render(<ArtistsListClient artists={[artist]} />)
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }))
  expect((await screen.findByRole("alert")).textContent).toBe(ARTIST_EXPORT_ERROR)
  expect(screen.queryByText(/permission denied/)).toBeNull()
  expect(clicked).toHaveLength(0)
})

it("shows fixed error copy when the action call itself rejects", async () => {
  server.exportCsv.mockRejectedValue(new Error("fetch failed: secret detail"))
  render(<ArtistsListClient artists={[artist]} />)
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }))
  expect((await screen.findByRole("alert")).textContent).toBe(ARTIST_EXPORT_ERROR)
  expect(screen.queryByText(/secret detail/)).toBeNull()
})

it("reports an empty server result without downloading", async () => {
  server.exportCsv.mockResolvedValue({ success: true, csv: "﻿Artist ID\r\n", fileName: "artists-2026-11-23.csv", count: 0 })
  render(<ArtistsListClient artists={[artist]} />)
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }))
  expect(await screen.findByText("There are no artists to export.")).toBeTruthy()
  expect(clicked).toHaveLength(0)
})

it("disables export for an empty roster", () => {
  render(<ArtistsListClient artists={[]} />)
  expect((screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement).disabled).toBe(true)
})

it("disables the control while an export is running", async () => {
  let resolve!: (value: unknown) => void
  server.exportCsv.mockReturnValue(new Promise((r) => { resolve = r }))
  render(<ArtistsListClient artists={[artist]} />)
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }))
  expect((screen.getByRole("button", { name: "Exporting…" }) as HTMLButtonElement).disabled).toBe(true)
  resolve({ success: false, error: "x" })
  await waitFor(() => expect((screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement).disabled).toBe(false))
})
