"use client"

import { useId, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  createArtistTravelDocument, deleteArtistTravelDocument, updateArtistDateOfBirth,
  updateArtistTravelDocument, type ArtistTravelDocument, type ArtistTravelProfile,
} from "@/lib/actions/artist-travel-documents"
import {
  TRAVEL_DOCUMENT_TYPES, TRAVEL_DOCUMENT_TYPE_LABELS, dateOfBirthSchema, firstIssue, travelDocumentSchema,
  type TravelDocumentType,
} from "@/lib/booking-travel-validation"
import {
  DeleteControl, FormActions, TextField, UnavailableNotice, selectClass, useGuardedAction,
} from "@/components/dashboard/booking-travel/form-kit"

interface ArtistTravelDocumentsSectionProps {
  artistId: string
  /** null: the scoped read failed; the section says so instead of showing an empty list. */
  profile: ArtistTravelProfile | null
  /** Configured calendar day, for the "not in the future" date-of-birth rule. */
  today: string
}

/** Dedicated artist-profile section for identity documents and date of birth (decision 3). */
export function ArtistTravelDocumentsSection({ artistId, profile, today }: ArtistTravelDocumentsSectionProps) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <Card>
      <CardContent className="space-y-6 p-4 sm:p-6">
        <section aria-labelledby="travel-documents-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="travel-documents-heading" className="text-xl font-semibold">Travel documents</h3>
            {profile !== null && !adding && (
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add travel document
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Sensitive personal data, used to book travel. Visible to every active member of this workspace and
            shown read-only in the Travel tab of this artist&apos;s bookings. Not included in lists or exports.
          </p>
          {profile === null ? (
            <UnavailableNotice>Travel documents could not be loaded. Reload the page to try again.</UnavailableNotice>
          ) : (
            <>
              <DateOfBirthForm artistId={artistId} saved={profile.dateOfBirth} today={today} />
              {adding && <DocumentForm artistId={artistId} onDone={() => setAdding(false)} />}
              {profile.documents.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground">No travel documents yet.</p>
              )}
              <ul className="space-y-3">
                {profile.documents.map(document => (
                  <li key={document.id}>
                    {editingId === document.id ? (
                      <DocumentForm artistId={artistId} document={document}
                        onDone={() => setEditingId(current => current === document.id ? null : current)} />
                    ) : (
                      <DocumentCard artistId={artistId} document={document} today={today} onEdit={() => setEditingId(document.id)} />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function DateOfBirthForm({ artistId, saved, today }: { artistId: string; saved: string | null; today: string }) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState(saved ?? "")
  const [notice, setNotice] = useState("")
  const save = useGuardedAction()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setNotice("")
    const parsed = dateOfBirthSchema(today).safeParse(value)
    if (!parsed.success) {
      save.setError(firstIssue(parsed.error))
      return
    }
    const ok = await save.run(() => updateArtistDateOfBirth(artistId, value || null), "Unable to save the date of birth. Please try again.")
    if (ok) {
      setNotice("Date of birth saved.")
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Artist date of birth" className="flex min-w-0 flex-wrap items-end gap-3">
      <TextField id={`${id}-dob`} label="Date of birth" type="date" value={value}
        onChange={next => { setValue(next); setNotice("") }} className="w-full max-w-xs" />
      <Button type="submit" size="sm" variant="outline" aria-disabled={save.pending} className="aria-disabled:cursor-wait aria-disabled:opacity-50">
        {save.pending ? "Saving..." : "Save date of birth"}
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-foreground">{notice}</p>
      {save.error && <p role="alert" className="w-full text-sm text-destructive">{save.error}</p>}
    </form>
  )
}

function DocumentCard({ artistId, document, today, onEdit }: {
  artistId: string
  document: ArtistTravelDocument
  today: string
  onEdit: () => void
}) {
  const router = useRouter()
  const remove = useGuardedAction()
  const label = TRAVEL_DOCUMENT_TYPE_LABELS[document.doc_type]
  const details: [string, string | null][] = [
    ["Number", document.number],
    ["Issuing country", document.issuing_country],
    ["Name on document", document.holder_name],
    ["Expires", document.expires_on ? `${document.expires_on}${document.expires_on < today ? " (expired)" : ""}` : null],
  ]
  return (
    <article aria-label={`Travel document: ${label}`} className="min-w-0 space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="font-medium">{label}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onEdit} aria-label={`Edit travel document: ${label}`}>Edit</Button>
          <DeleteControl label={`Delete travel document: ${label}`} onConfirm={async () => {
            const ok = await remove.run(() => deleteArtistTravelDocument(artistId, document.id), "Unable to delete the travel document. Please try again.")
            if (ok) router.refresh()
            return ok
          }} />
        </div>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {details.filter(([, value]) => value).map(([name, value]) => (
          <div key={name} className="min-w-0 break-words">
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {remove.error && <p role="alert" className="text-sm text-destructive">{remove.error}</p>}
    </article>
  )
}

type DocumentDraft = {
  doc_type: TravelDocumentType
  number: string
  issuing_country: string
  expires_on: string
  holder_name: string
}

function DocumentForm({ artistId, document, onDone }: { artistId: string; document?: ArtistTravelDocument; onDone: () => void }) {
  const router = useRouter()
  const id = useId()
  const [draft, setDraft] = useState<DocumentDraft>(() => ({
    doc_type: document?.doc_type ?? "passport",
    number: document?.number ?? "",
    issuing_country: document?.issuing_country ?? "",
    expires_on: document?.expires_on ?? "",
    holder_name: document?.holder_name ?? "",
  }))
  const save = useGuardedAction()
  const set = (field: keyof DocumentDraft) => (value: string) => setDraft(current => ({ ...current, [field]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = travelDocumentSchema.safeParse(draft)
    if (!parsed.success) {
      save.setError(firstIssue(parsed.error))
      return
    }
    const ok = await save.run(
      () => document ? updateArtistTravelDocument(artistId, document.id, draft) : createArtistTravelDocument(artistId, draft),
      "Unable to save the travel document. Please try again.",
    )
    if (ok) {
      onDone()
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={document ? "Edit travel document" : "New travel document"}
      className="min-w-0 space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-type`} className="mb-1.5 block text-xs font-medium text-foreground">Document type</label>
          <select id={`${id}-type`} value={draft.doc_type} className={selectClass} onChange={event => set("doc_type")(event.target.value)}>
            {TRAVEL_DOCUMENT_TYPES.map(type => <option key={type} value={type}>{TRAVEL_DOCUMENT_TYPE_LABELS[type]}</option>)}
          </select>
        </div>
        <TextField id={`${id}-number`} label="Document number" value={draft.number} onChange={set("number")} maxLength={64} />
        <TextField id={`${id}-country`} label="Issuing country" value={draft.issuing_country} onChange={set("issuing_country")} maxLength={100} />
        <TextField id={`${id}-expires`} label="Expiry date" type="date" value={draft.expires_on} onChange={set("expires_on")} />
        <TextField id={`${id}-holder`} label="Name on document" value={draft.holder_name} onChange={set("holder_name")} maxLength={200} />
      </div>
      <FormActions pending={save.pending} error={save.error} saveLabel={document ? "Save travel document" : "Add travel document"} onCancel={onDone} />
    </form>
  )
}
