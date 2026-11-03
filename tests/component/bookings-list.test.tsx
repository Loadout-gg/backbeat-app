// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { redirect } from "next/navigation"
const { getBookings, refresh } = vi.hoisted(() => ({ getBookings: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/actions/bookings", () => ({ getBookings }))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ refresh }),
}))
import BookingsPage from "@/app/dashboard/bookings/page"
afterEach(cleanup)
it("lets the onboarding redirect propagate instead of showing the read error", async () => {
  getBookings.mockImplementationOnce(async () => redirect("/onboarding"))
  await expect(BookingsPage()).rejects.toMatchObject({
    digest: expect.stringMatching(/^NEXT_REDIRECT;[^;]*;\/onboarding;/),
  })
})
it("includes non-in-progress bookings and shows their status without inventing an artist", async () => {
  getBookings.mockResolvedValueOnce([{
    id: "booking-cancelled", date: "2030-01-02", start_time: "09:45:00", status: "cancelled", artist: null,
  }])
  render(await BookingsPage())
  expect(screen.getByText("cancelled", { exact: true })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Unknown artist" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href")).toBe("/dashboard/bookings/booking-cancelled")
})
it("shows a safe read error instead of claiming the workspace is empty", async () => {
  getBookings.mockRejectedValueOnce(new Error("private database detail"))
  render(await BookingsPage())
  expect(screen.getByRole("alert").textContent).toContain("Unable to load bookings")
  expect(screen.queryByText("No bookings in your workspace yet.")).toBeNull()
  expect(screen.queryByText("private database detail")).toBeNull()
})
it("shows an honest empty state when the workspace has no bookings", async () => {
  getBookings.mockResolvedValueOnce([])
  render(await BookingsPage())
  expect(screen.getByText("No bookings in your workspace yet.")).toBeTruthy()
  expect(screen.queryByRole("link", { name: "Continue setup" })).toBeNull()
})
it("renders workspace bookings with artist names, dates and correct detail links", async () => {
  getBookings.mockResolvedValueOnce([{
    id: "booking-a", date: "2030-01-02", start_time: "09:45:00", status: "confirmed",
    artist: { stage_name: "DJ Luna", name: "Luna" },
  }])
  render(await BookingsPage())
  expect(getBookings).toHaveBeenCalledWith({ failOnError: true })
  expect(screen.getByRole("heading", { name: "Bookings" })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "DJ Luna" })).toBeTruthy()
  expect(screen.getByText("JAN")).toBeTruthy()
  expect(screen.getByText("2", { exact: true })).toBeTruthy()
  expect(screen.getByText("09:45", { exact: true })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href")).toBe("/dashboard/bookings/booking-a")
})
it("shows the stored venue name and address in the booking meta line", async () => {
  getBookings.mockResolvedValueOnce([{
    id: "booking-venue", date: "2030-01-02", start_time: "21:30:00", status: "confirmed",
    venue_name: "Synthetic Hall", venue_address: "1 Synthetic Street",
    artist: { stage_name: "DJ Luna", name: "Luna" },
  }])
  render(await BookingsPage())
  expect(screen.getByText("1 Synthetic Street, Synthetic Hall • 21:30", { exact: true })).toBeTruthy()
})
it("omits absent venue values instead of rendering empty separators", async () => {
  getBookings.mockResolvedValueOnce([{
    id: "booking-partial", date: "2030-01-02", start_time: "21:30:00", status: "confirmed",
    venue_name: "Synthetic Hall", venue_address: null,
    artist: { stage_name: "DJ Luna", name: "Luna" },
  }])
  render(await BookingsPage())
  expect(screen.getByText("Synthetic Hall • 21:30", { exact: true })).toBeTruthy()
})
// router.refresh is mocked to re-render the server page: page-wiring evidence, not a Next runtime refresh.
it("re-runs the bookings read from the error state and restores the list", async () => {
  getBookings.mockRejectedValueOnce(new Error("private database detail"))
  const view = render(await BookingsPage())
  refresh.mockImplementationOnce(async () => view.rerender(await BookingsPage()))
  getBookings.mockResolvedValueOnce([{
    id: "booking-a", date: "2030-01-02", start_time: "09:45:00", status: "confirmed",
    artist: { stage_name: "DJ Luna", name: "Luna" },
  }])
  expect(screen.getByRole("heading", { name: "Bookings" })).toBeTruthy()
  const retry = screen.getByRole("button", { name: "Retry loading bookings" })
  expect(retry.getAttribute("tabindex")).not.toBe("-1")
  retry.focus()
  expect(document.activeElement).toBe(retry)
  await act(async () => { fireEvent.click(retry) })
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(getBookings).toHaveBeenCalledTimes(2)
  expect(screen.getByRole("heading", { name: "DJ Luna" })).toBeTruthy()
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByRole("button", { name: "Retry loading bookings" })).toBeNull()
  expect(screen.queryByText("No bookings in your workspace yet.")).toBeNull()
})
it("offers no retry action when the read succeeds", async () => {
  getBookings.mockResolvedValueOnce([])
  render(await BookingsPage())
  expect(screen.queryByRole("button", { name: "Retry loading bookings" })).toBeNull()
})
