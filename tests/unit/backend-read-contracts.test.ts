import { beforeEach, describe, expect, it, vi } from "vitest"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  workspace: vi.fn(),
  getUser: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}))
vi.mock("@/lib/actions/workspace", () => ({
  getCurrentWorkspaceId: mocks.workspace,
}))
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidate,
}))

import { getBookings } from "@/lib/actions/bookings"
import {
  createEvent,
  listEvents,
  listEventsInProgress,
  listPromoters,
} from "@/lib/actions/events"
import { listArtists, getArtists } from "@/lib/actions/artists"
import { getDashboardStats } from "@/lib/actions/dashboard"

const WORKSPACE = "11111111-1111-4111-8111-111111111111"
const ARTIST = "22222222-2222-4222-8222-222222222222"
const PROMOTER = "33333333-3333-4333-8333-333333333333"
const EVENT = "44444444-4444-4444-8444-444444444444"

type Table = "artists" | "events" | "bookings" | "promoters"
type Row = Record<string, unknown> & { id: string; workspace_id: string }
type RequestRecord = {
  url: URL
  method: string
  headers: Headers
  body: unknown
}

let requests: RequestRecord[]
let respond: (request: RequestRecord) => Response | Promise<Response>

function reply(body: unknown, count?: number | string, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json" })
  if (count !== undefined) headers.set("content-range", `0-0/${count}`)
  return new Response(
    body === undefined ? null : JSON.stringify(body),
    { status, headers },
  )
}

function tableOf(request: RequestRecord): Table {
  return request.url.pathname.split("/").at(-1) as Table
}

function makeRow(table: Table, index: number): Row {
  const common = {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: WORKSPACE,
    created_at: "2026-01-01T00:00:00Z",
  }

  if (table === "artists") {
    return {
      ...common,
      name: "Same name",
      surname: null,
      stage_name: null,
      email: null,
      phone: null,
      notes: null,
      location: null,
      genres: null,
      fee: 0,
      currency: "EUR",
      travel_fee: null,
      pricing_notes: null,
      social_links: null,
      overview: null,
      dj_equipment: null,
      sound_system: null,
      allergies: null,
      special_diet: null,
      special_needs: null,
      documents: null,
      updated_at: null,
      profile_image_url: null,
    }
  }

  if (table === "promoters") {
    return {
      ...common,
      name: "Same name",
      company_name: null,
      email: null,
      phone: null,
      notes: null,
    }
  }

  const scheduled = {
    ...common,
    date: "2020-01-01",
    status: "in_progress",
    artist_id: ARTIST,
  }

  if (table === "events") {
    return {
      ...scheduled,
      title: "Synthetic event",
      location: null,
      promoter_id: null,
      artists: { id: ARTIST, name: "Artist" },
      promoters: null,
    }
  }

  return {
    ...scheduled,
    start_time: "10:30:00",
    duration_minutes: null,
    notes: null,
    venue_name: null,
    venue_address: null,
    contact_name_main: null,
    contact_phone_main: null,
    contact_email_main: null,
    fee_amount_minor: null,
    fee_currency: null,
    updated_at: "2026-01-01T00:00:00Z",
    artist: null,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  requests = []
  respond = () => reply([], 0)

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    )

    if (
      url.origin !== "https://backbeat.invalid" ||
      !url.pathname.startsWith("/rest/v1/")
    ) {
      throw new Error("Unexpected test request")
    }

    const rawBody = init?.body
    const record: RequestRecord = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof rawBody === "string" ? JSON.parse(rawBody) : null,
    }
    requests.push(record)
    return respond(record)
  }

  const client = createSupabaseClient(
    "https://backbeat.invalid",
    "synthetic-public-key-not-a-credential",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: fetcher },
    },
  )

  mocks.createClient.mockResolvedValue({
    from: client.from.bind(client),
    auth: { getUser: mocks.getUser },
  })
  mocks.workspace.mockResolvedValue(WORKSPACE)
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "synthetic-user" } },
    error: null,
  })
})

