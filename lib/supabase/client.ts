import { createBrowserClient } from "@supabase/ssr"

const SUPABASE_CLIENT_KEY = "__supabase_browser_client__"

type GlobalWithSupabase = typeof globalThis & {
  [key: string]: ReturnType<typeof createBrowserClient> | undefined
}

export function createClient() {
  // Only create client in browser environment
  if (typeof window === "undefined") {
    // Return a new instance for server-side (will be garbage collected)
    return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  }

  const globalWithSupabase = window as unknown as GlobalWithSupabase

  if (!globalWithSupabase[SUPABASE_CLIENT_KEY]) {
    globalWithSupabase[SUPABASE_CLIENT_KEY] = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }

  return globalWithSupabase[SUPABASE_CLIENT_KEY]!
}
