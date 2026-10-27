// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import { readPendingSignup, pendingSignupKey } from "@/lib/auth/pending-signup"
afterEach(() => sessionStorage.clear())
it.each(["not-email", "", "x".repeat(400) + "@example.test"])("rejects malformed or unbounded stored email (%#)", (email) => {
 sessionStorage.setItem(pendingSignupKey, JSON.stringify({ email, firstName: "Ada", lastName: "Lovelace" }))
 expect(readPendingSignup()).toBeNull()
})

it("preserves valid pending-signup data in the browser tab", () => {
  const pending = { email: "synthetic@example.test", firstName: "Ada", lastName: "Lovelace" }
  sessionStorage.setItem(pendingSignupKey, JSON.stringify(pending))
  expect(readPendingSignup()).toEqual(pending)
})
