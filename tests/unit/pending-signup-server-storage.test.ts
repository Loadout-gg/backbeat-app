import { afterEach, expect, it, vi } from "vitest"
import { readPendingSignup } from "@/lib/auth/pending-signup"

afterEach(() => vi.unstubAllGlobals())

it("does not read process-wide Web Storage when there is no browser window", () => {
  vi.stubGlobal("window", undefined)
  const getItem = vi.fn(() => JSON.stringify({
    email: "synthetic@example.test", firstName: "Ada", lastName: "Lovelace",
  }))
  vi.stubGlobal("sessionStorage", { getItem })
  expect(readPendingSignup()).toBeNull()
  expect(getItem).not.toHaveBeenCalled()
})
