import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// F19: what each booking client really receives. A synthetic PostgREST applies the
// select projection to a complete bookings row (every column filled, artist fee
// included); the tests assert the exact keys of the rows that reach each client prop.

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  workspace: vi.fn(),
  getUser: vi.fn(),
  getArtist: vi.fn(),
  listEvents: vi.fn(),
  listEventsInProgress: vi.fn(),
  getDashboardStats: vi.fn(),
  getCurrentUser: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: mocks.workspace, getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/actions/artists", () => ({ getArtist: mocks.getArtist }))
vi.mock("@/lib/actions/events", () => ({ listEvents: mocks.listEvents, listEventsInProgress: mocks.listEventsInProgress }))
vi.mock("@/lib/actions/dashboard", () => ({ getDashboardStats: mocks.getDashboardStats }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ notFound: vi.fn(), unstable_rethrow: vi.fn() }))
vi.mock("@/app/dashboard/dashboard-content", () => ({ DashboardContent: () => null }))
vi.mock("@/app/dashboard/artists/[id]/artist-profile-client", () => ({ ArtistProfileClient: () => null }))

import { createBooking, getBookings } from "@/lib/actions/bookings"
import DashboardPage from "@/app/dashboard/page"
import ArtistPage from "@/app/dashboard/artists/[id]/page"

const WORKSPACE = "11111111-1111-4111-8111-111111111111"
const ARTIST = "22222222-2222-4222-8222-222222222222"
const BOOKING = "33333333-3333-4333-8333-333333333333"

const FULL_ARTIST = {
  id: ARTIST, stage_name: "Synthetic DJ", name: "Synthetic", surname: "Artist", location: "Synthetic city",
  fee: 1234, currency: "EUR", profile_image_url: "https://backbeat.invalid/a.png", notes: "private artist note",
}
const FULL_BOOKING: Record<string, unknown> = {
  id: BOOKING, workspace_id: WORKSPACE, artist_id: ARTIST, date: "2030-01-02", start_time: "21:30:00",
  duration_minutes: 90, notes: "private booking note", status: "in_progress", hold_expires_on: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  venue_name: "Synthetic venue", venue_address: "Synthetic address", event_type: "club", expected_audience: "300",
  contact_name_main: "Private contact", contact_phone_main: "+00 000", contact_email_main: "contact@backbeat.invalid",
  contact_name_secondary: "Private second", contact_phone_secondary: "+00 001", contact_email_secondary: "second@backbeat.invalid",
  driver_name: "Private driver", driver_phone: "+00 002", driver_distance: "10 km",
  fee_amount_minor: 500000, fee_currency: "EUR",
}

/** Applies a PostgREST select ("a,b,alias:table(c,d)" or "*") to one row. */
function project(select: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const part of select.replace(/\s/g, "").match(/[^,(]+(?:\([^)]*\))?/g) ?? []) {
    const embed = /^(?:(\w+):)?(\w+)\(([^)]*)\)$/.exec(part)
    if (embed) out[embed[1] ?? embed[2]] = project(embed[3], FULL_ARTIST)
    else if (part === "*") Object.assign(out, row)
    else out[part] = row[part]
  }
  return out
}

let selects: string[]

