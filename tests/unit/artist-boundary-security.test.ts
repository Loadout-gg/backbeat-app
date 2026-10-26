import { beforeEach, expect, it, vi } from "vitest"

const { db, query } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["insert", "update", "select", "eq", "single"]) {
    query[method] = vi.fn()
  }
  return { query, db: { from: vi.fn() } }
})

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => db),
}))
vi.mock("@/lib/actions/workspace", () => ({
  getCurrentWorkspaceId: vi.fn(async () => "workspace-a"),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "@/lib/actions/workspace"
import { revalidatePath } from "next/cache"
import {
  createArtist,
  updateArtist,
  type CreateArtistInput,
  type UpdateArtistInput,
} from "@/lib/actions/artists"

beforeEach(() => {
  vi.clearAllMocks()
  db.from.mockReset()
  db.from.mockReturnValue(query)
  for (const method of Object.values(query)) {
    method.mockReset()
    method.mockReturnValue(query)
  }
  query.single.mockResolvedValue({
    data: { id: "artist-a", notes: "Contact: Old\nKeep this body\n" },
    error: null,
  })
  vi.mocked(createClient).mockResolvedValue(db as never)
  vi.mocked(getCurrentWorkspaceId).mockResolvedValue("workspace-a")
})

function create(input: unknown) {
  return createArtist(input as CreateArtistInput)
}

function update(input: unknown) {
  return updateArtist("artist-a", input as UpdateArtistInput)
}

function expectNoBackendAccess() {
  expect(createClient).not.toHaveBeenCalled()
  expect(getCurrentWorkspaceId).not.toHaveBeenCalled()
  expect(db.from).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
}

it("persists create fee zero as zero rather than null", async () => {
  expect(await create({ stage_name: "DJ Moon", fee: 0 }))
    .toEqual({ success: true, artistId: "artist-a" })
  expect(query.insert.mock.calls[0][0].fee).toBe(0)
})

it.each([
  [{ stage_name: "DJ Moon" }, null],
  [{ stage_name: "DJ Moon", fee: undefined }, null],
  [{ stage_name: "DJ Moon", fee: null }, null],
  [{ stage_name: "DJ Moon", fee: 125.25 }, 125.25],
] as const)("preserves create fee semantics for %j", async (input, expected) => {
  expect((await create(input)).success).toBe(true)
  expect(query.insert.mock.calls[0][0].fee).toBe(expected)
})

const invalidFields: [string, unknown][] = [
  ["stage_name", ""],
  ["stage_name", " \n\t "],
  ["stage_name", null],
  ["stage_name", 7],
  ["email", "not-an-email"],
  ["email", { address: "a@example.test" }],
  ["fee", -1],
  ["fee", Number.NaN],
  ["fee", Number.POSITIVE_INFINITY],
  ["fee", Number.NEGATIVE_INFINITY],
  ["fee", "0"],
  ["fee", false],
  ["social_links", { unexpected: "object" }],
  ["social_links", '[{"type":"Website","url":"https://example.test"}]'],
  ["social_links", [null]],
  ["social_links", [{ type: {}, url: "https://example.test" }]],
  ["social_links", [{ type: "Website", url: {} }]],
  ["social_links", [{ type: "Website" }]],
  ["documents", { name: "Rider", url: "https://example.test/rider.pdf" }],
  ["documents", '[{"name":"Rider","url":"https://example.test/rider.pdf"}]'],
  ["documents", [null]],
  ["documents", [{ name: {}, url: "https://example.test/rider.pdf" }]],
  ["documents", [{ name: "Rider", url: 9 }]],
  ["documents", [{ name: "Rider" }]],
  ["genres", "House"],
  ["genres", ["House", {}]],
]

it.each(invalidFields)(
  "rejects malformed create field %s=%j before backend access",
  async (field, value) => {
    const result = await create({ stage_name: "DJ Moon", [field]: value })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expectNoBackendAccess()
  },
)

it.each(invalidFields)(
  "rejects malformed update field %s=%j before backend access",
  async (field, value) => {
    const result = await update({ [field]: value })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expectNoBackendAccess()
  },
)

const textFields = [
  "name",
  "surname",
  "location",
  "contact_name",
  "phone",
  "currency",
  "travel_fee",
  "pricing_notes",
  "overview",
  "dj_equipment",
  "sound_system",
  "allergies",
  "special_diet",
  "special_needs",
  "notes",
] as const

it.each(textFields)("validates the complete text allowlist: %s", async (field) => {
  expect((await create({ stage_name: "DJ Moon", [field]: {} })).success)
    .toBe(false)
  expect((await update({ [field]: 42 })).success).toBe(false)
  expectNoBackendAccess()
})

it.each([null, undefined, [], "artist", 42].map((input) => ({ input })))(
  "rejects a non-object create or update payload",
  async ({ input }) => {
    expect((await create(input)).success).toBe(false)
    expect((await update(input)).success).toBe(false)
    expectNoBackendAccess()
  },
)

it("requires a stage name on create, without requiring it on partial update", async () => {
  expect((await create({ email: "a@example.test" })).success).toBe(false)
  expectNoBackendAccess()

  expect(await update({ phone: "" })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ phone: null })
})

it("persists parsed stage name and email while retaining the real-name contract", async () => {
  await create({
    stage_name: "  DJ Moon  ",
    name: "  Luna  ",
    email: "  luna@example.test  ",
  })
  expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
    stage_name: "DJ Moon",
    name: "Luna",
    email: "luna@example.test",
  }))

  await update({ stage_name: "  DJ Sun  ", email: "   " })
  expect(query.update).toHaveBeenCalledWith({
    stage_name: "DJ Sun",
    email: null,
  })
})

