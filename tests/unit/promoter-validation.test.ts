import { expect, it } from "vitest"
import { promoterSchema } from "@/lib/promoter-validation"

const parse = (input: unknown) => promoterSchema.safeParse(input)
const firstError = (input: unknown) => {
  const result = parse(input)
  return result.success ? null : result.error.issues[0].message
}

it("needs only a name; blank optional fields become null", () => {
  expect(parse({ name: "  Marta Rossi  " })).toEqual({
    success: true,
    data: { name: "Marta Rossi", company_name: null, email: null, phone: null, notes: null },
  })
  expect(parse({ name: "Marta", company_name: "  ", email: "", phone: null, notes: "\n " })).toEqual({
    success: true,
    data: { name: "Marta", company_name: null, email: null, phone: null, notes: null },
  })
})

it("trims and keeps the supplied details, including multi-line notes", () => {
  expect(parse({
    name: "Marta Rossi", company_name: " Nightwave Srl ", email: " marta@example.com ",
    phone: " +39 079 123 4567 ", notes: " Prefers email.\nPays in 30 days. ",
  })).toEqual({
    success: true,
    data: {
      name: "Marta Rossi", company_name: "Nightwave Srl", email: "marta@example.com",
      phone: "+39 079 123 4567", notes: "Prefers email.\nPays in 30 days.",
    },
  })
})

it("drops unknown fields such as ownership or identifiers", () => {
  const result = parse({ name: "Marta", workspace_id: "other", id: "forced", created_at: "2020-01-01" })
  expect(result.success && Object.keys(result.data).sort()).toEqual(["company_name", "email", "name", "notes", "phone"])
})

it.each([
  [{}, "Promoter name is required"],
  [{ name: "" }, "Promoter name is required"],
  [{ name: "   " }, "Promoter name is required"],
  [{ name: 7 }, "Promoter name is required"],
  [{ name: "a".repeat(201) }, "Promoter name must be 200 characters or fewer"],
  [{ name: "bad\nname" }, "Promoter name cannot contain line breaks or control characters"],
  [{ name: "Marta", company_name: "c".repeat(201) }, "Company must be 200 characters or fewer"],
  [{ name: "Marta", company_name: "bad\tcompany" }, "Company cannot contain line breaks or control characters"],
  [{ name: "Marta", email: "not-an-email" }, "Enter a valid email address"],
  [{ name: "Marta", email: "a@b" }, "Enter a valid email address"],
  [{ name: "Marta", phone: "call me" }, "Enter a valid phone number"],
  [{ name: "Marta", phone: "1".repeat(51) }, "Phone must be 50 characters or fewer"],
  [{ name: "Marta", notes: "n".repeat(2001) }, "Notes must be 2000 characters or fewer"],
  [{ name: "Marta", notes: "bell\u0007" }, "Notes cannot contain control characters"],
])("rejects %j with %j", (input, message) => {
  expect(firstError(input)).toBe(message)
})

it("accepts values exactly at the limits", () => {
  expect(parse({ name: "a".repeat(200), company_name: "c".repeat(200), phone: "+" + "1".repeat(49), notes: "n".repeat(2000) }).success).toBe(true)
})
