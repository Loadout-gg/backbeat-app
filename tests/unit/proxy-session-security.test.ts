import { beforeEach, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import type { SetAllCookies } from "@supabase/ssr"

const {
  state,
  db,
  onboarding,
  membership,
} = vi.hoisted(() => {
  function query() {
    const result: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const method of ["select", "eq", "single"]) {
      result[method] = vi.fn()
    }
    return result
  }

  return {
    state: {
      batches: [] as Parameters<SetAllCookies>[0][],
    },
    db: {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn(),
    },
    onboarding: query(),
    membership: query(),
  }
})

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((
    _url: string,
    _key: string,
    options: { cookies: { setAll: SetAllCookies } },
  ) => ({
    auth: {
      getUser: async () => {
        for (const batch of state.batches) {
          await options.cookies.setAll(batch)
        }
        return db.auth.getUser()
      },
    },
    from: db.from,
  })),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => db),
}))

vi.mock("@/lib/supabase/environment", () => ({
  getSupabaseEnvironment: () => ({
    url: "https://synthetic.invalid",
    key: "synthetic-public-key",
  }),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

import { createServerClient } from "@supabase/ssr"
import { updateSession } from "@/lib/supabase/proxy"
import { getCurrentWorkspaceId } from "@/lib/actions/workspace"

const workspaceId = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  db.auth.getUser.mockReset()
  db.from.mockReset()
  for (const query of [onboarding, membership]) {
    for (const method of Object.values(query)) method.mockReset()
  }

  db.auth.getUser.mockResolvedValue({
    data: { user: { id: "actor" } },
    error: null,
  })

  for (const query of [onboarding, membership]) {
    for (const method of Object.values(query)) method.mockReturnValue(query)
  }

  onboarding.single.mockResolvedValue({
    data: { completed: true, workspace_id: workspaceId },
    error: null,
  })
  membership.single.mockResolvedValue({
    data: { workspace_id: workspaceId },
    error: null,
  })

  db.from.mockImplementation((table: string) => {
    if (table === "onboarding_status") return onboarding
    if (table === "workspace_members") return membership
    throw new Error(`Unexpected table: ${table}`)
  })

  state.batches = [[
    {
      name: "sb-synthetic-auth-token.0",
      value: "refreshed-part-zero",
      options: {
        path: "/",
        domain: ".backbeat.test",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        expires: new Date("2030-01-01T00:00:00.000Z"),
        priority: "high",
      },
    },
    {
      name: "sb-synthetic-auth-token.1",
      value: "refreshed-part-one",
      options: {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      },
    },
    {
      name: "sb-synthetic-auth-token.2",
      value: "",
      options: {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 0,
        expires: new Date(0),
      },
    },
  ]]
})

function expectedCookies() {
  const expected = NextResponse.next()
  for (const batch of state.batches) {
    for (const { name, value, options } of batch) {
      expected.cookies.set(name, value, options)
    }
  }
  return expected.cookies.getAll()
}

function request(path: string) {
  return new NextRequest(`https://app.backbeat.test${path}`)
}

it.each([
  { path: "/onboarding", completed: true, signedIn: true, target: "/dashboard" },
  { path: "/auth/login", completed: true, signedIn: true, target: "/dashboard" },
  { path: "/auth/signup", completed: true, signedIn: true, target: "/dashboard" },
  { path: "/", completed: true, signedIn: true, target: "/dashboard" },
  { path: "/dashboard", completed: false, signedIn: true, target: "/onboarding" },
  { path: "/dashboard", completed: true, signedIn: false, target: "/auth/login" },
])(
  "preserves every cookie and option when $path redirects to $target",
  async ({ path, completed, signedIn, target }) => {
    onboarding.single.mockResolvedValue({
      data: { completed, workspace_id: completed ? workspaceId : null },
      error: null,
    })

    if (!signedIn) {
      db.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
      state.batches = state.batches.map((batch) => batch.map((cookie) => ({
        ...cookie,
        value: "",
        options: {
          ...cookie.options,
          maxAge: 0,
          expires: new Date(0),
        },
      })))
    }

    const incoming = request(`${path}?keep=synthetic`)
    const response = await updateSession(incoming)
    expect(response.status).toBe(307)
    const destination = new URL(response.headers.get("location")!)
    expect(destination.pathname).toBe(target)
    expect(destination.search).toBe("?keep=synthetic")
    expect(response.cookies.getAll()).toEqual(expectedCookies())

    for (const batch of state.batches) {
      for (const cookie of batch) {
        expect(incoming.cookies.get(cookie.name)?.value).toBe(cookie.value)
      }
    }
  },
)

it("preserves refreshed and cleared cookies on a nonredirect response", async () => {
  const response = await updateSession(request("/dashboard"))
  expect(response.headers.get("location")).toBeNull()
  expect(response.cookies.getAll()).toEqual(expectedCookies())
})

it("retains earlier cookie chunks when Auth calls setAll more than once", async () => {
  state.batches.push([{
    name: "sb-synthetic-auth-token.0",
    value: "latest-part-zero",
    options: {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    },
  }])

  const response = await updateSession(request("/auth/login"))
  expect(response.cookies.getAll()).toEqual(expectedCookies())
  expect(response.cookies.get("sb-synthetic-auth-token.0")?.value)
    .toBe("latest-part-zero")
  expect(response.cookies.get("sb-synthetic-auth-token.1")?.value)
    .toBe("refreshed-part-one")
  expect(response.cookies.get("sb-synthetic-auth-token.2")?.maxAge).toBe(0)
})

it("selects both completion and workspace selection", async () => {
  await updateSession(request("/dashboard"))
  expect(onboarding.select).toHaveBeenCalledWith("completed, workspace_id")
  expect(onboarding.eq).toHaveBeenCalledWith("user_id", "actor")
})

it("lets completed/null-workspace users reach recovery without a redirect loop", async () => {
  onboarding.single.mockResolvedValue({
    data: { completed: true, workspace_id: null },
    error: null,
  })

  await expect(getCurrentWorkspaceId()).rejects.toThrow("REDIRECT:/onboarding")

  const dashboard = await updateSession(request("/dashboard"))
  expect(new URL(dashboard.headers.get("location")!).pathname).toBe("/onboarding")
  expect(dashboard.cookies.getAll()).toEqual(expectedCookies())

  const recovery = await updateSession(request("/onboarding"))
  expect(recovery.headers.get("location")).toBeNull()
  expect(recovery.cookies.getAll()).toEqual(expectedCookies())
  expect(db.rpc).not.toHaveBeenCalled()
  expect(membership.single).not.toHaveBeenCalled()
})

it.each([
  { data: null, error: null },
  { data: null, error: { message: "synthetic unavailable" } },
  {
    data: { completed: true, workspace_id: workspaceId },
    error: { message: "synthetic unavailable" },
  },
])("does not treat an unavailable onboarding lookup as completed: %j", async (result) => {
  onboarding.single.mockResolvedValue(result)
  const response = await updateSession(request("/onboarding"))
  expect(response.headers.get("location")).toBeNull()
})

it("allows null selection to recover and then routes a selected workspace normally", async () => {
  onboarding.single.mockResolvedValue({
    data: { completed: true, workspace_id: null },
    error: null,
  })
  expect((await updateSession(request("/onboarding"))).headers.get("location"))
    .toBeNull()

  // Simulate the persisted result of the existing bootstrap RPC.
  // This is routing evidence, not a database bootstrap or deletion test.
  onboarding.single.mockResolvedValue({
    data: { completed: true, workspace_id: workspaceId },
    error: null,
  })
  expect(await getCurrentWorkspaceId()).toBe(workspaceId)
  const response = await updateSession(request("/onboarding"))
  expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard")
})

it("keeps a non-null inactive selection fail-closed instead of switching tenants", async () => {
  membership.single.mockResolvedValue({ data: null, error: null })

  const response = await updateSession(request("/dashboard"))
  expect(response.headers.get("location")).toBeNull()

  await expect(getCurrentWorkspaceId())
    .rejects.toThrow("No active workspace membership")

  expect(membership.eq.mock.calls).toEqual([
    ["workspace_id", workspaceId],
    ["user_id", "actor"],
    ["status", "active"],
  ])
  expect(db.rpc).not.toHaveBeenCalled()
})

it("bypasses Auth for the static signup template", async () => {
  const response = await updateSession(request("/auth/signup-confirmation.html"))
  expect(response.headers.get("location")).toBeNull()
  expect(createServerClient).not.toHaveBeenCalled()
  expect(db.auth.getUser).not.toHaveBeenCalled()
  expect(response.cookies.getAll()).toEqual([])
})

it("keeps signed-out public routes public without onboarding reads", async () => {
  db.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
  const response = await updateSession(request("/auth/signup"))
  expect(response.headers.get("location")).toBeNull()
  expect(db.from).not.toHaveBeenCalled()
})