it("keeps an explicitly supplied update name separate and unchanged", async () => {
  await update({ name: "  Luna  " })
  expect(query.update).toHaveBeenCalledWith({ name: "  Luna  " })
})

it.each([undefined, "", "   "])(
  "retains create fallback for absent/blank real name: %j",
  async (name) => {
    await create({ stage_name: "DJ Moon", name })
    expect(query.insert.mock.calls[0][0].name).toBe("DJ Moon")
  },
)

it("does not replace an explicitly cleared real name with stage name on update", async () => {
  await update({ name: "" })
  expect(query.update).toHaveBeenCalledWith({ name: "" })
})

it.each([null, 7, {}])("rejects nonstring real names: %j", async (name) => {
  expect((await create({ stage_name: "DJ Moon", name })).success).toBe(false)
  expect((await update({ name })).success).toBe(false)
  expectNoBackendAccess()
})

it.each([0, null, 125.25])(
  "preserves supplied update fee %j without unit conversion",
  async (fee) => {
    expect(await update({ fee })).toEqual({ success: true })
    expect(query.update).toHaveBeenCalledWith({ fee })
  },
)

it("does not touch omitted or explicitly undefined fields", async () => {
  await update({
    stage_name: "DJ Sun",
    fee: undefined,
    email: undefined,
    currency: undefined,
    notes: undefined,
    contact_name: undefined,
    social_links: undefined,
    documents: undefined,
  })
  expect(query.update).toHaveBeenCalledWith({ stage_name: "DJ Sun" })
})

const nullableTextFields = [
  "surname",
  "location",
  "email",
  "phone",
  "travel_fee",
  "pricing_notes",
  "overview",
  "dj_equipment",
  "sound_system",
  "allergies",
  "special_diet",
  "special_needs",
] as const

it.each(nullableTextFields)(
  "clears explicit blank and null values for %s",
  async (field) => {
    await update({ [field]: "" })
    expect(query.update).toHaveBeenLastCalledWith({ [field]: null })
    await update({ [field]: null })
    expect(query.update).toHaveBeenLastCalledWith({ [field]: null })
  },
)

