"use client"

import { useId, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  createBookingStay, deleteBookingStay, updateBookingStay, type BookingStay,
} from "@/lib/actions/booking-travel"
import { bookingStaySchema, firstIssue } from "@/lib/booking-travel-validation"
import {
  DeleteControl, FormActions, TextAreaField, TextField, UnavailableNotice, useGuardedAction,
} from "./form-kit"

type StayDraft = {
  name: string
  address: string
  check_in_on: string
  check_out_on: string
  confirmation_ref: string
  notes: string
}

function draftFrom(stay?: BookingStay): StayDraft {
  return {
    name: stay?.name ?? "",
    address: stay?.address ?? "",
    check_in_on: stay?.check_in_on ?? "",
    check_out_on: stay?.check_out_on ?? "",
    confirmation_ref: stay?.confirmation_ref ?? "",
    notes: stay?.notes ?? "",
  }
}

interface BookingStaysPanelProps {
  bookingId: string
  /** null: the scoped read failed; the panel says so instead of showing an empty list. */
  stays: BookingStay[] | null
}

export function BookingStaysPanel({ bookingId, stays }: BookingStaysPanelProps) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section aria-labelledby="booking-stays-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="booking-stays-heading" className="text-base font-medium text-foreground">Accommodation</h2>
        {stays !== null && !adding && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add accommodation
          </Button>
        )}
      </div>
      {stays === null ? (
        <UnavailableNotice>Accommodation could not be loaded. Reload the page to try again.</UnavailableNotice>
      ) : (
        <>
          {adding && <StayForm bookingId={bookingId} onDone={() => setAdding(false)} />}
          {stays.length === 0 && !adding && (
            <p className="text-sm text-muted-foreground">No accommodation yet.</p>
          )}
          <ul className="space-y-3">
            {stays.map(stay => (
              <li key={stay.id}>
                {editingId === stay.id ? (
                  <StayForm bookingId={bookingId} stay={stay} onDone={() => setEditingId(null)} />
                ) : (
                  <StayCard bookingId={bookingId} stay={stay} onEdit={() => setEditingId(stay.id)} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function StayCard({ bookingId, stay, onEdit }: { bookingId: string; stay: BookingStay; onEdit: () => void }) {
  const router = useRouter()
  const remove = useGuardedAction()
  const details: [string, string | null][] = [
    ["Address", stay.address],
    ["Check-in", stay.check_in_on],
    ["Check-out", stay.check_out_on],
    ["Confirmation reference", stay.confirmation_ref],
    ["Notes", stay.notes],
  ]
  return (
    <article aria-label={`Accommodation: ${stay.name}`} className="min-w-0 space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-medium text-foreground">{stay.name}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onEdit} aria-label={`Edit accommodation: ${stay.name}`}>Edit</Button>
          <DeleteControl label={`Delete accommodation: ${stay.name}`} onConfirm={async () => {
            const ok = await remove.run(() => deleteBookingStay(bookingId, stay.id), "Unable to delete the accommodation. Please try again.")
            if (ok) router.refresh()
            return ok
          }} />
        </div>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {details.filter(([, value]) => value).map(([label, value]) => (
          <div key={label} className="min-w-0 whitespace-pre-wrap break-words">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {remove.error && <p role="alert" className="text-sm text-destructive">{remove.error}</p>}
    </article>
  )
}

function StayForm({ bookingId, stay, onDone }: { bookingId: string; stay?: BookingStay; onDone: () => void }) {
  const router = useRouter()
  const id = useId()
  const [draft, setDraft] = useState<StayDraft>(() => draftFrom(stay))
  const save = useGuardedAction()
  const set = (field: keyof StayDraft) => (value: string) => setDraft(current => ({ ...current, [field]: value }))
  const fieldId = (name: string) => `${id}-${name}`

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = bookingStaySchema.safeParse(draft)
    if (!parsed.success) {
      save.setError(firstIssue(parsed.error))
      return
    }
    const ok = await save.run(
      () => stay ? updateBookingStay(bookingId, stay.id, draft) : createBookingStay(bookingId, draft),
      "Unable to save the accommodation. Please try again.",
    )
    if (ok) {
      onDone()
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={stay ? "Edit accommodation" : "New accommodation"}
      className="min-w-0 space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField id={fieldId("name")} label="Accommodation name" value={draft.name} onChange={set("name")} maxLength={200} />
        <TextField id={fieldId("confirmation")} label="Confirmation reference" value={draft.confirmation_ref} onChange={set("confirmation_ref")} maxLength={100} />
        <TextField id={fieldId("check-in")} label="Check-in date" type="date" value={draft.check_in_on} onChange={set("check_in_on")} />
        <TextField id={fieldId("check-out")} label="Check-out date" type="date" value={draft.check_out_on} onChange={set("check_out_on")} />
        <TextAreaField id={fieldId("address")} label="Address" value={draft.address} onChange={set("address")} maxLength={1000} />
        <TextAreaField id={fieldId("notes")} label="Notes" value={draft.notes} onChange={set("notes")} maxLength={2000} />
      </div>
      <FormActions pending={save.pending} error={save.error} saveLabel={stay ? "Save accommodation" : "Add accommodation"} onCancel={onDone} />
    </form>
  )
}
