import { expect, it } from "vitest"
import {
  createArtistSchema,
  updateArtistSchema,
  parseSocialLinks,
  parseDocuments,
  artistMetadataHref,
  withArtistContact,
} from "@/lib/artist-validation"

it("shares all create properties with partial update, without update defaults", () => {
  expect(updateArtistSchema.parse({})).toEqual({})
  expect(updateArtistSchema.parse({
    stage_name: "  DJ Moon  ",
    email: "  luna@example.test  ",
  })).toEqual({
    stage_name: "DJ Moon",
    email: "luna@example.test",
  })
  expect(createArtistSchema.safeParse({}).success).toBe(false)
})

it("strips unsupported top-level and nested fields from parsed output", () => {
  const result = createArtistSchema.parse({
    stage_name: "DJ Moon",
    workspace_id: "attacker",
    social_links: [{ type: "Website", url: "example.test", extra: "discard" }],
    documents: [{ name: "Rider", url: "/storage/rider.pdf", extra: "discard" }],
  })
  expect(result).toEqual({
    stage_name: "DJ Moon",
    social_links: [{ type: "Website", url: "example.test" }],
    documents: [{ name: "Rider", url: "/storage/rider.pdf" }],
  })
})

const socialFixture = [
  null,
  false,
  42,
  [],
  {},
  { type: {}, url: "https://example.test" },
  { type: "Website", url: {} },
  { type: "Website", url: null },
  { type: "Website" },
  { type: "Website", url: "example.test/artist" },
  { type: "Legacy", url: "ftp://example.test/archive" },
  { type: "  Custom label  ", url: "  https://example.test/exact  " },
]

const expectedSocial = [
  { type: "Website", url: "example.test/artist" },
  { type: "Legacy", url: "ftp://example.test/archive" },
  { type: "  Custom label  ", url: "  https://example.test/exact  " },
]

it.each([
  { value: socialFixture },
  { value: JSON.stringify(socialFixture) },
])("safely parses array or stringified social metadata", ({ value }) => {
  expect(parseSocialLinks(value)).toEqual(expectedSocial)
})

const documentFixture = [
  null,
  42,
  [],
  {},
  { name: {} },
  { name: "Wrong URL type", url: {} },
  { name: "Wrong URL type", url: 7 },
  { name: "Rider", url: "https://example.test/rider.pdf" },
  { name: "Storage", url: "/storage/rider.pdf" },
  { name: "Legacy name-only" },
  { name: "Legacy null URL", url: null },
  { name: "Legacy archive", url: "ftp://example.test/archive.pdf" },
]

const expectedDocuments = [
  { name: "Rider", url: "https://example.test/rider.pdf" },
  { name: "Storage", url: "/storage/rider.pdf" },
  { name: "Legacy name-only", url: "" },
  { name: "Legacy null URL", url: "" },
  { name: "Legacy archive", url: "ftp://example.test/archive.pdf" },
]

it.each([
  { value: documentFixture },
  { value: JSON.stringify(documentFixture) },
])("safely parses array or stringified document metadata", ({ value }) => {
  expect(parseDocuments(value)).toEqual(expectedDocuments)
})

it.each([
  undefined,
  null,
  false,
  42,
  {},
  "",
  "{broken",
  "{}",
  "null",
  '"not an array"',
])("returns safe empty metadata for a non-array value: %j", (value) => {
  expect(parseSocialLinks(value)).toEqual([])
  expect(parseDocuments(value)).toEqual([])
})

it("does not mutate persisted arrays or pass through arbitrary nested properties", () => {
  const links = Object.freeze([
    Object.freeze({ type: "Website", url: "example.test", extra: { ignored: true } }),
  ])
  const documents = Object.freeze([
    Object.freeze({ name: "Rider", url: "/rider.pdf", extra: { ignored: true } }),
  ])
  expect(parseSocialLinks(links)).toEqual([{ type: "Website", url: "example.test" }])
  expect(parseDocuments(documents)).toEqual([{ name: "Rider", url: "/rider.pdf" }])
  expect(links[0]).toHaveProperty("extra")
  expect(documents[0]).toHaveProperty("extra")
})

it("does not truncate valid legacy metadata collections or strings", () => {
  const links = Array.from({ length: 150 }, (_, index) => ({
    type: `Legacy ${index}`,
    url: `https://example.test/${"a".repeat(3000)}?index=${index}`,
  }))
  expect(parseSocialLinks(links)).toEqual(links)
})

it.each([
  ["https://example.test/a?b=1", "https://example.test/a?b=1"],
  ["http://example.test/a", "http://example.test/a"],
  ["HTTPS://EXAMPLE.TEST/a", "https://example.test/a"],
  ["example.test/artist", "https://example.test/artist"],
  ["example.test:8080/artist", "https://example.test:8080/artist"],
  ["//cdn.example.test/rider.pdf", "https://cdn.example.test/rider.pdf"],
  ["/storage/rider.pdf", "/storage/rider.pdf"],
  ["./rider.pdf", "./rider.pdf"],
  ["../rider.pdf", "../rider.pdf"],
  ["  https://example.test/a  ", "https://example.test/a"],
])("permits safe navigation for %j", (value, expected) => {
  expect(artistMetadataHref(value)).toBe(expected)
})

it.each([
  undefined,
  null,
  {},
  42,
  "",
  "   ",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,example",
  "file:///private/file",
  "ftp://example.test/archive",
  "https://example.test/\nunsafe",
  "/\\evil.example.test/file",
  "https://[",
])("does not produce an unsafe navigation target for %j", (value) => {
  expect(artistMetadataHref(value)).toBeNull()
})

it("keeps unsupported-scheme metadata even when no safe href exists", () => {
  const raw = { name: "Legacy archive", url: "ftp://example.test/archive.pdf" }
  expect(parseDocuments([raw])).toEqual([raw])
  expect(artistMetadataHref(raw.url)).toBeNull()
})

it.each([
  [undefined, undefined, null],
  [null, undefined, null],
  ["Body\n", undefined, "Body\n"],
  ["Contact: Old\nBody\n", undefined, "Contact: Old\nBody\n"],
  ["Body\n", "New", "Contact: New\nBody\n"],
  ["Contact: Old\nBody\n", "", "Body\n"],
  ["Contact: Old\nBody\n", null, "Body\n"],
  ["Contact: Old\n\nBody\n", "New", "Contact: New\n\nBody\n"],
  ["Contact: Old", "", null],
] as const)("preserves note semantics for %j and contact %j", (notes, contact, expected) => {
  expect(withArtistContact(notes, contact)).toBe(expected)
})
