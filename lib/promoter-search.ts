type Searchable = { name: string; company_name: string | null; email: string | null; phone: string | null }

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

/** Case- and accent-insensitive match of every typed word against name, company, email and phone. */
export function filterPromoters<T extends Searchable>(promoters: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...promoters]
  return promoters.filter((promoter) => {
    const haystack = fold([promoter.name, promoter.company_name, promoter.email, promoter.phone].filter(Boolean).join(" "))
    return words.every((word) => haystack.includes(word))
  })
}
