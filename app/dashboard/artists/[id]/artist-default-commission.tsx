"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateArtistDefaultCommission } from "@/lib/actions/artists"
import { formatBookingFeeInput } from "@/lib/booking-fee"
import {
  COMMISSION_TYPES, formatBasisPoints, formatCommissionValue, parseCommissionPercent, parseMoneyAmount,
  type CommissionType,
} from "@/lib/booking-finance"

interface ArtistDefaultCommissionProps {
  artistId: string
  type?: string | null
  value?: number | null
}

const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

/** Default agency commission of an artist: type + value, no mode and no currency of its own. */
export function ArtistDefaultCommission({ artistId, type, value }: ArtistDefaultCommissionProps) {
  const router = useRouter()
  const savedType = COMMISSION_TYPES.find((candidate) => candidate === type) ?? null
  const saved = savedType && typeof value === "number" ? { type: savedType, value } : null
  const [editing, setEditing] = useState(false)
  const [draftType, setDraftType] = useState<CommissionType | "">("")
  const [draftValue, setDraftValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  const startEdit = () => {
    setDraftType(saved?.type ?? "")
    setDraftValue(!saved ? "" : saved.type === "percent" ? formatBasisPoints(saved.value) : formatBookingFeeInput(saved.value, "EUR"))
    setError(null)
    setNotice("")
    setEditing(true)
  }

  const save = async () => {
    if (inFlight.current) return
    setError(null)
    let input: { type: CommissionType; value: number } | null = null
    if (draftType === "percent") {
      const percent = parseCommissionPercent(draftValue)
      if (!percent.success) { setError(percent.error); return }
      input = { type: "percent", value: percent.data }
    } else if (draftType === "fixed") {
      // No currency of its own: entered with two decimals, applied in each booking's fee currency.
      const amount = parseMoneyAmount(draftValue, "EUR", "commission amount")
      if (!amount.success) { setError(amount.error); return }
      input = { type: "fixed", value: amount.data }
    }
    inFlight.current = true
    setSaving(true)
    try {
      const result = await updateArtistDefaultCommission(artistId, input)
      if (!result.success) {
        setError(result.error || "Unable to save the default commission. Please try again.")
        return
      }
      setEditing(false)
      setNotice("Default commission saved.")
      router.refresh()
    } catch {
      setError("Unable to confirm the change. Reload the artist before retrying.")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="artist-default-commission-heading" className="sm:col-span-2 space-y-2">
      <p id="artist-default-commission-heading" className="text-sm text-muted-foreground">Default agency commission</p>
      {!editing ? (
        <div className="flex flex-wrap items-center gap-3">
          {saved ? (
            <p className="font-medium">
              {saved.type === "percent"
                ? `${formatCommissionValue("percent", saved.value, null)} of the booking fee`
                : `${formatCommissionValue("fixed", saved.value, null)} fixed, in each booking's fee currency`}
            </p>
          ) : (
            <p className="text-muted-foreground italic">Not specified</p>
          )}
          <Button type="button" size="sm" variant="outline" onClick={startEdit}>
            {saved ? "Edit default commission" : "Set default commission"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="artist-commission-type" className="mb-1.5 block text-xs font-medium text-foreground">Default commission type</label>
              <select id="artist-commission-type" value={draftType} disabled={saving} className={selectClass}
                onChange={(event) => { setDraftType(event.target.value as CommissionType | ""); setDraftValue(""); setError(null) }}>
                <option value="">No default commission</option>
                <option value="percent">Percentage of the fee</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            {draftType !== "" && (
              <div className="min-w-0">
                <label htmlFor="artist-commission-value" className="mb-1.5 block text-xs font-medium text-foreground">
                  {draftType === "percent" ? "Default commission percentage (%)" : "Default commission amount (booking fee currency)"}
                </label>
                <Input id="artist-commission-value" type="text" inputMode="decimal" autoComplete="off" value={draftValue} disabled={saving}
                  aria-invalid={error !== null} aria-describedby="artist-commission-help"
                  onChange={(event) => { setDraftValue(event.target.value); setError(null) }} className="h-9 min-w-0 text-sm" />
              </div>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={save} aria-disabled={saving} className="aria-disabled:cursor-wait aria-disabled:opacity-50">
              {saving ? "Saving..." : "Save default commission"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}
      <p id="artist-commission-help" className="text-xs text-muted-foreground">
        Prefilled on new bookings of this artist and editable on each booking; existing bookings are not changed.
        A fixed amount has no currency of its own: it is applied in the fee currency of each booking.
      </p>
      {notice && <p role="status" className="text-sm text-foreground">{notice}</p>}
    </section>
  )
}
