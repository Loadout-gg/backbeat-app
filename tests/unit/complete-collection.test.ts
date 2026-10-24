import { expect, it, vi } from "vitest"
import {
  readCompleteCollection,
  type CollectionPage,
} from "@/lib/read-complete-collection"

type Row = { id: string }
type Page = CollectionPage<Row>

const row = (id: string): Row => ({ id })
const page = (data: Row[] | null, count: number | null): Page => ({
  data,
  count,
  error: null,
})

it.each([200, 73, 1])(
  "reads every row with provider cap %s and advances by actual rows",
  async cap => {
    const rows = Array.from(
      { length: 405 },
      (_, index) => row(String(index).padStart(4, "0")),
    )
    const fetchPage = vi.fn(async (from: number, to: number) =>
      page(rows.slice(from, Math.min(to + 1, from + cap)), rows.length),
    )

    expect(await readCompleteCollection(fetchPage, "Test")).toEqual(rows)
    expect(fetchPage.mock.calls).toEqual(
      Array.from(
        { length: Math.ceil(rows.length / cap) },
        (_, index) => [index * cap, index * cap + 199],
      ),
    )
  },
)

it("accepts an exactly counted empty collection", async () => {
  const fetchPage = vi.fn(async () => page([], 0))
  expect(await readCompleteCollection(fetchPage, "Test")).toEqual([])
  expect(fetchPage).toHaveBeenCalledOnce()
})

it.each([
  null,
  undefined,
  -1,
  1.5,
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
  "1",
])("rejects invalid count %s", async count => {
  const invalid = { data: [], error: null, count } as unknown as Page
  await expect(
    readCompleteCollection(async () => invalid, "Test"),
  ).rejects.toThrow("invalid count")
})

it.each([null, {}, "rows"])("rejects malformed data %j", async data => {
  const invalid = { data, error: null, count: 0 } as unknown as Page
  await expect(
    readCompleteCollection(async () => invalid, "Test"),
  ).rejects.toThrow("incomplete")
})

it.each([null, {}, { id: null }, { id: "" }, { id: " " }, { id: 42 }])(
  "rejects malformed row identity %j",
  async value => {
    const invalid = {
      data: [value],
      count: 1,
      error: null,
    } as unknown as Page
    await expect(
      readCompleteCollection(async () => invalid, "Test"),
    ).rejects.toThrow("invalid row ID")
  },
)

it.each([true, false])("rejects duplicate IDs; same page=%s", async samePage => {
  const fetchPage = vi.fn<() => Promise<Page>>()
  if (samePage) {
    fetchPage.mockResolvedValue(page([row("a"), row("a")], 2))
  } else {
    fetchPage
      .mockResolvedValueOnce(page([row("a")], 2))
      .mockResolvedValueOnce(page([row("a")], 2))
  }
  await expect(
    readCompleteCollection(fetchPage, "Test"),
  ).rejects.toThrow("duplicate ID")
})

it.each([1, 3, null])("rejects later changed/missing count %s", async count => {
  const fetchPage = vi.fn<() => Promise<Page>>()
    .mockResolvedValueOnce(page([row("a")], 2))
    .mockResolvedValueOnce(page([row("b")], count))

  await expect(
    readCompleteCollection(fetchPage, "Test"),
  ).rejects.toThrow("count")
})

it("stops immediately at a premature empty page", async () => {
  const fetchPage = vi.fn<() => Promise<Page>>()
    .mockResolvedValueOnce(page([row("a")], 2))
    .mockResolvedValueOnce(page([], 2))
    .mockResolvedValueOnce(page([row("b")], 2))

  await expect(
    readCompleteCollection(fetchPage, "Test"),
  ).rejects.toThrow("incomplete")
  expect(fetchPage).toHaveBeenCalledTimes(2)
})

it.each([
  [201, 201],
  [2, 1],
])("rejects inconsistent response size %s/count %s", async (size, count) => {
  const rows = Array.from({ length: size }, (_, index) => row(String(index)))
  await expect(
    readCompleteCollection(async () => page(rows, count), "Test"),
  ).rejects.toThrow("inconsistent row count")
})

it.each([false, true])(
  "propagates database errors without returning partial data; later=%s",
  async later => {
    const fetchPage = vi.fn<() => Promise<Page>>()
    if (later) fetchPage.mockResolvedValueOnce(page([row("a")], 2))
    fetchPage.mockResolvedValueOnce({
      data: null,
      count: null,
      error: { message: "read denied" },
    })

    await expect(
      readCompleteCollection(fetchPage, "Test"),
    ).rejects.toThrow("read denied")
  },
)

it("propagates a rejected page request without returning partial rows", async () => {
  const fetchPage = vi.fn<() => Promise<Page>>()
    .mockResolvedValueOnce(page([row("a")], 2))
    .mockRejectedValueOnce(new Error("transport unavailable"))

  await expect(
    readCompleteCollection(fetchPage, "Test"),
  ).rejects.toThrow("transport unavailable")
})