beforeEach(() => {
  vi.resetAllMocks()
  selects = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    if (url.origin !== "https://backbeat.invalid") throw new Error("Unexpected test origin")
    if (url.pathname === "/rest/v1/artists") {
      expect(init?.method).toBe("GET")
      expect(url.searchParams.get("id")).toBe(`eq.${ARTIST}`)
      expect(url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE}`)
      expect(url.searchParams.get("select")).toBe("id,default_commission_type,default_commission_value,default_commission_mode,default_commission_currency")
      return Response.json([{ id: ARTIST, default_commission_type: "percent", default_commission_value: 1500,
        default_commission_mode: "included", default_commission_currency: null }])
    }
    if (url.pathname !== "/rest/v1/bookings") throw new Error("Unexpected test request")
    const select = url.searchParams.get("select") ?? "*"
    selects.push(select)
    const body = init?.method === "POST" ? project(select, FULL_BOOKING) : [project(select, FULL_BOOKING)]
    return new Response(JSON.stringify(body), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json", "content-range": "0-0/1" },
    })
  }
  const client = createSupabaseClient("https://backbeat.invalid", "synthetic-public-key-not-a-credential", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetcher },
  })
  mocks.createClient.mockResolvedValue({ from: client.from.bind(client), auth: { getUser: mocks.getUser } })
  mocks.workspace.mockResolvedValue(WORKSPACE)
  mocks.getUser.mockResolvedValue({ data: { user: { id: "synthetic-user" } }, error: null })
  mocks.getArtist.mockResolvedValue({ id: ARTIST, name: "Synthetic" })
  mocks.listEvents.mockResolvedValue([])
  mocks.listEventsInProgress.mockResolvedValue([])
  mocks.getDashboardStats.mockResolvedValue({ eventsInProgress: 0, bookingsInProgress: 0, totalArtists: 1, totalPromoters: 0 })
  mocks.getCurrentUser.mockResolvedValue(null)
})

const keys = (value: unknown) => Object.keys(value as object).sort()
const PRIVATE = /notes|contact_|fee|commission|driver_|workspace_id|event_type|expected_audience|updated_at|surname|location|currency|profile_image_url/

describe("booking rows that reach the browser", () => {
  it("dashboard client receives only the card and same-day fields", async () => {
    const element = await DashboardPage() as ReactElement<{ bookings: Record<string, unknown>[] }>
    const [row] = element.props.bookings
    expect(keys(row)).toEqual(["artist", "artist_id", "date", "duration_minutes", "id", "start_time", "status", "venue_address", "venue_name"])
    expect(keys(row.artist)).toEqual(["name", "stage_name"])
    expect(JSON.stringify(element.props.bookings)).not.toMatch(/private|Private|1234|500000/)
  })

  it("artist profile client receives only the calendar and same-day fields", async () => {
    const element = await ArtistPage({ params: Promise.resolve({ id: ARTIST }) }) as ReactElement<{ bookings: Record<string, unknown>[] }>
    const [row] = element.props.bookings
    expect(keys(row)).toEqual(["artist_id", "date", "duration_minutes", "id", "start_time", "status"])
    expect(JSON.stringify(element.props.bookings)).not.toMatch(/private|Private|Synthetic venue/)
  })

  it("bookings list (server-rendered) reads only the card, badge and hold-rank fields", async () => {
    const [row] = await getBookings()
    expect(keys(row)).toEqual([
      "artist", "artist_id", "created_at", "date", "duration_minutes", "hold_expires_on", "id", "start_time", "status", "venue_address", "venue_name",
    ])
    expect(keys(row.artist)).toEqual(["name", "stage_name"])
  })

  it("new booking dialog receives only the saved booking's id, artist and date", async () => {
    const result = await createBooking({ artistId: ARTIST, date: "2030-01-02", startTime: "21:30", durationMinutes: 90, notes: "typed" })
    expect(result.success).toBe(true)
    expect(keys(result.booking)).toEqual(["artist_id", "date", "id"])
  })

  it("no list read selects a private column", async () => {
    await DashboardPage()
    await ArtistPage({ params: Promise.resolve({ id: ARTIST }) })
    await getBookings()
    expect(selects).toHaveLength(3)
    for (const select of selects) {
      expect(select).not.toContain("*")
      expect(select.replace(/artist:artists\(stage_name,name\)/, "")).not.toMatch(PRIVATE)
    }
  })

  it("rejects an unknown projection name before backend access", async () => {
    await expect(getBookings({ fields: "everything" as "list" })).rejects.toThrow("Invalid booking fields")
    expect(selects).toEqual([])
  })
})
