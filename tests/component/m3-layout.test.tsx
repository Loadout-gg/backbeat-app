// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn(), signOut: vi.fn() }))
vi.mock("@/lib/actions/workspace", () => auth)
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))
import DashboardLayout from "@/app/dashboard/layout"

beforeEach(() => auth.getCurrentUser.mockResolvedValue({ profile: { full_name: "Synthetic Operator", avatar_url: null } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it("connects the authenticated server layout to the accessible Agent shell", async () => {
  render(await DashboardLayout({ children: <h1>Synthetic workspace</h1> }))
  expect(screen.queryByRole("button", { name: "Open navigation" })).toBeTruthy()
  expect(screen.getByRole("main").id).toBe("main-content")
  expect(screen.getByRole("button", { name: "Account menu for Synthetic Operator" })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Synthetic workspace" })).toBeTruthy()
})

it("preserves the login redirect for an unauthenticated request", async () => {
  auth.getCurrentUser.mockResolvedValue(null)
  await expect(DashboardLayout({ children: "Protected" })).rejects.toThrow("redirect:/auth/login")
})

it("preserves the safe account fallback when the profile is incomplete", async () => {
  auth.getCurrentUser.mockResolvedValue({ profile: null })
  render(await DashboardLayout({ children: "Workspace" }))
  expect(screen.getByRole("button", { name: "Account menu for User" })).toBeTruthy()
})
