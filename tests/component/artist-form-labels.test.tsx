// @vitest-environment jsdom
// F21 (Simone's UX decision 2026-11-23, follow-up to F20/PR #44): every label on the
// add and edit artist forms is programmatically tied to its control.
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  createArtist: vi.fn(),
  getArtist: vi.fn(),
  updateArtist: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), back: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }))
vi.mock("@/lib/actions/artists", () => ({
  createArtist: mocks.createArtist,
  getArtist: mocks.getArtist,
  updateArtist: mocks.updateArtist,
}))

import NewArtistPage from "@/app/dashboard/artists/new/page"
import EditArtistPage from "@/app/dashboard/artists/[id]/edit/page"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderForm(form: "add" | "edit") {
  if (form === "add") {
    render(<NewArtistPage />)
  } else {
    mocks.getArtist.mockResolvedValueOnce({ id: "artist-a", stage_name: "DJ Moon", name: "Luna", currency: "€" })
    render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  }
  await screen.findByRole("textbox", { name: "Stage name" })
}

function goToStep(step: number) {
  for (let current = 1; current < step; current++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
}

// [visible label, role, step]; Base rate is the fee input, the currency selector is named separately.
const labelledControls = [
  ["Stage name", "textbox", 1],
  ["Name", "textbox", 1],
  ["Surname", "textbox", 1],
  ["Artist location", "textbox", 1],
  ["Contact name", "textbox", 1],
  ["Phone number", "textbox", 1],
  ["Email", "textbox", 1],
  ["Base rate", "spinbutton", 1],
  ["Travel fee", "combobox", 1],
  ["Additional note", "textbox", 1],
  ["Type of link", "combobox", 1],
  ["Link", "textbox", 1],
  ["About artist", "textbox", 2],
  ["DJ equipment", "textbox", 2],
  ["Sound system", "textbox", 2],
  ["Allergies", "textbox", 4],
  ["Special diet", "textbox", 4],
  ["Special needs & accessibility", "textbox", 4],
] as const

it.each(["add", "edit"] as const)("%s artist: every label names its control and is the control's label", async (form) => {
  await renderForm(form)
  let step = 1
  for (const [label, role, labelStep] of labelledControls) {
    if (labelStep !== step) {
      goToStep(labelStep - step + 1)
      step = labelStep
    }
    const control = screen.getByRole(role, { name: label })
    const labelElement = screen.getByText(label, { selector: "label" }) as HTMLLabelElement
    // label.control is the element a browser focuses or activates when the label is clicked.
    expect(labelElement.control, `${form}: ${label}`).toBe(control)
    if (role === "combobox") {
      // As for New event (F20): clicking the label moves focus to its selector.
      fireEvent.click(labelElement)
      expect(document.activeElement, `${form}: ${label}`).toBe(control)
      // The click can open the selector (as on New event); close it before the next label.
      const listbox = screen.queryByRole("listbox")
      if (listbox) fireEvent.keyDown(listbox, { key: "Escape" })
      await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
    }
  }
})

it.each(["add", "edit"] as const)("%s artist: the currency selector has its own accessible name", async (form) => {
  await renderForm(form)
  const currency = screen.getByRole("combobox", { name: "Artist currency" })
  expect(currency.id).toBe("currency")
  // Travel fee and Type of link no longer share an unnamed selector with the currency.
  expect(screen.getAllByRole("combobox").map((element) => element.getAttribute("aria-label") ?? element.id))
    .toEqual(["Artist currency", "travel_fee", "social_link_type"])
  expect(screen.getAllByRole("combobox").every((element) => screen.getAllByRole("combobox", { name: /\S/ }).includes(element))).toBe(true)
})

it.each(["add", "edit"] as const)("%s artist: the Music genres label names the genre group", async (form) => {
  await renderForm(form)
  goToStep(2)
  const group = screen.getByRole("group", { name: "Music genres" })
  expect(group.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0)
  expect(screen.getByRole("checkbox", { name: "House" })).toBeTruthy()
})
