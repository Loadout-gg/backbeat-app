// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
const state = vi.hoisted(() => ({ pathname: "/dashboard/artists/artist-a", signOut: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }))
vi.mock("@/lib/actions/workspace", () => ({ signOut: state.signOut }))
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
it("shows initials in the account control without inert actions or an extra page heading", () => {
  render(<Header title="Artists" userName="  Jane   Smith  " />)
  expect(screen.getByText("JS")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Account menu for Jane Smith" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Notifications" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull()
})
it("provides a named modal navigation with Escape focus return", async () => {
  const { DashboardShell: Shell } = await import("@/components/dashboard/dashboard-shell")
  render(<Shell userName="Jane Smith"><h1>Artist details</h1></Shell>)
  const trigger = screen.getByRole("button", { name: "Open navigation" })
  fireEvent.click(trigger)
  const dialog = screen.getByRole("dialog", { name: "Navigation" })
  expect(within(dialog).getByRole("link", { name: "Artists" })).toBeTruthy()
  fireEvent.keyDown(dialog, { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(screen.getByRole("main").id).toBe("main-content")
})
it("dismisses mobile navigation after choosing an existing route", async () => {
  const { DashboardShell } = await import("@/components/dashboard/dashboard-shell")
  render(<DashboardShell userName="Jane Smith">Workspace</DashboardShell>)
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }))
  const link = within(screen.getByRole("dialog", { name: "Navigation" })).getByRole("link", { name: "Artists" })
  expect(link.getAttribute("href")).toBe("/dashboard/artists")
  // Keep jsdom on this document; the real Link click still reaches Sidebar.
  link.addEventListener("click", (event) => event.preventDefault(), { once: true })
  fireEvent.click(link)
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
})
it.each([
  ["/dashboard", "Dashboard"],
  ["/dashboard/artists", "Artists"],
  ["/dashboard/artists/artist-a", "Artist details"],
  ["/dashboard/settings", "Settings"],
  ["/dashboard/bookings", "Bookings"],
  ["/dashboard/bookings/booking-a", "Booking details"],
  ["/dashboard/events", "Events"],
  ["/dashboard/events/event-a", "Event details"],
  ["/dashboard/artists/new", "Add artist"],
  ["/dashboard/artists/artist-a/edit", "Edit artist"],
  ["/dashboard/events/new", "New event"],
])("gives %s its own header context", async (pathname, title) => {
  state.pathname = pathname
  const { DashboardShell } = await import("@/components/dashboard/dashboard-shell")
  render(<DashboardShell userName="Jane Smith">Workspace</DashboardShell>)
  expect(within(screen.getByRole("banner")).getByText(title)).toBeTruthy()
})
it("preserves keyboard access to account settings and sign out", async () => {
  render(<Header title="Dashboard" userName="Jane Smith" />)
  const trigger = screen.getByRole("button", { name: "Account menu for Jane Smith" })
  fireEvent.keyDown(trigger, { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: "Settings" }).getAttribute("href")).toBe("/dashboard/settings")
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))
  await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1))
})
it("does not mark a similarly prefixed non-artist route as Artists", () => {
  state.pathname = "/dashboard/artists-archive"
  render(<Sidebar />)
  expect(screen.getByRole("link", { name: "Artists" }).hasAttribute("aria-current")).toBe(false)
})
it("keeps initials when an avatar cannot load", () => {
  render(<Header title="Dashboard" userName="Jane Smith" avatarUrl="/missing-avatar.png" />)
  expect(screen.getByText("JS")).toBeTruthy()
})
it("uses a safe fallback for an empty account name", () => {
  render(<Header title="Dashboard" userName="   " />)
  expect(screen.getByRole("button", { name: "Account menu for User" })).toBeTruthy()
  expect(screen.getByText("U")).toBeTruthy()
})
afterEach(() => { cleanup(); vi.clearAllMocks(); state.pathname = "/dashboard/artists/artist-a" })
it("exposes the current artist section for a nested route without selecting dashboard", () => {
  render(<Sidebar />)
  expect(screen.getByRole("link", { name: "Artists" }).getAttribute("aria-current")).toBe("page")
  expect(screen.getByRole("link", { name: "Dashboard" }).hasAttribute("aria-current")).toBe(false)
})
