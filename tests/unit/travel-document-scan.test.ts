// FILE-01 (LOCAL_INPROCESS): the scan policy is decided on observed bytes.
import { expect, it } from "vitest"
import {
  SCAN_DOWNLOAD_TTL_SECONDS, SCAN_MAX_BYTES, SCAN_MEDIA_TYPES, inspectScanBytes, scanDownloadName, sniffScanMediaType,
} from "@/lib/travel-document-scan"

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)
function ftyp(major: string, compatible: string[] = []) {
  const size = 16 + compatible.length * 4
  const box = new Uint8Array(size + 8)
  box.set([0, 0, 0, size])
  box.set(text("ftyp" + major), 4)
  compatible.forEach((brand, index) => box.set(text(brand), 16 + index * 4))
  return box
}

it("FILE-01 owner parameters: four types, 10 MB, 60 s link", () => {
  expect(SCAN_MEDIA_TYPES).toEqual(["application/pdf", "image/jpeg", "image/png", "image/heic"])
  expect(SCAN_MAX_BYTES).toBe(10485760)
  expect(SCAN_DOWNLOAD_TTL_SECONDS).toBe(60)
})

it.each([
  ["PDF", text("%PDF-1.7\n"), "application/pdf"],
  ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), "image/jpeg"],
  ["PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "image/png"],
  ["HEIC major brand", ftyp("heic", ["mif1", "heic"]), "image/heic"],
  ["HEIC as mif1 with a compatible HEVC brand", ftyp("mif1", ["mif1", "heic"]), "image/heic"],
])("FILE-01 recognises %s from its leading bytes", (_label, input, expected) => {
  expect(sniffScanMediaType(input)).toBe(expected)
})

it.each([
  ["empty", bytes()],
  ["HTML", text("<!doctype html><script>alert(1)</script>")],
  ["SVG", text('<?xml version="1.0"?><svg onload="x()"/>')],
  ["GIF", text("GIF89a")],
  ["ZIP / DOCX", bytes(0x50, 0x4b, 0x03, 0x04)],
  ["Windows executable", text("MZ\u0090\u0000")],
  ["AVIF (mif1 without an HEVC brand)", ftyp("mif1", ["avif", "miaf"])],
  ["AVIF major brand", ftyp("avif", ["mif1"])],
  ["MP4 video", ftyp("isom", ["mp42"])],
  ["PDF marker not at the start", text(" %PDF-1.7")],
  ["a compatible brand outside the declared box", (() => { const box = ftyp("mif1", ["avif"]); const longer = new Uint8Array(box.length + 4); longer.set(box); longer.set(text("heic"), 20); return longer })()],
])("FILE-01 refuses %s", (_label, input) => {
  expect(sniffScanMediaType(input)).toBeNull()
})

it("FILE-01 size limits are inclusive at 10 MB and exclusive at zero", () => {
  const pdf = (size: number) => { const data = new Uint8Array(size); data.set(text("%PDF-")); return data }
  expect(inspectScanBytes(pdf(SCAN_MAX_BYTES))).toEqual({ ok: true, mediaType: "application/pdf", byteSize: SCAN_MAX_BYTES })
  expect(inspectScanBytes(pdf(SCAN_MAX_BYTES + 1))).toEqual({ ok: false })
  expect(inspectScanBytes(new Uint8Array(0))).toEqual({ ok: false })
})

it("URL-01 download name carries the document type and extension only", () => {
  expect(scanDownloadName("passport", "application/pdf")).toBe("passport-scan.pdf")
  expect(scanDownloadName("id_card", "image/heic")).toBe("id-card-scan.heic")
  expect(scanDownloadName("../../etc/passwd", "image/png")).toBe("document-scan.png")
  expect(scanDownloadName("ROSSI MARIO YA0000001", "image/jpeg")).toBe("document-scan.jpg")
})
