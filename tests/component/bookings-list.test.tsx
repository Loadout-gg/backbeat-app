// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
const { getBookings } = vi.hoisted(() => ({ getBookings: vi.fn() }))
vi.mock("@/lib/actions/bookings", () => ({ getBookings }))
import BookingsPage from "@/app/dashboard/bookings/page"
afterEach(cleanup)
it("includes non-in-progress bookings and shows their status without inventing an artist", async () => {
  getBookings.mockResolvedValueOnce([{
    id: "booking-cancelled", date: "2030-01-02", start_time: "09:45:00", status: "cancelled", artist: null,
  }])
  render(await BookingsPage())
  expect(screen.getByText("cancelled", { exact: true })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Unknown Artist" })).toBeTruthy()
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
