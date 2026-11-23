"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateArtistDefaultCommission } from "@/lib/actions/artists"
import { BOOKING_FEE_CURRENCIES, formatBookingFeeInput, type BookingFeeCurrency } from "@/lib/booking-fee"
import {
  COMMISSION_MODES, COMMISSION_MODE_LABELS, DEFAULT_COMMISSION_MODE, artistDefaultCommission, formatArtistDefaultCommission,
  formatBasisPoints, parseCommissionPercent, parseMoneyAmount,
  type ArtistDefaultCommissionInput, type CommissionMode, type CommissionType,
} from "@/lib/booking-finance"

interface ArtistDefaultCommissionProps {
  artistId: string
  type?: string | null
  value?: number | null
  mode?: string | null
  currency?: string | null
}

const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
const labelClass = "mb-1.5 block text-xs font-medium text-foreground"
/** Preselected currency of a new fixed default (decision 12). */
const INITIAL_CURRENCY: BookingFeeCurrency = "EUR"

/** Default agency commission of an artist: type, value and mode; a fixed amount has its own currency. */
export function ArtistDefaultCommission({ artistId, type, value, mode, currency }: ArtistDefaultCommissionProps) {
  const router = useRouter()
  const saved = artistDefaultCommission({
    default_commission_type: type, default_commission_value: value,
    default_commission_mode: mode, default_commission_currency: currency,
  })
  const [editing, setEditing] = useState(false)
  const [draftType, setDraftType] = useState<CommissionType | "">("")
  const [draftValue, setDraftValue] = useState("")
  const [draftMode, setDraftMode] = useState<CommissionMode>(DEFAULT_COMMISSION_MODE)
  const [draftCurrency, setDraftCurrency] = useState<BookingFeeCurrency>(INITIAL_CURRENCY)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  const startEdit = () => {
    setDraftType(saved?.type ?? "")
    setDraftValue(!saved ? "" : saved.type === "percent" || !saved.currency
      ? formatBasisPoints(saved.value) : formatBookingFeeInput(saved.value, saved.currency))
    setDraftMode(saved?.mode ?? DEFAULT_COMMISSION_MODE)
    setDraftCurrency(saved?.currency ?? INITIAL_CURRENCY)
    setError(null)
    setNotice("")
    setEditing(true)
  }

  const save = async () => {
    if (inFlight.current) return
    setError(null)
    let input: ArtistDefaultCommissionInput = null
    if (draftType === "percent") {
      const percent = parseCommissionPercent(draftValue)
      if (!percent.success) { setError(percent.error); return }
      input = { type: "percent", value: percent.data, mode: draftMode, currency: null }
    } else if (draftType === "fixed") {
      // Minor units of the chosen currency: two decimals for EUR, USD, GBP; whole numbers for JPY.
      const amount = parseMoneyAmount(draftValue, draftCurrency, "commission amount")
      if (!amount.success) { setError(amount.error); return }
      input = { type: "fixed", value: amount.data, mode: draftMode, currency: draftCurrency }
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
            <p className="font-medium">{formatArtistDefaultCommission(saved)}</p>
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
              <label htmlFor="artist-commission-type" className={labelClass}>Default commission type</label>
              <select id="artist-commission-type" value={draftType} disabled={saving} className={selectClass}
                onChange={(event) => { setDraftType(event.target.value as CommissionType | ""); setDraftValue(""); setError(null) }}>
                <option value="">No default commission</option>
                <option value="percent">Percentage of the fee</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            {draftType === "fixed" && (
              <div className="min-w-0">
                <label htmlFor="artist-commission-currency" className={labelClass}>Default commission currency</label>
                <select id="artist-commission-currency" value={draftCurrency} disabled={saving} className={selectClass}
                  onChange={(event) => { setDraftCurrency(event.target.value as BookingFeeCurrency); setError(null) }}>
                  {BOOKING_FEE_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </div>
            )}
            {draftType !== "" && (
              <div className="min-w-0">
                <label htmlFor="artist-commission-value" className={labelClass}>
                  {draftType === "percent" ? "Default commission percentage (%)" : `Default commission amount (${draftCurrency})`}
                </label>
                <Input id="artist-commission-value" type="text" inputMode="decimal" autoComplete="off" value={draftValue} disabled={saving}
                  aria-invalid={error !== null} aria-describedby="artist-commission-help"
                  onChange={(event) => { setDraftValue(event.target.value); setError(null) }} className="h-9 min-w-0 text-sm" />
              </div>
            )}
            {draftType !== "" && (
              <div className="min-w-0 sm:col-span-2">
                <label htmlFor="artist-commission-mode" className={labelClass}>Default commission mode</label>
                <select id="artist-commission-mode" value={draftMode} disabled={saving} className={selectClass}
                  onChange={(event) => { setDraftMode(event.target.value as CommissionMode); setError(null) }}>
                  {COMMISSION_MODES.map((option) => <option key={option} value={option}>{COMMISSION_MODE_LABELS[option]}</option>)}
                </select>
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
        A fixed amount is prefilled only on bookings whose fee is in the same currency; nothing is converted.
      </p>
      {notice && <p role="status" className="text-sm text-foreground">{notice}</p>}
    </section>
  )
}
