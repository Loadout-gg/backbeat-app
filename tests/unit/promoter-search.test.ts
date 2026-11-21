import { expect, it } from "vitest"
import { filterPromoters } from "@/lib/promoter-search"

const list = [
  { id: "1", name: "Marta Rossi", company_name: "Nightwave Srl", email: "marta@example.com", phone: "+39 079 123" },
  { id: "2", name: "José Núñez", company_name: null, email: null, phone: null },
  { id: "3", name: "Luca Bianchi", company_name: "Rossi Events", email: "luca@clubs.test", phone: "555 0100" },
]
const ids = (query: string) => filterPromoters(list, query).map(item => item.id)

it("returns everything, in the same order, for an empty or blank query", () => {
  expect(ids("")).toEqual(["1", "2", "3"])
  expect(ids("   ")).toEqual(["1", "2", "3"])
})
it("matches name, company, email and phone, ignoring case", () => {
  expect(ids("MARTA")).toEqual(["1"])
  expect(ids("rossi")).toEqual(["1", "3"])
  expect(ids("clubs.test")).toEqual(["3"])
  expect(ids("079")).toEqual(["1"])
})
it("ignores accents in both the query and the data", () => {
  expect(ids("jose nunez")).toEqual(["2"])
  expect(ids("Màrta")).toEqual(["1"])
})
it("requires every typed word, in any order", () => {
  expect(ids("rossi luca")).toEqual(["3"])
  expect(ids("rossi nobody")).toEqual([])
})
it("does not change the list it is given", () => {
  const copy = [...list]
  filterPromoters(list, "marta")
  expect(list).toEqual(copy)
})