function serveRows(source: Row[], cap: number): void {
  respond = request => {
    const params = request.url.searchParams
    const filtered = source.filter(row =>
      ["workspace_id", "artist_id", "status"].every(column => {
        const predicate = params.get(column)
        return predicate === null || predicate === `eq.${String(row[column])}`
      }),
    )

    const order = (params.get("order") ?? "")
      .split(",")
      .filter(Boolean)
      .map(value => value.split("."))

    filtered.sort((a, b) => {
      for (const [column, direction] of order) {
        const comparison = String(a[column] ?? "")
          .localeCompare(String(b[column] ?? ""))
        if (comparison) return direction === "desc" ? -comparison : comparison
      }
      return 0
    })

    const from = Number(params.get("offset") ?? 0)
    const limit = Number(params.get("limit") ?? cap)
    return reply(
      filtered.slice(from, from + Math.min(limit, cap)),
      filtered.length,
    )
  }
}

describe("dashboard counts", () => {
  const counts: Record<Table, number> = {
    artists: 5,
    events: 3,
    bookings: 2,
    promoters: 4,
  }

  it("counts the three maintained datasets through scoped exact HEAD requests", async () => {
    respond = request => reply(undefined, counts[tableOf(request)])
    expect(await getDashboardStats()).toEqual({
      totalArtists: 5,
      eventsInProgress: 3,
      bookingsInProgress: 0,
      totalPromoters: 4,
    })

    expect(requests.map(tableOf).sort()).toEqual([
      "artists", "events", "promoters",
    ])
    for (const request of requests) {
      expect(request.method).toBe("HEAD")
      expect(request.headers.get("prefer")).toContain("count=exact")
      expect(request.url.searchParams.get("select")).toBe("id")
      expect(request.url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE}`)
      expect(request.url.searchParams.get("status")).toBe(
        tableOf(request) === "events"
          ? "eq.in_progress"
          : null,
      )
    }
  })

  it("returns successful zero counts only after successful exact counts", async () => {
    respond = () => reply(undefined, 0)
    expect(await getDashboardStats()).toEqual({
      totalArtists: 0,
      eventsInProgress: 0,
      bookingsInProgress: 0,
      totalPromoters: 0,
    })
  })

  it.each(["artists", "events", "promoters"] as const)(
    "rejects a %s query error rather than displaying zero",
    async table => {
      respond = request => tableOf(request) === table
        ? reply(undefined, 0, 500)
        : reply(undefined, counts[tableOf(request)])

      await expect(getDashboardStats()).rejects.toThrow(
        "Unable to load dashboard counts. Please try again.",
      )
    },
  )

  it.each(["artists", "events", "promoters"] as const)(
    "rejects missing/invalid %s counts",
    async table => {
      for (const invalid of [undefined, "*", "-1", "NaN", "9007199254740992"]) {
        respond = request => reply(
          undefined,
          tableOf(request) === table ? invalid : counts[tableOf(request)],
        )
        await expect(getDashboardStats()).rejects.toThrow(
          "Unable to load dashboard counts. Please try again.",
        )
      }
    },
  )

  it("does not issue count queries without a resolved workspace", async () => {
    mocks.workspace.mockRejectedValueOnce(new Error("No active workspace"))
    await expect(getDashboardStats()).rejects.toThrow("No active workspace")
    expect(requests).toEqual([])
  })
})

describe("event creation validation", () => {
  const valid = { title: "Event", date: "2028-02-29" }

  it.each([
    { title: "" },
    { title: " \t\n " },
    { title: 42 },
    { date: "2026-02-30" },
    { date: "2025-02-29" },
    { date: "2026-13-01" },
    { date: "0000-01-01" },
    { date: "infinity" },
    { date: "-infinity" },
    { date: "today" },
    { date: "2026-01-01T00:00:00Z" },
    { date: " 2026-01-01" },
    { date: null },
    { status: "completed" },
    { status: "pending" },
    { status: "" },
    { status: null },
    { artist_id: "" },
    { artist_id: "bad" },
    { artist_id: `${ARTIST} ` },
    { artist_id: null },
    { promoter_id: "bad" },
    { promoter_id: `${PROMOTER} ` },
    { promoter_id: null },
    { location: 42 },
  ])("rejects %j before backend access", async change => {
    const input = { ...valid, ...change } as unknown as Parameters<typeof createEvent>[0]
    const result = await createEvent(input)

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(requests).toEqual([])
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each(["in_progress", "confirmed", "cancelled"] as const)(
    "persists normalized approved status %s with scoped relations",
    async status => {
      respond = () => reply({ id: EVENT })
      const result = await createEvent({
        title: "  Event  ",
        date: "2028-02-29",
        location: "  Venue  ",
        status,
        artist_id: ARTIST,
        promoter_id: PROMOTER,
        workspace_id: "foreign-workspace",
        public_token: "must-not-write",
      } as Parameters<typeof createEvent>[0])

      expect(result).toEqual({ success: true, eventId: EVENT })
      expect(requests).toHaveLength(1)
      expect(requests[0].method).toBe("POST")
      expect(tableOf(requests[0])).toBe("events")
      expect(requests[0].url.searchParams.get("select")).toBe("id")
      expect(requests[0].body).toEqual({
        title: "Event",
        date: "2028-02-29",
        location: "Venue",
        status,
        artist_id: ARTIST,
        promoter_id: PROMOTER,
        workspace_id: WORKSPACE,
      })
      expect(mocks.revalidate.mock.calls).toEqual([
        ["/dashboard/events"],
        ["/dashboard"],
      ])
    },
  )

  it("defaults only omitted status and normalizes absent relations/blank location", async () => {
    respond = () => reply({ id: EVENT })
    expect(await createEvent({ ...valid, location: "   " })).toEqual({
      success: true,
      eventId: EVENT,
    })
    expect(requests[0].body).toEqual({
      ...valid,
      location: null,
      status: "in_progress",
      artist_id: null,
      promoter_id: null,
      workspace_id: WORKSPACE,
    })
  })

  it("does not silently add new product text limits", async () => {
    respond = () => reply({ id: EVENT })
    expect((await createEvent({
      title: "x".repeat(201),
      date: "2028-02-29",
      location: "x".repeat(1001),
    })).success).toBe(true)
  })

  it.each(["database error", "missing row"])(
    "does not revalidate success after %s",
    async kind => {
      respond = () => kind === "database error"
        ? reply(
            { code: "23503", message: "write denied", details: null, hint: null },
            undefined,
            400,
          )
        : reply(null)

      const result = await createEvent(valid)
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
      expect(mocks.revalidate).not.toHaveBeenCalled()
    },
  )

  it("preserves workspace-resolution rejection without inserting", async () => {
    mocks.workspace.mockRejectedValueOnce(new Error("No active workspace"))
    await expect(createEvent(valid)).rejects.toThrow("No active workspace")
    expect(requests).toEqual([])
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

const readers = [
  {
    name: "bookings",
    table: "bookings" as Table,
    run: () => getBookings(),
    order: "date.asc,id.asc",
    status: null,
    columns: "*,artist:artists(id,stage_name,name,surname,location,fee,currency,profile_image_url)",
  },
  {
    name: "events",
    table: "events" as Table,
    run: () => listEvents(),
    order: "date.desc,created_at.desc,id.asc",
    status: null,
    columns: "*,artists:artist_id(id,name),promoters:promoter_id(id,name,company_name)",
  },
  {
    name: "events in progress",
    table: "events" as Table,
    run: () => listEventsInProgress(),
    order: "date.asc,created_at.desc,id.asc",
    status: "eq.in_progress",
    columns: "*,artists:artist_id(id,name),promoters:promoter_id(id,name,company_name)",
  },
  {
    name: "promoters",
    table: "promoters" as Table,
    run: () => listPromoters(),
    order: "name.asc,id.asc",
    status: null,
    columns: "id,name,company_name",
  },
  {
    name: "artists",
    table: "artists" as Table,
    run: () => listArtists(),
    order: "name.asc,id.asc",
    status: null,
    columns: "*",
  },
]

describe.each(readers)("$name collection", reader => {
  it.each([2, 73])("returns complete scoped data with cap %s", async cap => {
    const rows = Array.from(
      { length: 205 },
      (_, index) => makeRow(reader.table, index),
    )
    if (reader.table === "events" || reader.table === "bookings") {
      rows[rows.length - 1].date = "2030-01-02"
    }

    const foreign = {
      ...makeRow(reader.table, 900),
      workspace_id: "foreign-workspace",
    }
    const source: Row[] = [foreign, ...rows].reverse()

    if (reader.status) {
      source.push({ ...makeRow(reader.table, 901), status: "confirmed" })
    }
    serveRows(source, cap)

    const actual = await reader.run()
    const expected = reader.order.startsWith("date.desc")
      ? [rows[rows.length - 1], ...rows.slice(0, -1)]
      : rows

    expect(actual.map(row => row.id)).toEqual(expected.map(row => row.id))
    expect(requests.map(request =>
      Number(request.url.searchParams.get("offset") ?? 0),
    )).toEqual(
      Array.from(
        { length: Math.ceil(rows.length / cap) },
        (_, index) => index * cap,
      ),
    )

    for (const request of requests) {
      expect(tableOf(request)).toBe(reader.table)
      expect(request.method).toBe("GET")
      expect(request.headers.get("prefer")).toContain("count=exact")
      expect(request.url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE}`)
      expect(request.url.searchParams.get("status")).toBe(reader.status)
      expect(request.url.searchParams.get("order")).toBe(reader.order)
      expect(request.url.searchParams.get("limit")).toBe("200")
      expect(
        request.url.searchParams.get("select")?.replace(/\s/g, ""),
      ).toBe(reader.columns)
    }
    expect(mocks.workspace).toHaveBeenCalledOnce()
    expect(mocks.createClient).toHaveBeenCalledOnce()
  })

  it("distinguishes an exactly counted empty collection", async () => {
    respond = () => reply([], 0)
    expect(await reader.run()).toEqual([])
    expect(requests).toHaveLength(1)
  })

  it.each(["error", "empty", "duplicate", "changed count", "missing count"])(
    "rejects a later %s rather than yielding partial success",
    async kind => {
      let page = 0
      respond = () => {
        page += 1
        if (page === 1) return reply([makeRow(reader.table, 0)], 2)
        if (kind === "error") {
          return reply(
            { code: "XX000", message: "read failed", details: null, hint: null },
            undefined,
            500,
          )
        }
        if (kind === "empty") return reply([], 2)
        if (kind === "duplicate") return reply([makeRow(reader.table, 0)], 2)
        if (kind === "changed count") return reply([makeRow(reader.table, 1)], 3)
        return reply([makeRow(reader.table, 1)])
      }

      await expect(reader.run()).rejects.toThrow()
      expect(requests).toHaveLength(2)
    },
  )

  it("does not query a collection when workspace resolution fails", async () => {
    mocks.workspace.mockRejectedValueOnce(new Error("No active workspace"))
    await expect(reader.run()).rejects.toThrow("No active workspace")
    expect(requests).toEqual([])
  })
})

