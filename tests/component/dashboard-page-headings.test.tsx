// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"

const server = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
  listArtists: vi.fn(),
  pathname: "/dashboard/artists",
}))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentUser: server.getCurrentUser, signOut: server.signOut }))
vi.mock("@/lib/actions/artists", () => ({ listArtists: server.listArtists }))
vi.mock("next/navigation", () => ({
  usePathname: () => server.pathname,
  redirect: (url: string) => { throw new Error(`redirect:${url}`) },
}))

import DashboardLayout from "@/app/dashboard/layout"
import ArtistsPage from "@/app/dashboard/artists/page"
import SettingsPage from "@/app/dashboard/settings/page"

beforeEach(() => {
  server.getCurrentUser.mockResolvedValue({ profile: { full_name: "Synthetic Operator", avatar_url: null } })
  server.listArtists.mockResolvedValue([])
  server.pathname = "/dashboard/artists"
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function expectPageHeading(name: string) {
  const heading = within(screen.getByRole("main")).getByRole("heading", { level: 1, name })
  expect(heading.tagName).toBe("H1")
  expect(screen.getAllByRole("heading", { level: 1 })).toEqual([heading])
  expect(screen.getByRole("button", { name: "Account menu for Synthetic Operator" })).toBeTruthy()
  return heading
}

it.each(["empty", "populated"])("Artists has one page-owned primary heading in the %s state", async (state) => {
  if (state === "populated") {
    server.listArtists.mockResolvedValue([{
      id: "synthetic-artist", name: "Synthetic", surname: "Performer", stage_name: "Synthetic Act",
      genres: ["House"], location: "Rome", fee: 500, currency: "EUR",
    }])
  }
  render(await DashboardLayout({ children: await ArtistsPage() }))
  expect(expectPageHeading("Artists").className).toBe("sr-only")
  if (state === "empty") {
    expect(screen.getByText("No artists yet. Add your first artist to get started.")).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  } else {
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Synthetic ActSynthetic Performer" }).getAttribute("href"))
      .toBe("/dashboard/artists/synthetic-artist")
    expect(screen.getByText("Showing 1-1 of 1 artists")).toBeTruthy()
  }
})

it("Settings has one page-owned primary heading", async () => {
  server.pathname = "/dashboard/settings"
  render(await DashboardLayout({ children: <SettingsPage /> }))
  expect(expectPageHeading("Settings").className).toBe("text-2xl font-semibold mb-2")
  expect(screen.getByText("Workspace settings coming soon. You'll be able to manage your team, billing, and preferences here.")).toBeTruthy()
})
