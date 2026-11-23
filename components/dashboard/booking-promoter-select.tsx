"use client"

import { useEffect, useState } from "react"
import { listPromoters, type PromoterOption } from "@/lib/actions/events"
import { promoterOptionLabel } from "@/lib/booking-event"

interface BookingPromoterSelectProps {
  id: string
  /** Selected promoter id; "" means no promoter. */
  value: string
  onChange: (promoterId: string) => void
  /**
   * Promoter directory options already read by the page; null when that read failed.
   * Omit it to let the control read the directory itself (create modal).
   */
  options?: readonly PromoterOption[] | null
  disabled?: boolean
  className?: string
}

/**
 * Optional promoter of a booking, chosen from the promoter directory. It never touches the
 * free-text main contact. A failed directory read is shown as such; the booking can still be
 * saved, and the stored promoter is left unchanged.
 */
export function BookingPromoterSelect({ id, value, onChange, options, disabled, className }: BookingPromoterSelectProps) {
  const selfLoading = options === undefined
  const [loaded, setLoaded] = useState<readonly PromoterOption[] | null | undefined>(undefined)

  useEffect(() => {
    if (!selfLoading) return
    let current = true
    void (async () => {
      try {
        const result = await listPromoters()
        if (current) setLoaded(result)
      } catch {
        // A failed read is shown as "could not be loaded", never as an empty directory.
        if (current) setLoaded(null)
      }
    })()
    return () => { current = false }
  }, [selfLoading])

  const available = selfLoading ? loaded : options
  const loading = available === undefined
  const failed = available === null
  const list = available ?? []
  // A stored promoter missing from the options (failed or stale read) stays selected and unnamed.
  const unknownValue = value !== "" && !list.some(option => option.id === value)
  const helpId = `${id}-help`
  const help = failed
    ? "Promoters could not be loaded. You can still save; the promoter stays as it is."
    : loading
      ? "Loading promoters..."
      : list.length === 0
        ? "No promoters in the directory yet. Optional."
        : "Optional. From the promoter directory; the main contact stays as typed."

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-foreground">Promoter</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || failed || loading}
        aria-describedby={helpId}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="">No promoter</option>
        {unknownValue && <option value={value}>Current promoter</option>}
        {list.map(option => <option key={option.id} value={option.id}>{promoterOptionLabel(option)}</option>)}
      </select>
      {/* Not an alert: the promoter is optional and this never blocks saving. */}
      <p id={helpId} className={`mt-1.5 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}>
        {help}
      </p>
    </div>
  )
}
