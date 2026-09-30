// @vitest-environment jsdom
// Provider calls are mocked: UI wiring evidence, not delivery/confirmation proof.
import React from "react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
const { signUp, push } = vi.hoisted(() => ({ signUp: vi.fn(), push: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signUp } }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
import SignupPage from "@/app/auth/signup/page"
beforeEach(() => { sessionStorage.clear(); signUp.mockReset(); signUp.mockResolvedValue({ data: { session: {} }, error: null }) })
afterEach(cleanup)
it("associates required field errors with every empty signup input", () => {
 render(<SignupPage />)
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 for (const [label, message] of [["Name", "Enter your name."], ["Surname", "Enter your surname."], ["Email", "Enter your email."], ["Password", "Create a password."], ["Confirm Password", "Confirm your password."]]) {
  const input = screen.getByLabelText(label, { exact: true })
  expect(input.getAttribute("aria-invalid")).toBe("true")
  expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(message)
 }
 expect(signUp).not.toHaveBeenCalled()
})
it("rejects seven characters inline and accepts the eight-character boundary", async () => {
 render(<SignupPage />)
 fill("Name", "Ada"); fill("Surname", "Lovelace"); fill("Email", "ada@example.test")
 fill("Password", "1234567"); fill("Confirm Password", "1234567")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 expect(document.getElementById("password-error")?.textContent).toBe("Use at least 8 characters.")
 expect(signUp).not.toHaveBeenCalled()
 fill("Password", "12345678"); fill("Confirm Password", "12345678")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
})
it("associates a mismatch with Confirm Password and permits correction", async () => {
 render(<SignupPage />)
 fill("Name", "Ada"); fill("Surname", "Lovelace"); fill("Email", "ada@example.test")
 fill("Password", "12345678"); fill("Confirm Password", "87654321")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 expect(document.getElementById("repeat-password-error")?.textContent).toBe("Passwords don’t match.")
 expect(signUp).not.toHaveBeenCalled()
 fill("Confirm Password", "12345678")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
})
it("reports invalid email inline without calling signup", () => {
 render(<SignupPage />)
 fill("Name", "Ada"); fill("Surname", "Lovelace"); fill("Email", "invalid")
 fill("Password", "12345678"); fill("Confirm Password", "12345678")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 expect(document.getElementById("email-error")?.textContent).toBe("Enter a valid email address.")
 expect(signUp).not.toHaveBeenCalled()
})
it("persists only pending identity in this tab and clears password fields after signup", async () => {
 render(<SignupPage />)
 fill("Name", "Ada"); fill("Surname", "Lovelace"); fill("Email", "ada@example.test")
 fill("Password", "12345678"); fill("Confirm Password", "12345678")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 await waitFor(() => expect(sessionStorage.getItem("backbeat.pending-signup")).not.toBeNull())
 expect(JSON.parse(sessionStorage.getItem("backbeat.pending-signup")!)).toEqual({ email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" })
 expect((screen.getByLabelText("Password", { exact: true }) as HTMLInputElement).value).toBe("")
 expect((screen.getByLabelText("Confirm Password") as HTMLInputElement).value).toBe("")
 expect(push).not.toHaveBeenCalledWith("/onboarding")
})
it("prevents duplicate in-flight signup submissions", async () => {
 signUp.mockReturnValue(new Promise(() => {}))
 render(<SignupPage />)
 fill("Name", "Ada"); fill("Surname", "Lovelace"); fill("Email", "ada@example.test")
 fill("Password", "12345678"); fill("Confirm Password", "12345678")
 const form = screen.getByLabelText("Email").closest("form")!
 fireEvent.submit(form); fireEvent.submit(form)
 expect(signUp).toHaveBeenCalledTimes(1)
})
it("restores pending identity on return and offers resume without creating another account", async () => {
 sessionStorage.setItem("backbeat.pending-signup", JSON.stringify({ email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" }))
 render(<SignupPage />)
 await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ada"))
 expect((screen.getByLabelText("Password", { exact: true }) as HTMLInputElement).value).toBe("")
 fireEvent.click(screen.getByRole("button", { name: "Continue confirmation" }))
 expect(push).toHaveBeenCalledWith("/auth/signup-success")
 expect(signUp).not.toHaveBeenCalled()
})
it("resumes instead of signing up the same pending email again", async () => {
 sessionStorage.setItem("backbeat.pending-signup", JSON.stringify({ email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" }))
 render(<SignupPage />)
 fill("Password", "12345678"); fill("Confirm Password", "12345678")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 expect(signUp).not.toHaveBeenCalled()
 expect(push).toHaveBeenCalledWith("/auth/signup-success")
})
it.each(["duplicate", "network", "rate"])("offers safe recovery for %s signup failure", async (kind) => {
 if (kind === "duplicate") signUp.mockResolvedValueOnce({ error: { code: "user_already_exists" } })
 else if (kind === "rate") signUp.mockResolvedValueOnce({ error: { status: 429 } })
 else signUp.mockRejectedValueOnce(new Error("offline"))
 render(<SignupPage />)
 fill("Name", "Ada"); fill("Surname", "Lovelace"); fill("Email", "ada@example.test")
 fill("Password", "12345678"); fill("Confirm Password", "12345678")
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 expect((await screen.findByRole("alert")).textContent).toContain(kind === "duplicate" ? "Log in or use another email" : kind === "rate" ? "wait" : "connection")
 expect(push).not.toHaveBeenCalled()
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 await waitFor(() => expect(push).toHaveBeenCalledWith("/auth/signup-success"))
})
it("continues safely when tab storage is unavailable after signup", async () => {
 const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
 try {
  render(<SignupPage />)
  fill("Name", "Ada"); fill("Surname", "Lovelace"); fill("Email", "ada@example.test")
  fill("Password", "12345678"); fill("Confirm Password", "12345678")
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
  await waitFor(() => expect(push).toHaveBeenCalledWith("/auth/signup-success"))
  expect((screen.getByLabelText("Password", { exact: true }) as HTMLInputElement).value).toBe("")
 } finally { storage.mockRestore() }
})
it("exposes the page heading and password minimum before submission", () => {
 render(<SignupPage />)
 expect(screen.getByRole("heading", { level: 1, name: "Create an account" })).toBeTruthy()
 expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy()
 const password = screen.getByLabelText("Password", { exact: true })
 expect(document.getElementById(password.getAttribute("aria-describedby")!)?.textContent).toContain("8 characters")
 expect(password.getAttribute("autocomplete")).toBe("new-password")
})
it("focuses the first invalid signup field", () => {
 render(<SignupPage />)
 fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
 expect(document.activeElement).toBe(screen.getByLabelText("Name"))
})
it("offers a confirmation recovery link even without a saved draft", () => {
 render(<SignupPage />)
 expect(screen.getByRole("link", { name: "Continue confirmation" }).getAttribute("href")).toBe("/auth/signup-success")
})
it.each([
  ["Name", "A".repeat(101)],
  ["Surname", "B".repeat(101)],
  ["Name", `Ada${String.fromCharCode(1)}`],
  ["Surname", `Synthetic${String.fromCharCode(1)}`],
])("rejects identity that the database would discard: %s", (label, value) => {
  render(<SignupPage />)
  fill("Name", "Ada"); fill("Surname", "Synthetic"); fill("Email", "ada@example.test")
  fill("Password", "12345678"); fill("Confirm Password", "12345678")
  fill(label, value)
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
  expect(signUp).not.toHaveBeenCalled()
  const input = screen.getByLabelText(label, { exact: true })
  expect(input.getAttribute("aria-invalid")).toBe("true")
  expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("100 characters")
})
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }) }
it("collects separate identity and sends derived metadata without trimming password", async () => {
  render(<SignupPage />)
  fill("Name", " Ada "); fill("Surname", " Lovelace "); fill("Email", "ada@example.test")
  fill("Password", " eightxx "); fill("Confirm Password", " eightxx ")
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
  await waitFor(() => expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.test", password: " eightxx ", options: expect.objectContaining({ data: { first_name: "Ada", last_name: "Lovelace", full_name: "Ada Lovelace" } }) })))
  expect(push).toHaveBeenCalledWith("/auth/signup-success")
})