it.each(["social_links", "documents", "genres"] as const)(
  "clears %s only when supplied as [] or null",
  async (field) => {
    await update({ [field]: [] })
    expect(query.update).toHaveBeenLastCalledWith({ [field]: [] })
    await update({ [field]: null })
    expect(query.update).toHaveBeenLastCalledWith({ [field]: [] })
  },
)

it.each(["$", "EUR", "CHF", "Legacy credits", "", null])(
  "preserves an explicitly supplied currency label %j",
  async (currency) => {
    await create({ stage_name: "DJ Moon", currency })
    expect(query.insert.mock.calls[0][0].currency).toBe(currency)
    await update({ currency })
    expect(query.update).toHaveBeenCalledWith({ currency })
  },
)

it("defaults create currency only when omitted", async () => {
  await create({ stage_name: "DJ Moon" })
  expect(query.insert.mock.calls[0][0].currency).toBe("USD")
})

it("does not add arbitrary text or collection caps", async () => {
  const overview = "Legacy biography\n".repeat(2000)
  const genres = Array.from({ length: 150 }, (_, index) => `Legacy genre ${index}`)
  const social_links = Array.from({ length: 120 }, (_, index) => ({
    type: `Legacy link ${index}`,
    url: `example.test/${index}`,
  }))

  expect((await create({
    stage_name: "Long-running collective ".repeat(30),
    overview,
    genres,
    social_links,
  })).success).toBe(true)

  expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
    overview,
    genres,
    social_links,
  }))
})

it("uses a complete parsed allowlist rather than persisting caller ownership or aliases", async () => {
  const payload = {
    stage_name: "  DJ Moon  ",
    name: "Luna",
    surname: "Rossi",
    location: "Rome",
    contact_name: "Agent",
    phone: "+39 000",
    email: "  luna@example.test  ",
    fee: 0,
    currency: "Legacy credits",
    travel_fee: "Custom legacy travel agreement",
    pricing_notes: "  Exact pricing note  ",
    social_links: [{
      type: "Custom platform",
      url: "example.test/artist",
      injected: { bad: true },
    }],
    overview: "Line one\nLine two",
    genres: ["Legacy genre"],
    dj_equipment: "Mixer\nDecks",
    sound_system: "Venue system",
    documents: [{
      name: "Rider",
      url: "/storage/rider.pdf",
      injected: { bad: true },
    }],
    allergies: "Nuts",
    special_diet: "Vegetarian",
    special_needs: "Step-free access",
    notes: "Body\nSecond line\n",
    workspace_id: "workspace-attacker",
    id: "artist-attacker",
    created_at: "attacker timestamp",
    updated_at: "attacker timestamp",
    profile_image_url: "https://attacker.invalid/image",
    base_rate: 9000,
    real_name: "Attacker alias",
    unrecognized: "discard",
  }

  await create(payload)
  expect(query.insert).toHaveBeenCalledWith({
    workspace_id: "workspace-a",
    name: "Luna",
    stage_name: "DJ Moon",
    surname: "Rossi",
    location: "Rome",
    email: "luna@example.test",
    phone: "+39 000",
    notes: "Contact: Agent\nBody\nSecond line\n",
    fee: 0,
    currency: "Legacy credits",
    travel_fee: "Custom legacy travel agreement",
    pricing_notes: "  Exact pricing note  ",
    social_links: [{ type: "Custom platform", url: "example.test/artist" }],
    overview: "Line one\nLine two",
    genres: ["Legacy genre"],
    dj_equipment: "Mixer\nDecks",
    sound_system: "Venue system",
    documents: [{ name: "Rider", url: "/storage/rider.pdf" }],
    allergies: "Nuts",
    special_diet: "Vegetarian",
    special_needs: "Step-free access",
  })

  await update({
    phone: "new",
    social_links: payload.social_links,
    documents: payload.documents,
    workspace_id: "workspace-attacker",
    id: "artist-attacker",
    base_rate: 9000,
    profile_image_url: "https://attacker.invalid/image",
  })

  expect(query.update).toHaveBeenCalledWith({
    phone: "new",
    social_links: [{ type: "Custom platform", url: "example.test/artist" }],
    documents: [{ name: "Rider", url: "/storage/rider.pdf" }],
  })
  expect(query.eq.mock.calls).toEqual([
    ["id", "artist-a"],
    ["workspace_id", "workspace-a"],
    ["id", "artist-a"],
    ["workspace_id", "workspace-a"],
  ])
})

