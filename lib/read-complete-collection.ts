export type CollectionPage<T> = {
  data: T[] | null
  error: { message: string } | null
  count: number | null
}

const BATCH_SIZE = 200

// Completeness/identity checks follow listArtistDirectory's existing contract.
// Callers own authorization, selection, filters and a unique deterministic order.
export async function readCompleteCollection<T extends { id: string }>(
  readPage: (from: number, to: number) => PromiseLike<CollectionPage<T>>,
  label: string,
): Promise<T[]> {
  const result: T[] = []
  const ids = new Set<string>()
  let expectedCount: number | undefined

  while (true) {
    const { data, error, count } = await readPage(
      result.length,
      result.length + BATCH_SIZE - 1,
    )

    if (error) throw new Error(error.message)

    if (
      count === null ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new Error(`${label}: invalid count`)
    }

    if (expectedCount !== undefined && count !== expectedCount) {
      throw new Error(`${label}: count changed`)
    }
    expectedCount = count

    if (
      !Array.isArray(data) ||
      (data.length === 0 && result.length < count)
    ) {
      throw new Error(`${label}: incomplete`)
    }

    if (
      data.length > BATCH_SIZE ||
      result.length + data.length > count
    ) {
      throw new Error(`${label}: inconsistent row count`)
    }

    for (const row of data) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id.trim()
      ) {
        throw new Error(`${label}: invalid row ID`)
      }
      if (ids.has(row.id)) {
        throw new Error(`${label}: duplicate ID`)
      }
      ids.add(row.id)
    }

    result.push(...data)

    if (result.length === count) return result
  }
}
