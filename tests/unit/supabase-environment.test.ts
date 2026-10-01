// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
const { browser, server } = vi.hoisted(() => ({ browser: vi.fn(() => ({})), server: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null } })) } })) }))
vi.mock("@supabase/ssr", () => ({ createBrowserClient: browser, createServerClient: server }))
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: vi.fn() })) }))
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
it.each(["browser", "server", "proxy"])("%s rejects remote Supabase in explicit development before connecting", async (entry) => {
  vi.stubEnv("BACKBEAT_ENV", "development")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://remote.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key")
  const invoke = async () => {
    if (entry === "browser") return (await import("@/lib/supabase/client")).createClient()
    if (entry === "server") return (await import("@/lib/supabase/server")).createClient()
    const { NextRequest } = await import("next/server")
    return (await import("@/lib/supabase/proxy")).updateSession(new NextRequest("http://localhost/"))
  }
  await expect(invoke()).rejects.toThrow("Local development requires Supabase at http://127.0.0.1:55322")
  expect(browser).not.toHaveBeenCalled()
  expect(server).not.toHaveBeenCalled()
})
it.each(["http://127.0.0.1:55321", "http://localhost:55322", "http://127.0.0.1:55322/", undefined])("rejects nonexact local URL %s (characterization)", async (url) => {
  vi.stubEnv("NEXT_PUBLIC_BACKBEAT_ENV", "development")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url)
  const { getSupabaseEnvironment } = await import("@/lib/supabase/environment")
  expect(() => getSupabaseEnvironment()).toThrow("Local development requires Supabase at")
})
it("accepts only the approved loopback in dev and requires a key (characterization)", async () => {
  vi.stubEnv("NEXT_PUBLIC_BACKBEAT_ENV", "development")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55322")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key")
  const { getSupabaseEnvironment } = await import("@/lib/supabase/environment")
  expect(getSupabaseEnvironment()).toEqual({ url: "http://127.0.0.1:55322", key: "test-key" })
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined)
  expect(() => getSupabaseEnvironment()).toThrow("requires a Supabase anon key")
})
it("preserves remote configuration without explicit development (characterization)", async () => {
  vi.stubEnv("BACKBEAT_ENV", undefined)
  vi.stubEnv("NEXT_PUBLIC_BACKBEAT_ENV", undefined)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
  const { getSupabaseEnvironment } = await import("@/lib/supabase/environment")
  expect(getSupabaseEnvironment().url).toBe("https://example.supabase.co")
})
it("uses an explicitly configured hosted endpoint outside Development", async () => {
  vi.stubEnv("BACKBEAT_ENV", "production")
  vi.stubEnv("NEXT_PUBLIC_BACKBEAT_ENV", "production")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-publishable-placeholder")
  const { getSupabaseEnvironment } = await import("@/lib/supabase/environment")
  expect(getSupabaseEnvironment()).toEqual({
    url: "https://example.supabase.co",
    key: "test-publishable-placeholder",
  })
})
it("exposes server-only development selection to the browser build", async () => {
  vi.stubEnv("BACKBEAT_ENV", "development")
  vi.stubEnv("NEXT_PUBLIC_BACKBEAT_ENV", undefined)
  const config = (await import("../../next.config.mjs")).default
  expect(config.env?.NEXT_PUBLIC_BACKBEAT_ENV).toBe("development")
})