it.each([
  ["Contact: Old\nKeep this body\n", "", "Keep this body\n"],
  ["Contact: Old\nKeep this body\n", null, "Keep this body\n"],
  ["Contact: Old\n\nKeep\n", "New", "Contact: New\n\nKeep\n"],
  ["Private body\n", "New", "Contact: New\nPrivate body\n"],
  ["Contact: Old", "", null],
] as const)(
  "preserves the contact-note body for %j",
  async (notes, contact_name, expected) => {
    query.single.mockResolvedValueOnce({
      data: { id: "artist-a", notes },
      error: null,
    })
    await update({ contact_name })
    expect(query.update).toHaveBeenCalledWith({ notes: expected })
  },
)

it("retains both contact and body during create", async () => {
  await create({
    stage_name: "DJ Moon",
    contact_name: "New agent",
    notes: "Private body\nSecond line\n",
  })
  expect(query.insert.mock.calls[0][0].notes)
    .toBe("Contact: New agent\nPrivate body\nSecond line\n")
})

it("supports explicit full-note replacement without changing unrelated fields", async () => {
  await update({ notes: "Replacement\n" })
  expect(query.update).toHaveBeenCalledWith({ notes: "Replacement\n" })
})

it("applies a supplied contact change to supplied replacement notes", async () => {
  await update({
    notes: "Contact: Previous\nReplacement body\n",
    contact_name: "New",
  })
  expect(query.update).toHaveBeenCalledWith({
    notes: "Contact: New\nReplacement body\n",
  })
})

it.each(["", null])("clears explicitly supplied full notes: %j", async (notes) => {
  await update({ notes })
  expect(query.update).toHaveBeenCalledWith({ notes: null })
})

it("cannot bypass denied workspace authority with a caller workspace ID", async () => {
  vi.mocked(getCurrentWorkspaceId)
    .mockRejectedValueOnce(new Error("No active workspace membership"))

  await expect(update({
    phone: "new",
    workspace_id: "workspace-attacker",
  })).rejects.toThrow("No active workspace membership")

  expect(query.update).not.toHaveBeenCalled()
  expect(query.insert).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
})

it("does not update a row absent from the authoritative workspace", async () => {
  query.single.mockResolvedValueOnce({ data: null, error: null })
  expect(await update({ phone: "new" }))
    .toEqual({ success: false, error: "Artist not found" })
  expect(query.update).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
})

it("does not report success when the scoped mutation returns no row", async () => {
  query.single
    .mockResolvedValueOnce({ data: { id: "artist-a", notes: null }, error: null })
    .mockResolvedValueOnce({ data: null, error: null })

  expect(await update({ phone: "new" }))
    .toEqual({ success: false, error: "Artist not found" })
  expect(revalidatePath).not.toHaveBeenCalled()
})

it("does not revalidate after a failed insert", async () => {
  query.single.mockResolvedValueOnce({
    data: null,
    error: { message: "Synthetic insert denied" },
  })
  expect(await create({ stage_name: "DJ Moon" }))
    .toEqual({ success: false, error: "Synthetic insert denied" })
  expect(revalidatePath).not.toHaveBeenCalled()
})

it.each([null, "", "   ", 42])(
  "rejects an unusable update identifier without backend access: %j",
  async (id) => {
    expect(await updateArtist(id as string, { phone: "new" }))
      .toEqual({ success: false, error: "Artist is required" })
    expectNoBackendAccess()
  },
)
