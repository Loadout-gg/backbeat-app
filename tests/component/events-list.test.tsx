// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
const { listEvents } = vi.hoisted(() => ({ listEvents: vi.fn() }))
vi.mock("@/lib/actions/events", () => ({ listEvents }))
import EventsPage from "@/app/dashboard/events/page"
afterEach(cleanup)
it("shows a safe read error instead of claiming the workspace has no events", async () => {
  listEvents.mockRejectedValueOnce(new Error("private database detail"))
  render(await EventsPage())
  expect(screen.getByRole("alert").textContent).toBe("Unable to load events. Please refresh and try again.")
  expect(screen.getByRole("heading", { name: "Events" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "New event" }).getAttribute("href")).toBe("/dashboard/events/new")
  expect(screen.queryByText(/No events yet/)).toBeNull()
  expect(screen.queryByText("private database detail")).toBeNull()
})
it("shows the empty state only when the read succeeds with no events", async () => {
  listEvents.mockResolvedValueOnce([])
  render(await EventsPage())
  expect(screen.getByText(/No events yet/)).toBeTruthy()
  expect(screen.queryByRole("alert")).toBeNull()
})
it("renders stored events without an error or empty state", async () => {
  listEvents.mockResolvedValueOnce([{
    id: "event-a", title: "Synthetic Night", date: "2030-03-01", location: null,
    status: "confirmed", artists: null, promoters: null,
  }])
  render(await EventsPage())
  expect(screen.getByRole("heading", { name: "Synthetic Night" })).toBeTruthy()
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByText(/No events yet/)).toBeNull()
})
