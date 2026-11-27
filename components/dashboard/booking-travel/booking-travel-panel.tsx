"use client"

import { useId, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  createTravelLeg, deleteTravelLeg, updateBookingTransportToCity, updateTravelLeg, type TravelLeg,
} from "@/lib/actions/booking-travel"
import type { ArtistTravelProfile } from "@/lib/actions/artist-travel-documents"
import {
  TRANSPORT_TO_CITY_LABELS, TRANSPORT_TO_CITY_VALUES, TRAVEL_DIRECTIONS, TRAVEL_DIRECTION_LABELS,
  TRAVEL_DOCUMENT_TYPE_LABELS, firstIssue, travelLegSchema,
  type TransportToCity, type TravelDirection,
} from "@/lib/booking-travel-validation"
import { ScanDownloadButton } from "@/components/dashboard/travel-document-scan-controls"
import {
  DeleteControl, FormActions, FormFields, TextAreaField, TextField, UnavailableNotice, selectClass, shortTime,
  useGuardedAction,
} from "./form-kit"

const LEG_FIELDS = [
  "mode", "carrier", "reference", "depart_place", "depart_date", "depart_time", "depart_zone",
  "arrive_place", "arrive_date", "arrive_time", "arrive_zone", "travellers", "driver_name",
  "driver_phone", "notes",
] as const
type LegDraft = { direction: TravelDirection } & Record<(typeof LEG_FIELDS)[number], string>

function draftFrom(leg?: TravelLeg): LegDraft {
  const draft = { direction: leg?.direction ?? "inbound" } as LegDraft
  for (const field of LEG_FIELDS) {
    const value = leg?.[field] ?? ""
    // Whole minutes edit as HH:MM; stored seconds are kept so an unrelated edit never rewrites them.
    draft[field] = field.endsWith("_time") && value.endsWith(":00") ? (shortTime(value) ?? "") : value
  }
  return draft
}

interface BookingTravelPanelProps {
  bookingId: string
  bookingDate: string
  artistId: string
  artistName: string
  /** null: the scoped read failed; the panel says so instead of showing an empty list. */
  legs: TravelLeg[] | null
  /** null: the artist travel documents could not be read. */
  travelProfile: ArtistTravelProfile | null
  /** Saved deal term; undefined when the travel read failed (the control is then not offered). */
  transportToCity?: TransportToCity | null
  /** Configured calendar day, for the explicit expired state of a document. */
  today: string
}

