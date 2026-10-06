export function nativeEmailFeedback(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const candidate = error as { code?: unknown }
  if (candidate.code === "email_address_not_authorized") {
    return "Email delivery is limited to authorized test accounts during this internal test phase."
  }
  return null
}
