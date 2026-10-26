import { z } from "zod"

export type SocialLink = {
  type: string
  url: string
}

export type ArtistDocument = {
  name: string
  url: string
}

const optionalText = z.string().nullable().optional()

const emailSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
    "Enter a valid email address",
  )
  .nullable()
  .optional()

const socialLinkSchema = z
  .object({
    type: z.string(),
    url: z.string(),
  })
  .strip()

const documentSchema = z
  .object({
    name: z.string(),
    url: z.string(),
  })
  .strip()

// This object is the complete supported write allowlist.
// Do not add ownership, IDs, timestamps, aliases or profile-image fields here
// without a separately specified write contract.
//
// URL strings are deliberately preserved. Rendering uses artistMetadataHref;
// do not silently discard legacy metadata to enforce a navigation policy.
export const createArtistSchema = z
  .object({
    stage_name: z.string().trim().min(1, "Stage name is required"),
    name: z.string().optional(),
    surname: optionalText,
    location: optionalText,
    contact_name: optionalText,
    phone: optionalText,
    email: emailSchema,
    fee: z
      .number()
      .finite()
      .nonnegative("Base rate must be zero or positive")
      .nullable()
      .optional(),
    currency: optionalText,
    travel_fee: optionalText,
    pricing_notes: optionalText,
    social_links: z.array(socialLinkSchema).nullable().optional(),
    overview: optionalText,
    genres: z.array(z.string()).nullable().optional(),
    dj_equipment: optionalText,
    sound_system: optionalText,
    documents: z.array(documentSchema).nullable().optional(),
    allergies: optionalText,
    special_diet: optionalText,
    special_needs: optionalText,
    notes: optionalText,
  })
  .strip()

// No defaults belong in this schema: omission means "leave unchanged".
export const updateArtistSchema = createArtistSchema.partial()

export type CreateArtistInput = z.input<typeof createArtistSchema>
export type UpdateArtistInput = z.input<typeof updateArtistSchema>

function persistedArray(value: unknown): unknown[] {
  let decoded: unknown = value
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded)
    } catch {
      return []
    }
  }
  return Array.isArray(decoded) ? decoded : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// These are defensive view projections, not database-cleanup operations.
// Keep field strings exactly as stored; never coerce malformed field types.
export function parseSocialLinks(value: unknown): SocialLink[] {
  const links: SocialLink[] = []
  for (const entry of persistedArray(value)) {
    if (
      isRecord(entry) &&
      typeof entry.type === "string" &&
      typeof entry.url === "string"
    ) {
      links.push({ type: entry.type, url: entry.url })
    }
  }
  return links
}

export function parseDocuments(value: unknown): ArtistDocument[] {
  const documents: ArtistDocument[] = []
  for (const entry of persistedArray(value)) {
    if (
      isRecord(entry) &&
      typeof entry.name === "string" &&
      (typeof entry.url === "string" ||
        entry.url === undefined ||
        entry.url === null)
    ) {
      // Legacy name-only documents remain visible. Empty URL means no link.
      documents.push({ name: entry.name, url: entry.url ?? "" })
    }
  }
  return documents
}

// Return a safe navigation target without rewriting the stored string.
// HTTP(S), protocol-relative, scheme-less hosts and relative storage paths
// are supported. Other schemes remain editable metadata, not active links.
export function artistMetadataHref(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw || /[\u0000-\u001f\u007f\\]/u.test(raw)) return null

  // Same-origin root-relative or dot-relative URLs cannot select a scheme.
  if (/^(?:\/(?!\/)|\.{1,2}\/)/u.test(raw)) return raw

  const hasScheme = /^[a-z][a-z0-9+.-]*:/iu.test(raw)
  const isHostWithPort = /^[^/:?#]+:\d+(?:[/?#]|$)/u.test(raw)
  const candidate = raw.startsWith("//")
    ? `https:${raw}`
    : hasScheme && !isHostWithPort
      ? raw
      : `https://${raw}`

  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.href
  } catch {
    return null
  }
}

// "notes" is a full stored-note value. A supplied contact_name modifies only
// its first Contact: line; the remaining body, including whitespace, survives.
export function withArtistContact(
  notes: string | null | undefined,
  contactName: string | null | undefined,
): string | null {
  const current = notes ?? ""
  if (contactName === undefined) return current || null

  const body = current.startsWith("Contact: ")
    ? current.split("\n").slice(1).join("\n")
    : current

  return [
    contactName ? `Contact: ${contactName}` : "",
    body,
  ].filter(Boolean).join("\n") || null
}
