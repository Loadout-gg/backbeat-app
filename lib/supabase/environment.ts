// Keep direct process.env reads: Next inlines NEXT_PUBLIC values in browser bundles.
export function getSupabaseEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const local = process.env.BACKBEAT_ENV === "development" || process.env.NEXT_PUBLIC_BACKBEAT_ENV === "development"
  if (local && url !== "http://127.0.0.1:55322") {
    throw new Error("Local development requires Supabase at http://127.0.0.1:55322")
  }
  if (local && !key) throw new Error("Local development requires a Supabase anon key")
  return { url: url!, key: key! }
}
