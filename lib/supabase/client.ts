import { createBrowserClient } from "@supabase/ssr"

const SUPABASE_CLIENT_KEY = Symbol.for("supabase-client")

type GlobalWithSupabase = typeof globalThis & {
  [SUPABASE_CLIENT_KEY]?: ReturnType<typeof createBrowserClient>
}

export function createClient() {
  const globalWithSupabase = globalThis as GlobalWithSupabase

  if (!globalWithSupabase[SUPABASE_CLIENT_KEY]) {
    globalWithSupabase[SUPABASE_CLIENT_KEY] = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }

  return globalWithSupabase[SUPABASE_CLIENT_KEY]
}
