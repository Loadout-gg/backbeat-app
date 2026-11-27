"use client"

import { useRef, useState, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

/**
 * Duplicate-submit guard shared by the travel, accommodation and travel-document forms:
 * one request at a time (ref, not state, so a double click in the same tick is ignored),
 * fixed error copy on failure, and the caller keeps its draft so a retry resends it.
 */
export function useGuardedAction() {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(
    action: () => Promise<{ success: boolean; error?: string }>,
    fallback: string,
  ): Promise<boolean> {
    if (inFlight.current) return false
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const result = await action()
      if (!result.success) {
        setError(result.error || fallback)
        return false
      }
      return true
    } catch {
      // The request may or may not have reached the server: say so, never claim success.
      setError("Unable to confirm the change. Reload the page before retrying.")
      return false
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return { pending, error, setError, run }
}

const controlClass = "h-9 min-w-0 text-sm"
export const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

export function TextField({ id, label, value, onChange, type = "text", maxLength, autoComplete = "off", className, step }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "date" | "time" | "tel"
  maxLength?: number
  autoComplete?: string
  className?: string
  step?: number
}) {
  return (
    <div className={className ? `min-w-0 ${className}` : "min-w-0"}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
      <Input id={id} type={type} value={value} maxLength={maxLength} autoComplete={autoComplete} step={step}
        onChange={event => onChange(event.target.value)} className={controlClass} />
    </div>
  )
}

export function TextAreaField({ id, label, value, onChange, maxLength, className }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  className?: string
}) {
  return (
    <div className={className ? `min-w-0 ${className}` : "min-w-0"}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
      <Textarea id={id} value={value} maxLength={maxLength} onChange={event => onChange(event.target.value)}
        className="min-h-[72px] min-w-0 resize-y text-sm" />
    </div>
  )
}

/**
 * Field group of an inline form. While the submitted draft is in flight the fields are locked,
 * so nothing typed after the click can be dropped when the form closes on success. On a failure
 * the lock lifts and the draft is still there for a retry.
 */
export function FormFields({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <fieldset disabled={pending} aria-busy={pending} className="m-0 min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">
      {children}
    </fieldset>
  )
}

/** Save / cancel row of an inline form; the error stays visible next to the retry button. */
export function FormActions({ pending, error, saveLabel, onCancel }: {
  pending: boolean
  error: string | null
  saveLabel: string
  onCancel: () => void
}) {
  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" aria-disabled={pending} className="aria-disabled:cursor-wait aria-disabled:opacity-50">
          {pending ? "Saving..." : saveLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </div>
  )
}

/**
 * Inline confirmation for a change that takes something out of view (delete, end relationship),
 * the same pattern as the booking delete control. Never used for a read or a download.
 */
export function DeleteControl({ label, onConfirm, trigger = "Delete", question = "Delete?", confirm = "Yes, delete", working = "Deleting..." }: {
  label: string
  onConfirm: () => Promise<boolean>
  trigger?: string
  question?: string
  confirm?: string
  working?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)} aria-label={label}>
        {trigger}
      </Button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">{question}</span>
      <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={async () => {
        if (inFlight.current) return
        inFlight.current = true
        setPending(true)
        try {
          if (await onConfirm()) setConfirming(false)
        } finally {
          inFlight.current = false
          setPending(false)
        }
      }}>
        {pending ? working : confirm}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
    </div>
  )
}

export function UnavailableNotice({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{children}</p>
}

/** "21:15:00" -> "21:15"; null stays null. Display only. */
export function shortTime(value: string | null): string | null {
  return value ? value.slice(0, 5) : null
}