it.each([
  { table: "bookings" as Table, run: () => getBookings({ artistId: ARTIST }) },
  { table: "events" as Table, run: () => listEvents({ artistId: ARTIST }) },
])("keeps the artist filter on every $table page", async ({ table, run }) => {
  const rows = Array.from({ length: 5 }, (_, index) => makeRow(table, index))
  serveRows([
    ...rows,
    { ...makeRow(table, 900), artist_id: PROMOTER },
    { ...makeRow(table, 901), workspace_id: "foreign-workspace" },
  ], 2)

  expect((await run()).map(row => row.id)).toEqual(rows.map(row => row.id))
  expect(requests.length).toBeGreaterThan(1)
  for (const request of requests) {
    expect(request.url.searchParams.get("artist_id")).toBe(`eq.${ARTIST}`)
    expect(request.url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE}`)
  }
})

it("does not introduce booking or general-event status/date filtering", async () => {
  for (const table of ["bookings", "events"] as const) {
    requests = []
    const rows = [
      { ...makeRow(table, 0), status: "cancelled" },
      { ...makeRow(table, 1), status: "confirmed", date: "2030-01-02" },
    ]
    serveRows(rows, 1)
    const actual = table === "bookings" ? await getBookings() : await listEvents()
    expect(new Set(actual.map(row => row.id))).toEqual(new Set(rows.map(row => row.id)))
    for (const request of requests) {
      expect(request.url.searchParams.has("status")).toBe(false)
      expect(request.url.searchParams.has("date")).toBe(false)
    }
  }
})

it.each([undefined, false, true])(
  "booking reads reject failure regardless of legacy failOnError=%s",
  async failOnError => {
    respond = () => reply(
      { code: "XX000", message: "private detail", details: null, hint: null },
      undefined,
      500,
    )
    await expect(getBookings({ failOnError })).rejects.toThrow(
      "Unable to load bookings. Please try again.",
    )
  },
)

it("default booking reads reject an expired session", async () => {
  mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
  await expect(getBookings()).rejects.toThrow("Not authenticated")
  expect(requests).toEqual([])
  expect(mocks.workspace).not.toHaveBeenCalled()
})

it("booking authentication errors cannot become successful empty reads", async () => {
  mocks.getUser.mockResolvedValueOnce({
    data: { user: { id: "synthetic-user" } },
    error: { message: "auth unavailable" },
  })
  await expect(getBookings()).rejects.toThrow("Unable to load bookings")
  expect(requests).toEqual([])
})

it("preserves artist normalization including a zero fee", async () => {
  serveRows([makeRow("artists", 0)], 1)
  expect(await listArtists()).toEqual([
    expect.objectContaining({
      stage_name: "Same name",
      real_name: "Same name",
      genre: null,
      genres: [],
      base_rate: 0,
      social_links: [],
      documents: [],
      profile_image_url: null,
    }),
  ])
})


describe("S15 selector privacy", () => {
  it("projects only booking-picker fields from every artist page", async () => {
    const rows = Array.from({ length: 205 }, (_, i) => ({
      ...makeRow("artists", i),
      email: "private@example.test", phone: "PRIVATE_PHONE", notes: "PRIVATE_NOTES",
      allergies: "PRIVATE_HEALTH", special_diet: "PRIVATE_DIET", special_needs: "PRIVATE_NEEDS",
      documents: [{ name: "Private rider", url: "/private" }], overview: "PRIVATE_OVERVIEW",
    }))
    serveRows(rows, 73)
    const result = await getArtists()
    expect(result.map(row => row.id)).toEqual(rows.map(row => row.id))
    const keys = ["id", "name", "surname", "stage_name", "real_name", "location", "genre", "genres", "base_rate", "currency", "profile_image_url"].sort()
    for (const row of result) expect(Object.keys(row).sort()).toEqual(keys)
    expect(result[0]).toEqual({
      id: rows[0].id, name: "Same name", surname: null, stage_name: "Same name",
      real_name: "Same name", location: null, genre: null, genres: [],
      base_rate: 0, currency: "EUR", profile_image_url: null,
    })
    expect(JSON.stringify(result)).not.toContain("PRIVATE_")
    for (const request of requests) {
      expect(request.url.searchParams.get("select")).toBe("id,name,surname,stage_name,genres,location,fee,currency,profile_image_url")
      expect(request.url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE}`)
      expect(request.url.searchParams.get("order")).toBe("name.asc,id.asc")
      expect(request.headers.get("prefer")).toContain("count=exact")
    }
  })
  it("projects only event-picker fields from promoter rows", async () => {
    const row = { ...makeRow("promoters", 0), company_name: "Agency", email: "private@example.test", notes: "PRIVATE_NOTES", phone: "PRIVATE_PHONE" }
    serveRows([row], 1)
    expect(await listPromoters()).toEqual([{ id: row.id, name: "Same name", company_name: "Agency" }])
    expect(requests[0].url.searchParams.get("select")).toBe("id,name,company_name")
    expect(requests[0].url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE}`)
  })
})

it.each([
  "12345678-1234-1234-1234-123456789abc",
  "ABCDEF12-1234-1234-1234-123456789ABC",
])("S18 preserves literal legacy UUID-shaped action identifiers %s", async id => {
  respond = request => request.method === "POST" ? reply({ id: EVENT }) : reply([], 0)
  expect(await createEvent({ title: "Event", date: "2028-02-29", artist_id: id, promoter_id: id }))
    .toEqual({ success: true, eventId: EVENT })
  expect(requests[0].body).toEqual(expect.objectContaining({ artist_id: id, promoter_id: id }))
  requests = []
  expect(await listEvents({ artistId: id })).toEqual([])
  expect(await getBookings({ artistId: id })).toEqual([])
  expect(requests).toHaveLength(2)
  for (const request of requests) expect(request.url.searchParams.get("artist_id")).toBe(`eq.${id}`)
})
