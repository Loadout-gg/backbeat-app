import { getSupabaseEnvironment } from "./environment"

import { createBrowserClient } from "@supabase/ssr"

let browserClient: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  const { url, key } = getSupabaseEnvironment()
  if (typeof window === "undefined") {
    throw new Error("createClient must be called in a browser environment")
  }

  if (!browserClient) {
    browserClient = createBrowserClient(
      url,
      key,
    )
  }

  return browserClient
}
