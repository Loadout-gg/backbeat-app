// @vitest-environment jsdom
// Mocked provider boundary: these tests do not prove real delivery or activation.
import React from "react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
const { verifyOtp, resend, push } = vi.hoisted(() => ({ verifyOtp: vi.fn(), resend: vi.fn(), push: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { verifyOtp, resend } }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
import ConfirmationPage from "@/app/auth/signup-success/page"
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
beforeEach(() => {
 sessionStorage.clear()
 sessionStorage.setItem("backbeat.pending-signup", JSON.stringify({ email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" }))
 verifyOtp.mockReset(); resend.mockReset()
 verifyOtp.mockResolvedValue({ data: { session: { user: { id: "mock-user" } } }, error: null })
 resend.mockResolvedValue({ error: null })
})
afterEach(cleanup)
it("focuses the code input when confirmation opens", async () => {
 render(<ConfirmationPage />)
 const input = await screen.findByLabelText("Confirmation code")
 await waitFor(() => expect(document.activeElement).toBe(input))
})
it("does not lose a verified session when storage cleanup is blocked", async () => {
 render(<ConfirmationPage />)
 fireEvent.change(await screen.findByLabelText("Confirmation code"), { target: { value: "123456" } })
 const storage = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked") })
 try {
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
  await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"))
 } finally { storage.mockRestore() }
})
it("shows a recoverable rate-limit message on confirmation", async () => {
 verifyOtp.mockResolvedValueOnce({ error: { status: 429 } })
 render(<ConfirmationPage />)
 fireEvent.change(await screen.findByLabelText("Confirmation code"), { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
 expect((await screen.findByRole("alert")).textContent).toContain("wait")
 expect(push).not.toHaveBeenCalled()
})
it("requires a verified session rather than an empty success response", async () => {
 verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: null })
 render(<ConfirmationPage />)
 fireEvent.change(await screen.findByLabelText("Confirmation code"), { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
 expect((await screen.findByRole("alert")).textContent).toContain("session")
 expect(push).not.toHaveBeenCalled()
})
it("presents six visual slots through one accessible code input", async () => {
 render(<ConfirmationPage />)
 expect(await screen.findByLabelText("Confirmation code")).toBeTruthy()
 expect(screen.getAllByLabelText("Confirmation code")).toHaveLength(1)
 expect(document.querySelectorAll('[data-slot="confirmation-digit"]')).toHaveLength(6)
})
it.each(["confirm", "resend"])("locks concurrent %s operations", async (kind) => {
 if (kind === "confirm") verifyOtp.mockReturnValue(new Promise(() => {}))
 else resend.mockReturnValue(new Promise(() => {}))
 render(<ConfirmationPage />)
 const input = await screen.findByLabelText("Confirmation code")
 fireEvent.change(input, { target: { value: "123456" } })
 if (kind === "confirm") { fireEvent.submit(input.closest("form")!); fireEvent.submit(input.closest("form")!) }
 else { fireEvent.click(screen.getByRole("button", { name: "Resend code" })); fireEvent.submit(input.closest("form")!) }
 expect(kind === "confirm" ? verifyOtp : resend).toHaveBeenCalledTimes(1)
 expect(kind === "confirm" ? resend : verifyOtp).not.toHaveBeenCalled()
 expect((screen.getByRole("button", { name: "Close confirmation" }) as HTMLButtonElement).disabled).toBe(true)
})
it("recovers missing pending context using an email without creating another account", async () => {
 sessionStorage.clear()
 render(<ConfirmationPage />)
 const email = await screen.findByLabelText("Registration email")
 fireEvent.change(email, { target: { value: "ada@example.test" } })
 fireEvent.click(screen.getByRole("button", { name: "Continue confirmation" }))
 const input = await screen.findByLabelText("Confirmation code")
 fireEvent.change(input, { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
 await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ email: "ada@example.test", token: "123456", type: "email" }))
})
it("dismisses confirmation to registration while keeping only pending identity", async () => {
 render(<ConfirmationPage />)
 fireEvent.change(await screen.findByLabelText("Confirmation code"), { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Close confirmation" }))
 expect(push).toHaveBeenCalledWith("/auth/signup")
 expect(sessionStorage.getItem("backbeat.pending-signup")).not.toContain("123456")
 expect(verifyOtp).not.toHaveBeenCalled()
})
it.each(["rate", "network"])("recovers from %s resend failure", async (kind) => {
 if (kind === "rate") resend.mockResolvedValueOnce({ error: { status: 429 } })
 else resend.mockRejectedValueOnce(new Error("offline"))
 render(<ConfirmationPage />)
 fireEvent.click(await screen.findByRole("button", { name: "Resend code" }))
 expect((await screen.findByRole("alert")).textContent).toContain(kind === "rate" ? "wait" : "connection")
 fireEvent.click(screen.getByRole("button", { name: "Resend code" }))
 expect((await screen.findByRole("status")).textContent).toContain("new code")
 expect(screen.queryByRole("alert")).toBeNull()
})
it("resends an existing signup code with feedback", async () => {
 render(<ConfirmationPage />)
 fireEvent.click(await screen.findByRole("button", { name: "Resend code" }))
 await waitFor(() => expect(resend).toHaveBeenCalledWith({ type: "signup", email: "ada@example.test" }))
 expect((await screen.findByRole("status")).textContent).toContain("new code")
 expect(verifyOtp).not.toHaveBeenCalled()
})
it.each(["returned", "network"])("recovers from %s verification failure without losing email context", async (kind) => {
 if (kind === "returned") verifyOtp.mockResolvedValueOnce({ error: { code: "otp_expired" } })
 else verifyOtp.mockRejectedValueOnce(new Error("offline"))
 render(<ConfirmationPage />)
 const input = await screen.findByLabelText("Confirmation code")
 fireEvent.change(input, { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
 expect((await screen.findByRole("alert")).textContent).toContain(kind === "returned" ? "incorrect or expired" : "connection")
 expect(push).not.toHaveBeenCalled()
 expect(sessionStorage.getItem("backbeat.pending-signup")).not.toBeNull()
 fireEvent.change(input, { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
 await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"))
})
it("rejects short or nonnumeric confirmation without a provider call", async () => {
 render(<ConfirmationPage />)
 const input = await screen.findByLabelText("Confirmation code")
 for (const value of ["12", "abcdef"]) {
  fireEvent.change(input, { target: { value } })
  fireEvent.submit(input.closest("form")!)
 }
 expect(verifyOtp).not.toHaveBeenCalled()
 expect(screen.getByRole("alert").textContent).toContain("Enter the six-digit code")
})
it("verifies a six-digit email code before continuing and removes the pending draft", async () => {
 render(<ConfirmationPage />)
 const input = await screen.findByLabelText("Confirmation code")
 expect(screen.getByRole("dialog").textContent).toContain("ada@example.test")
 fireEvent.change(input, { target: { value: "123456" } })
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
 await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ email: "ada@example.test", token: "123456", type: "email" }))
 await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"))
 expect(sessionStorage.getItem("backbeat.pending-signup")).toBeNull()
})

it.each([undefined, "over_email_send_rate_limit", "over_request_rate_limit"])(
  "preserves the complete resend 429 recovery guidance (%s)",
  async code => {
    resend.mockResolvedValueOnce({ error: { status: 429, ...(code ? { code } : {}) } })
    render(<ConfirmationPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Resend code" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Please wait before requesting another code, then try again.",
    )
    expect(screen.queryByRole("status")).toBeNull()
    expect((screen.getByRole("button", { name: "Resend code" }) as HTMLButtonElement).disabled).toBe(false)
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  },
)

it("keeps confirmation recoverable when the native sender rejects resend", async () => {
  resend.mockResolvedValueOnce({ error: { code: "email_address_not_authorized", status: 403 } })
  render(<ConfirmationPage />)
  fireEvent.click(await screen.findByRole("button", { name: "Resend code" }))
  expect((await screen.findByRole("alert")).textContent).toBe("Email delivery is limited to authorized test accounts during this internal test phase.")
  expect(screen.queryByRole("status")).toBeNull()
  expect((screen.getByRole("button", { name: "Resend code" }) as HTMLButtonElement).disabled).toBe(false)
  expect(verifyOtp).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
})
