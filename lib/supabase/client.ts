import { createBrowserClient } from "@supabase/ssr"

const SUPABASE_CLIENT_KEY = "__supabase_browser_client__"

type GlobalWithSupabase = typeof globalThis & {
  [key: string]: ReturnType<typeof createBrowserClient> | undefined
}

export function createClient() {
  if (typeof window === "undefined") {
    return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: {
        storageKey: "bb-auth-token",
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  }

  const globalWithSupabase = window as unknown as GlobalWithSupabase

  if (!globalWithSupabase[SUPABASE_CLIENT_KEY]) {
    globalWithSupabase[SUPABASE_CLIENT_KEY] = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storageKey: "bb-auth-token",
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      },
    )
  }

  return globalWithSupabase[SUPABASE_CLIENT_KEY]!
}