export function BookingTravelPanel({ bookingId, bookingDate, artistId, artistName, legs, travelProfile, transportToCity, today }: BookingTravelPanelProps) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      {transportToCity !== undefined && <TransportToCityControl bookingId={bookingId} saved={transportToCity} />}
      <section aria-labelledby="travel-legs-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="travel-legs-heading" className="text-base font-medium text-foreground">Travel legs</h2>
          {legs !== null && !adding && (
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Add travel leg
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Dates and times are local to each place, as written on the ticket. No time zone conversion is applied.
        </p>
        {legs === null ? (
          <UnavailableNotice>Travel legs could not be loaded. Reload the page to try again.</UnavailableNotice>
        ) : (
          <>
            {adding && (
              <LegForm bookingId={bookingId} onDone={() => setAdding(false)} />
            )}
            {legs.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground">No travel legs yet.</p>
            )}
            <ul className="space-y-3">
              {legs.map(leg => (
                <li key={leg.id}>
                  {editingId === leg.id ? (
                    <LegForm bookingId={bookingId} leg={leg}
                      onDone={() => setEditingId(current => current === leg.id ? null : current)} />
                  ) : (
                    <LegCard bookingId={bookingId} leg={leg} onEdit={() => setEditingId(leg.id)} />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <ArtistTravelDocumentsSummary
        bookingId={bookingId} artistId={artistId} artistName={artistName} bookingDate={bookingDate}
        today={today} profile={travelProfile}
      />
    </div>
  )
}

function endpoint(place: string | null, date: string | null, time: string | null, zone: string | null): string {
  const when = [date, shortTime(time), zone].filter(Boolean).join(" ")
  return [place, when].filter(Boolean).join(", ") || "Not set"
}

function LegCard({ bookingId, leg, onEdit }: { bookingId: string; leg: TravelLeg; onEdit: () => void }) {
  const router = useRouter()
  const remove = useGuardedAction()
  const title = [TRAVEL_DIRECTION_LABELS[leg.direction], leg.mode, leg.carrier].filter(Boolean).join(" · ")
  const details: [string, string | null][] = [
    ["Reference", leg.reference],
    ["Travellers", leg.travellers],
    ["Driver", [leg.driver_name, leg.driver_phone].filter(Boolean).join(", ") || null],
    ["Notes", leg.notes],
  ]
  return (
    <article aria-label={`Travel leg: ${title}`} className="min-w-0 space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-medium text-foreground">{title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onEdit} aria-label={`Edit travel leg: ${title}`}>Edit</Button>
          <DeleteControl label={`Delete travel leg: ${title}`} onConfirm={async () => {
            const ok = await remove.run(() => deleteTravelLeg(bookingId, leg.id), "Unable to delete the travel leg. Please try again.")
            if (ok) router.refresh()
            return ok
          }} />
        </div>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="min-w-0 break-words">
          <dt className="text-xs text-muted-foreground">Departure</dt>
          <dd className="text-foreground">{endpoint(leg.depart_place, leg.depart_date, leg.depart_time, leg.depart_zone)}</dd>
        </div>
        <div className="min-w-0 break-words">
          <dt className="text-xs text-muted-foreground">Arrival</dt>
          <dd className="text-foreground">{endpoint(leg.arrive_place, leg.arrive_date, leg.arrive_time, leg.arrive_zone)}</dd>
        </div>
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

function LegForm({ bookingId, leg, onDone }: { bookingId: string; leg?: TravelLeg; onDone: () => void }) {
  const router = useRouter()
  const id = useId()
  const [draft, setDraft] = useState<LegDraft>(() => draftFrom(leg))
  const save = useGuardedAction()
  const set = (field: keyof LegDraft) => (value: string) => setDraft(current => ({ ...current, [field]: value }))
  const fieldId = (name: string) => `${id}-${name}`

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = travelLegSchema.safeParse(draft)
    if (!parsed.success) {
      save.setError(firstIssue(parsed.error))
      return
    }
    const ok = await save.run(
      () => leg ? updateTravelLeg(bookingId, leg.id, draft) : createTravelLeg(bookingId, draft),
      "Unable to save the travel leg. Please try again.",
    )
    if (ok) {
      onDone()
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={leg ? "Edit travel leg" : "New travel leg"}
      className="min-w-0 space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <FormFields pending={save.pending}>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="min-w-0">
          <label htmlFor={fieldId("direction")} className="mb-1.5 block text-xs font-medium text-foreground">Direction</label>
          <select id={fieldId("direction")} value={draft.direction} className={selectClass}
            onChange={event => set("direction")(event.target.value)}>
            {TRAVEL_DIRECTIONS.map(direction => (
              <option key={direction} value={direction}>{TRAVEL_DIRECTION_LABELS[direction]}</option>
            ))}
          </select>
        </div>
        <TextField id={fieldId("mode")} label="Mode (flight, train, car...)" value={draft.mode} onChange={set("mode")} maxLength={50} />
        <TextField id={fieldId("carrier")} label="Carrier" value={draft.carrier} onChange={set("carrier")} maxLength={200} />
        <TextField id={fieldId("reference")} label="Reference" value={draft.reference} onChange={set("reference")} maxLength={100} />
      </div>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-foreground">Departure</legend>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-4">
          <TextField id={fieldId("depart-place")} label="Departure place" value={draft.depart_place} onChange={set("depart_place")} maxLength={300} />
          <TextField id={fieldId("depart-date")} label="Departure date" type="date" value={draft.depart_date} onChange={set("depart_date")} />
          <TextField id={fieldId("depart-time")} label="Departure time (local)" type="time" step={draft.depart_time.length > 5 ? 1 : undefined} value={draft.depart_time} onChange={set("depart_time")} />
          <TextField id={fieldId("depart-zone")} label="Departure time zone (optional label)" value={draft.depart_zone} onChange={set("depart_zone")} maxLength={64} />
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-foreground">Arrival</legend>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-4">
          <TextField id={fieldId("arrive-place")} label="Arrival place" value={draft.arrive_place} onChange={set("arrive_place")} maxLength={300} />
          <TextField id={fieldId("arrive-date")} label="Arrival date" type="date" value={draft.arrive_date} onChange={set("arrive_date")} />
          <TextField id={fieldId("arrive-time")} label="Arrival time (local)" type="time" step={draft.arrive_time.length > 5 ? 1 : undefined} value={draft.arrive_time} onChange={set("arrive_time")} />
          <TextField id={fieldId("arrive-zone")} label="Arrival time zone (optional label)" value={draft.arrive_zone} onChange={set("arrive_zone")} maxLength={64} />
        </div>
      </fieldset>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <TextAreaField id={fieldId("travellers")} label="Travellers" value={draft.travellers} onChange={set("travellers")} maxLength={1000} />
        <TextAreaField id={fieldId("notes")} label="Notes" value={draft.notes} onChange={set("notes")} maxLength={2000} />
        <TextField id={fieldId("driver-name")} label="Driver name" value={draft.driver_name} onChange={set("driver_name")} maxLength={200} />
        <TextField id={fieldId("driver-phone")} label="Driver phone" type="tel" value={draft.driver_phone} onChange={set("driver_phone")} maxLength={100} />
      </div>
      </FormFields>
      <FormActions pending={save.pending} error={save.error} saveLabel={leg ? "Save travel leg" : "Add travel leg"} onCancel={onDone} />
    </form>
  )
}

/**
 * Deal term (D6): who organizes and pays travel to the venue city. One choice for the booking,
 * whatever the mode of each leg. Saves on change, on its own.
 */
function TransportToCityControl({ bookingId, saved }: { bookingId: string; saved: TransportToCity | null }) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState<string>(saved ?? "")
  const [notice, setNotice] = useState("")
  const save = useGuardedAction()

  const change = async (next: string) => {
    const previous = value
    setValue(next)
    setNotice("")
    const ok = await save.run(() => updateBookingTransportToCity(bookingId, next || null), "Unable to save transport to the city. Please try again.")
    if (ok) {
      setNotice("Saved.")
      router.refresh()
    } else {
      setValue(previous)
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-2">
      <h2 id={`${id}-heading`} className="text-base font-medium text-foreground">Transport to the city</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <label htmlFor={`${id}-select`} className="sr-only">Who organizes and pays travel to the venue city</label>
        <select id={`${id}-select`} value={value} disabled={save.pending} className={`${selectClass} max-w-xs`}
          onChange={event => { void change(event.target.value) }}>
          <option value="">Not set</option>
          {TRANSPORT_TO_CITY_VALUES.map(option => <option key={option} value={option}>{TRANSPORT_TO_CITY_LABELS[option]}</option>)}
        </select>
        <p role="status" aria-live="polite" className="text-sm text-foreground">{notice}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Who organizes and pays travel to the venue city, whatever the means of transport. The legs below record the actual journeys.
      </p>
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
    </section>
  )
}

function ArtistTravelDocumentsSummary({ bookingId, artistId, artistName, bookingDate, today, profile }: {
  bookingId: string
  artistId: string
  artistName: string
  bookingDate: string
  today: string
  profile: ArtistTravelProfile | null
}) {
  return (
    <section aria-labelledby="artist-travel-documents-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="artist-travel-documents-heading" className="text-base font-medium text-foreground">
          Travel documents: {artistName}
        </h2>
        <Link href={`/dashboard/artists/${artistId}`} className="text-sm text-foreground underline underline-offset-4">
          Edit on the artist profile
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Read-only. Sensitive personal data: share only with the people who book the travel. Nothing here is
        sent with the booking; download a scan and attach it yourself when it is asked for.
      </p>
      {profile === null ? (
        <UnavailableNotice>Travel documents could not be loaded. Reload the page to try again.</UnavailableNotice>
      ) : (
        <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Date of birth: </span>
            <span className="text-foreground">{profile.dateOfBirth ?? "Not recorded"}</span>
          </p>
          {profile.documents.length === 0 ? (
            <p className="text-muted-foreground">No travel documents recorded.</p>
          ) : (
            <ul className="space-y-3">
              {profile.documents.map(document => {
                const label = TRAVEL_DOCUMENT_TYPE_LABELS[document.doc_type]
                const scan = document.scan
                return (
                  <li key={document.id} className="flex min-w-0 flex-wrap items-center gap-2 break-words">
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="text-foreground">{document.number}</span>
                    {document.holder_name && <span className="text-foreground">{document.holder_name}</span>}
                    {document.nationality && <span className="text-muted-foreground">{document.nationality}</span>}
                    {document.issuing_country && <span className="text-muted-foreground">Issued by {document.issuing_country}</span>}
                    {document.issued_on && <span className="text-muted-foreground">Issued {document.issued_on}</span>}
                    <span className="text-muted-foreground">
                      {document.expires_on ? `Expires ${document.expires_on}` : "No expiry date"}
                    </span>
                    {document.expires_on && document.expires_on < today ? (
                      <Badge variant="destructive">Expired</Badge>
                    ) : document.expires_on && document.expires_on < bookingDate && (
                      <Badge variant="destructive">Expires before this booking</Badge>
                    )}
                    {profile.scansEnabled && scan && scan.state !== "missing" && (
                      <ScanDownloadButton fileId={scan.fileId} bookingId={bookingId} label={`Download scan: ${label}`} />
                    )}
                    {scan?.state === "missing" && <span className="text-destructive">Scan file missing</span>}
                    {!scan && <span className="text-muted-foreground">No scan</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
