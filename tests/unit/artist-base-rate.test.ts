import { expect, it } from "vitest"
import { formatArtistBaseRate } from "@/lib/artist-base-rate"

it.each([
  ["GBP", "£"], ["£", "£"], ["EUR", "€"], ["€", "€"], ["USD", "$"], ["$", "$"],
])("displays %s using %s without converting the amount", (currency, symbol) => {
  expect(formatArtistBaseRate(400, currency)).toBe(`${symbol}400`)
  expect(formatArtistBaseRate(0, currency)).toBe(`${symbol}0`)
})

it("formats numbers for English UI even under another host locale", () => {
  expect(formatArtistBaseRate(1234.5, "USD")).toBe("$1,234.5")
})

it.each([null, undefined, "", "   ", "\t\n"])("marks unavailable currency %s without losing the amount", currency => {
  expect(formatArtistBaseRate(400, currency)).toBe("400 (currency unavailable)")
  expect(formatArtistBaseRate(0, currency)).toBe("0 (currency unavailable)")
})

it.each(["CHF", "credits", "constructor", " GBP "])("preserves other denomination text %s explicitly", currency => {
  expect(formatArtistBaseRate(400, currency)).toBe(`${currency} 400`)
})

it.each([null, undefined])("keeps missing amount %s unavailable", amount => {
  expect(formatArtistBaseRate(amount, "GBP")).toBe("N/A")
  expect(formatArtistBaseRate(amount, null)).toBe("N/A")
})
