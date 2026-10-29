// @vitest-environment jsdom
// Provider calls are mocked with the installed auth-js error classes: UI mapping evidence, not hosted Auth proof.
import React from "react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js"
const { signInWithPassword, signUp, verifyOtp, resend, push, refresh } = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signUp: vi.fn(), verifyOtp: vi.fn(), resend: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithPassword, signUp, verifyOtp, resend } }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))
import LoginPage from "@/app/auth/login/page"
import ConfirmationPage from "@/app/auth/signup-success/page"
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
beforeEach(() => {
 sessionStorage.clear()
 signInWithPassword.mockReset(); push.mockReset(); refresh.mockReset()
 verifyOtp.mockResolvedValue({ data: { session: { user: { id: "mock-user" } } }, error: null })
 resend.mockResolvedValue({ error: null })
})
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
// Cross-component evidence: the confirmation page is remounted after the link click, not reached by real navigation.
const unconfirmed = () => ({ data: { user: null, session: null }, error: new AuthApiError(providerText, 400, "email_not_confirmed") })
const draft = (email: string, firstName: string, lastName: string) => sessionStorage.setItem("backbeat.pending-signup", JSON.stringify({ email, firstName, lastName }))
async function continueConfirmation() {
 fireEvent.click(await screen.findByRole("link", { name: "Continue confirmation" }))
 expect(sessionStorage.getItem("backbeat.pending-signup") ?? "").not.toContain("12345678")
 cleanup()
 render(<ConfirmationPage />)
 return screen.findByLabelText("Confirmation code")
}
async function expectConfirmationFor(email: string) {
 const input = await continueConfirmation()
 expect(screen.getByRole("dialog").textContent).toContain(email)
 expect(resend).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole("button", { name: "Resend code" }))
 await waitFor(() => expect(resend).toHaveBeenCalledWith({ type: "signup", email }))
 await screen.findByRole("status")
 fireEvent.change(input, { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
 await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ email, token: "123456", type: "email" }))
 expect(resend).toHaveBeenCalledTimes(1)
 expect(signUp).not.toHaveBeenCalled()
}
it("continues confirmation for the email just used when the tab has no draft", async () => {
 signInWithPassword.mockResolvedValue(unconfirmed())
 submit("current@example.test")
 await expectConfirmationFor("current@example.test")
})
it("resumes a draft that belongs to the email just used", async () => {
 draft("current@example.test", "Current", "Fixture")
 signInWithPassword.mockResolvedValue(unconfirmed())
 submit("current@example.test")
 await expectConfirmationFor("current@example.test")
 expect(screen.getByDisplayValue("Current")).toBeTruthy()
})
it("never resumes an older draft for another address or carries its names", async () => {
 draft("older@example.test", "Older", "Fixture")
 signInWithPassword.mockResolvedValue(unconfirmed())
 submit("current@example.test")
 await expectConfirmationFor("current@example.test")
 expect(resend).not.toHaveBeenCalledWith(expect.objectContaining({ email: "older@example.test" }))
 expect(verifyOtp).not.toHaveBeenCalledWith(expect.objectContaining({ email: "older@example.test" }))
 expect(document.body.textContent).not.toContain("older@example.test")
 expect(screen.queryByDisplayValue("Older")).toBeNull()
 expect(screen.queryByDisplayValue("Fixture")).toBeNull()
})
it("hands off the submitted email of the latest attempt, not a pending or edited one", async () => {
 draft("older@example.test", "Older", "Fixture")
 signInWithPassword.mockResolvedValueOnce(unconfirmed())
 submit("first@example.test")
 await screen.findByRole("link", { name: "Continue confirmation" })
 let settle!: (value: unknown) => void
 signInWithPassword.mockReturnValueOnce(new Promise(resolve => { settle = resolve }))
 fireEvent.change(screen.getByLabelText("Email"), { target: { value: "current@example.test" } })
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 expect(screen.queryByRole("alert")).toBeNull()
 const pending = screen.getByRole("button", { name: "Logging in..." }) as HTMLButtonElement
 expect(pending.disabled).toBe(true)
 fireEvent.click(pending)
 expect(signInWithPassword).toHaveBeenCalledTimes(2)
 await act(async () => settle(unconfirmed()))
 fireEvent.change(screen.getByLabelText("Email"), { target: { value: "edited@example.test" } })
 await expectConfirmationFor("current@example.test")
})
it("asks which email to confirm when the handoff cannot be stored", async () => {
 draft("older@example.test", "Older", "Fixture")
 signInWithPassword.mockResolvedValue(unconfirmed())
 submit("current@example.test")
 const link = await screen.findByRole("link", { name: "Continue confirmation" })
 const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota") })
 try { fireEvent.click(link) } finally { storage.mockRestore() }
 cleanup()
 render(<ConfirmationPage />)
 expect(await screen.findByLabelText("Registration email")).toBeTruthy()
 expect(document.body.textContent).not.toContain("older@example.test")
 expect(screen.queryByDisplayValue("Older")).toBeNull()
 expect(resend).not.toHaveBeenCalled()
 expect(verifyOtp).not.toHaveBeenCalled()
})
function submit(email = "ada@example.test") {
 render(<LoginPage />)
 fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } })
 fireEvent.change(screen.getByLabelText("Password"), { target: { value: "12345678" } })
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
}
