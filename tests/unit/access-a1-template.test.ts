import { readFileSync, existsSync } from "node:fs"
import { expect, it } from "vitest"
it("ships a static signup template with the literal Go token and no confirmation link", () => {
 const path = "public/auth/signup-confirmation.html"
 expect(existsSync(path)).toBe(true)
 const template = readFileSync(path, "utf8")
 expect(template).toContain("{{ .Token }}")
 expect(template).not.toContain(".ConfirmationURL")
 expect(template).not.toContain("<script")
 expect(template).toContain("Backbeat")
})
