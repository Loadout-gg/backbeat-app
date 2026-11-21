import { z } from "zod"

// A promoter is a person; the company is optional (Simone, 2026-11-21).
const CONTROL = /[\u0000-\u001f\u007f]/
const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export const PROMOTER_LIMITS = { name: 200, company: 200, email: 254, phone: 50, notes: 2000 } as const

const length = (value: string) => [...value].length

/** Optional single-line text: trimmed, blank becomes null. */
function optionalLine(label: string, max: number) {
  return z
    .string()
    .nullish()
    .transform((value) => (value ?? "").trim())
    .refine((value) => !CONTROL.test(value), `${label} cannot contain line breaks or control characters`)
    .refine((value) => length(value) <= max, `${label} must be ${max} characters or fewer`)
    .transform((value) => value || null)
}

export const promoterSchema = z.object({
  name: z
    .string("Promoter name is required")
    .trim()
    .min(1, "Promoter name is required")
    .refine((value) => !CONTROL.test(value), "Promoter name cannot contain line breaks or control characters")
    .refine((value) => length(value) <= PROMOTER_LIMITS.name, `Promoter name must be ${PROMOTER_LIMITS.name} characters or fewer`),
  company_name: optionalLine("Company", PROMOTER_LIMITS.company),
  email: optionalLine("Email", PROMOTER_LIMITS.email).refine(
    (value) => value === null || z.email().safeParse(value).success,
    "Enter a valid email address",
  ),
  phone: optionalLine("Phone", PROMOTER_LIMITS.phone).refine(
    (value) => value === null || /^\+?[0-9][0-9 ().\/-]{2,}$/.test(value),
    "Enter a valid phone number",
  ),
  notes: z
    .string()
    .nullish()
    .transform((value) => (value ?? "").trim())
    .refine((value) => !CONTROL_EXCEPT_NEWLINES.test(value), "Notes cannot contain control characters")
    .refine((value) => length(value) <= PROMOTER_LIMITS.notes, `Notes must be ${PROMOTER_LIMITS.notes} characters or fewer`)
    .transform((value) => value || null),
})

export type PromoterInput = z.input<typeof promoterSchema>
export type PromoterValues = z.output<typeof promoterSchema>
