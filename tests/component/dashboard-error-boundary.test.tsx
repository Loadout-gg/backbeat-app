// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import DashboardError from "@/app/dashboard/error"
afterEach(cleanup)
it("shows only a safe error and invokes Next reset on retry", () => {
  const reset = vi.fn()
  render(<DashboardError error={new Error("PRIVATE_DATABASE_DETAIL")} reset={reset} />)
  expect(screen.getByRole("alert").textContent).toBe("Unable to load workspace data. Please try again.")
  expect(screen.queryByText(/PRIVATE_DATABASE_DETAIL/)).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(reset).toHaveBeenCalledOnce()
})
