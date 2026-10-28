// @vitest-environment jsdom
// Provider calls are mocked with the installed auth-js error classes: UI mapping evidence, not hosted Auth proof.
import React from "react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js"
const { signInWithPassword, push, refresh } = vi.hoisted(() => ({ signInWithPassword: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithPassword } }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))
import LoginPage from "@/app/auth/login/page"
beforeEach(() => { signInWithPassword.mockReset(); push.mockReset(); refresh.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })
const providerText = "Provider detail that must not be shown"
for (const [name, failure, message] of [
 ["invalid credentials", new AuthApiError(providerText, 400, "invalid_credentials"), "Email or password is incorrect."],
 ["rate limiting", new AuthApiError(providerText, 429, "over_request_rate_limit"), "Too many attempts. Please wait, then try again."],
 ["rate limiting without a code", new AuthApiError(providerText, 429, undefined), "Too many attempts. Please wait, then try again."],
 ["an unmapped provider error", new AuthApiError(providerText, 400, "validation_failed"), "Could not log in. Check your connection and try again."],
 ["a network failure", new AuthRetryableFetchError(providerText, 0), "Could not log in. Check your connection and try again."],
] as const) {
 it(`announces fixed copy for ${name} with the destructive token`, async () => {
  signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: failure })
  submit()
  const alert = await screen.findByRole("alert")
  expect(alert.textContent).toBe(message)
  expect(alert.className).toContain("text-destructive")
  expect(screen.queryByText(providerText, { exact: false })).toBeNull()
  expect(push).not.toHaveBeenCalled()
 })
}
it("links an unconfirmed email to confirmation without showing provider text", async () => {
 signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: new AuthApiError(providerText, 400, "email_not_confirmed") })
 submit()
 const alert = await screen.findByRole("alert")
 expect(alert.textContent).toBe("Confirm your email before logging in. Continue confirmation")
 expect(screen.getByRole("link", { name: "Continue confirmation" }).getAttribute("href")).toBe("/auth/signup-success")
 expect(screen.queryByText(providerText, { exact: false })).toBeNull()
})
it("uses the generic copy when the provider call rejects", async () => {
 signInWithPassword.mockRejectedValue(new Error(providerText))
 submit()
 expect((await screen.findByRole("alert")).textContent).toBe("Could not log in. Check your connection and try again.")
 expect(screen.queryByText(providerText, { exact: false })).toBeNull()
})
it("keeps the successful refresh and delayed dashboard navigation", async () => {
 vi.useFakeTimers()
 signInWithPassword.mockResolvedValue({ data: { user: {}, session: {} }, error: null })
 submit()
 await vi.advanceTimersByTimeAsync(0)
 expect(signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.test", password: "12345678" })
 expect(refresh).toHaveBeenCalledTimes(1)
 expect(push).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(100)
 expect(push).toHaveBeenCalledWith("/dashboard")
 expect(screen.queryByRole("alert")).toBeNull()
})
function submit() {
 render(<LoginPage />)
 fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } })
 fireEvent.change(screen.getByLabelText("Password"), { target: { value: "12345678" } })
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
}
