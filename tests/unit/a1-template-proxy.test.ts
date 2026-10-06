import { beforeEach, expect, it, vi } from "vitest"

const { getUser, createServerClient, next } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  next: vi.fn(() => ({ kind: "next" })),
}))
vi.mock("@supabase/ssr", () => ({ createServerClient }))
vi.mock("next/server", () => ({ NextResponse: { next, redirect: vi.fn() } }))
vi.mock("@/lib/supabase/environment", () => ({ getSupabaseEnvironment: () => ({ url: "http://127.0.0.1:55322", key: "test-public-key" }) }))
import { updateSession } from "@/lib/supabase/proxy"
import type { NextRequest } from "next/server"

function request(pathname: string) {
  return { nextUrl: { pathname }, cookies: { getAll: () => [], set: vi.fn() } } as unknown as NextRequest
}
beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: null } })
  createServerClient.mockReturnValue({ auth: { getUser } })
})
it("serves the static confirmation template without calling Auth, preventing a mailer fetch dependency loop", async () => {
  const result = await updateSession(request("/auth/signup-confirmation.html"))
  expect(result).toEqual({ kind: "next" })
  expect(createServerClient).not.toHaveBeenCalled()
  expect(getUser).not.toHaveBeenCalled()
})
it("keeps the existing auth check on the actual signup page", async () => {
  await updateSession(request("/auth/signup"))
  expect(getUser).toHaveBeenCalledOnce()
})
