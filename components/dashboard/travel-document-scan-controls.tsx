"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { finalizeTravelDocumentScan, reserveTravelDocumentScan } from "@/lib/actions/artist-travel-documents"
import { getSupabaseEnvironment } from "@/lib/supabase/environment"
import {
  SCAN_FILE_ACCEPT, SCAN_MAX_BYTES, SCAN_SIZE_MESSAGE, SCAN_SNIFF_BYTES, SCAN_TYPE_MESSAGE, sniffScanMediaType,
} from "@/lib/travel-document-scan"

const DOWNLOAD_FAILED = "Unable to download the scan. Please try again."
const UPLOAD_FAILED = "Unable to upload the scan. Please try again."

/**
 * One tap: asks the app for a short-lived link to this exact scan version and hands it to the
 * browser as a file download. No prompt, no reason, no confirmation. The app records who asked
 * and when; the optional booking only says which booking the member was working on.
 */
export function ScanDownloadButton({ fileId, bookingId, label }: {
  fileId: string
  bookingId?: string
  label: string
}) {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/travel-documents/files/${encodeURIComponent(fileId)}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingId ? { bookingId } : {}),
        cache: "no-store",
        credentials: "same-origin",
      })
      const body: unknown = await response.json().catch(() => null)
      const url = body && typeof body === "object" && "url" in body ? (body as { url: unknown }).url : null
      if (!response.ok || typeof url !== "string" || !url) {
        const message = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null
        setError(typeof message === "string" && message ? message : DOWNLOAD_FAILED)
        return
      }
      // Attachment link: the browser saves the file and stays on this page.
      window.location.assign(url)
    } catch {
      setError(DOWNLOAD_FAILED)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={download} aria-label={label}
        aria-disabled={pending} className="min-h-9 aria-disabled:cursor-wait aria-disabled:opacity-50">
        <Download className="mr-1 h-4 w-4" aria-hidden="true" />
        {pending ? "Preparing..." : "Download scan"}
      </Button>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </span>
  )
}

/**
 * Upload or replace the scan of a card: reserve a version, send the file straight to private
 * storage with a one-time upload link, then let the server check the stored bytes. The scan
 * is usable only after that check; a replaced scan is kept privately for 12 months.
 */
export function ScanUploadButton({ artistId, documentId, label, replace }: {
  artistId: string
  documentId: string
  label: string
  replace: boolean
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || inFlight.current) return
    setNotice("")
    if (file.size < 1 || file.size > SCAN_MAX_BYTES) {
      setError(SCAN_SIZE_MESSAGE)
      return
    }
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      // Early feedback only; the server decides on the stored bytes.
      const mediaType = sniffScanMediaType(new Uint8Array(await file.slice(0, SCAN_SNIFF_BYTES).arrayBuffer()))
      if (!mediaType) {
        setError(SCAN_TYPE_MESSAGE)
        return
      }
      const reserved = await reserveTravelDocumentScan(artistId, documentId)
      if (!reserved.success) {
        setError(reserved.error || UPLOAD_FAILED)
        return
      }
      const form = new FormData()
      form.append("cacheControl", "0")
      form.append("", new File([file], "scan", { type: mediaType }))
      // Same request the Storage client makes for a signed upload, but session-less: the public
      // project key only, never the member's session. The one-time token in the link is the
      // only upload capability, and "x-upsert: false" means it can never replace stored bytes.
      const { key } = getSupabaseEnvironment()
      const stored = await fetch(reserved.uploadUrl, {
        method: "PUT", body: form, cache: "no-store", credentials: "omit",
        headers: { "x-upsert": "false", ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}) },
      })
      if (!stored.ok) {
        setError(UPLOAD_FAILED)
        return
      }
      const finalized = await finalizeTravelDocumentScan(artistId, reserved.fileId)
      if (!finalized.success) {
        setError(finalized.error || UPLOAD_FAILED)
        return
      }
      setNotice(replace ? "Scan replaced." : "Scan uploaded.")
      router.refresh()
    } catch {
      setError("Unable to confirm the upload. Reload the page before retrying.")
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <input ref={input} type="file" accept={SCAN_FILE_ACCEPT} className="sr-only" tabIndex={-1}
        aria-label={label} onChange={upload} />
      <Button type="button" size="sm" variant="outline" disabled={pending} className="min-h-9"
        onClick={() => input.current?.click()}>
        <Upload className="mr-1 h-4 w-4" aria-hidden="true" />
        {pending ? "Uploading..." : replace ? "Replace scan" : "Upload scan"}
      </Button>
      <span role="status" aria-live="polite" className="text-sm text-foreground">{notice}</span>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </span>
  )
}
