export type PendingSignup = { email: string; firstName: string; lastName: string }
export const pendingSignupKey = "backbeat.pending-signup"
export function readPendingSignup(): PendingSignup | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingSignupKey) || "null")
    if (!value || typeof value.email !== "string" || typeof value.firstName !== "string" || typeof value.lastName !== "string") return null
    if (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return null
    return { email: value.email, firstName: value.firstName, lastName: value.lastName }
  } catch { return null }
}
