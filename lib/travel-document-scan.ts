// Scan policy for artist travel documents (owner parameters, 2026-11-27). Pure: shared by the
// browser (early feedback) and the server (authoritative check on the stored bytes).
// The same limits are a CHECK in migration 009 and the bucket settings in storage-provision.sql.

export const TRAVEL_DOCUMENT_BUCKET = "artist-travel-documents"
export const SCAN_MAX_BYTES = 10 * 1024 * 1024
/** Lifetime of a signed download link, in seconds. Fixed here; never chosen by a request. */
export const SCAN_DOWNLOAD_TTL_SECONDS = 60

export const SCAN_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic"] as const
export type ScanMediaType = (typeof SCAN_MEDIA_TYPES)[number]
export const SCAN_MEDIA_TYPE_LABELS: Record<ScanMediaType, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/heic": "HEIC",
}
const SCAN_EXTENSIONS: Record<ScanMediaType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
}
export const SCAN_FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
/** Enough leading bytes to recognise every accepted type, HEIC brand list included. */
export const SCAN_SNIFF_BYTES = 4096

export const SCAN_TYPE_MESSAGE = "Use a PDF, JPEG, PNG or HEIC file."
export const SCAN_SIZE_MESSAGE = "The file must be 10 MB or smaller."

export function isScanMediaType(value: unknown): value is ScanMediaType {
  return typeof value === "string" && (SCAN_MEDIA_TYPES as readonly string[]).includes(value)
}

/** Download name without personal data: the document type and the observed file type only. */
export function scanDownloadName(docType: string, mediaType: ScanMediaType): string {
  const stem = /^[a-z_]{1,20}$/.test(docType) ? docType.replace(/_/g, "-") : "document"
  return `${stem}-scan.${SCAN_EXTENSIONS[mediaType]}`
}

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"])
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to))
const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value)

/**
 * Media type from the observed leading bytes, never from the declared type or the file name.
 * PDF: "%PDF-". JPEG: FF D8 FF. PNG: the 8-byte signature. HEIC: an ISO-BMFF "ftyp" box whose
 * major brand, or one compatible brand of a mif1 / msf1 file, is an HEVC image brand (so AVIF
 * and video files are not accepted). Returns null for anything else.
 * A recognised type is not a malware verdict: scans are only ever delivered as attachments.
 */
export function sniffScanMediaType(bytes: Uint8Array): ScanMediaType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const major = ascii(bytes, 8, 12)
    if (HEIC_BRANDS.has(major)) return "image/heic"
    if (major === "mif1" || major === "msf1") {
      const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
      const end = Math.min(boxSize, bytes.length)
      for (let offset = 16; offset + 4 <= end; offset += 4) {
        if (HEIC_BRANDS.has(ascii(bytes, offset, offset + 4))) return "image/heic"
      }
    }
  }
  return null
}

/** Server-side verdict on the complete stored object. */
export function inspectScanBytes(bytes: Uint8Array): { ok: true; mediaType: ScanMediaType; byteSize: number } | { ok: false } {
  if (bytes.length < 1 || bytes.length > SCAN_MAX_BYTES) return { ok: false }
  const mediaType = sniffScanMediaType(bytes.subarray(0, SCAN_SNIFF_BYTES))
  return mediaType ? { ok: true, mediaType, byteSize: bytes.length } : { ok: false }
}
