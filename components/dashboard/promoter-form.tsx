"use client"

import { useId, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createPromoter, updatePromoter, type PromoterDetail, type PromoterWriteResult } from "@/lib/actions/promoters"
import { PROMOTER_LIMITS, promoterSchema } from "@/lib/promoter-validation"

type SavedPromoter = Extract<PromoterWriteResult, { success: true }>["promoter"]

interface PromoterFormProps {
  /** Present when editing; absent when creating. */
  promoter?: PromoterDetail
  onSaved: (promoter: SavedPromoter) => void
  onCancel: () => void
}

const UNCONFIRMED = "Unable to confirm whether the promoter was saved. Check the promoter list before retrying."

export function PromoterForm({ promoter, onSaved, onCancel }: PromoterFormProps) {
  const id = useId()
  const [values, setValues] = useState({
    name: promoter?.name ?? "",
    company_name: promoter?.company_name ?? "",
    email: promoter?.email ?? "",
    phone: promoter?.phone ?? "",
    notes: promoter?.notes ?? "",
  })
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const set = (field: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // This form can render inside a dialog opened from another form: keep the submit local.
    event.stopPropagation()
    if (isSaving) return
    const validation = promoterSchema.safeParse(values)
    if (!validation.success) {
      setError(validation.error.issues[0].message)
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      const result = promoter ? await updatePromoter(promoter.id, values) : await createPromoter(values)
      if (result.success) onSaved(result.promoter)
      else setError(result.error)
    } catch {
      setError(UNCONFIRMED)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>Name *</Label>
        <Input id={`${id}-name`} value={values.name} onChange={set("name")} maxLength={PROMOTER_LIMITS.name} required autoComplete="off" disabled={isSaving} placeholder="Contact person" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-company`}>Company</Label>
        <Input id={`${id}-company`} value={values.company_name} onChange={set("company_name")} maxLength={PROMOTER_LIMITS.company} autoComplete="off" disabled={isSaving} placeholder="Optional" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-email`}>Email</Label>
          <Input id={`${id}-email`} type="email" value={values.email} onChange={set("email")} maxLength={PROMOTER_LIMITS.email} autoComplete="off" disabled={isSaving} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-phone`}>Phone</Label>
          <Input id={`${id}-phone`} type="tel" value={values.phone} onChange={set("phone")} maxLength={PROMOTER_LIMITS.phone} autoComplete="off" disabled={isSaving} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea id={`${id}-notes`} value={values.notes} onChange={set("notes")} maxLength={PROMOTER_LIMITS.notes} disabled={isSaving} rows={4} />
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : promoter ? "Save changes" : "Add promoter"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>Cancel</Button>
      </div>
    </form>
  )
}
