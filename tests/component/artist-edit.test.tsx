// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
const { getArtist, updateArtist, router } = vi.hoisted(() => ({
  getArtist: vi.fn(), updateArtist: vi.fn(), router: { push: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/actions/artists", () => ({ getArtist, updateArtist }))
import EditArtistPage from "@/app/dashboard/artists/[id]/edit/page"

afterEach(cleanup)
it("submits an explicit empty email when the existing email is cleared in the edit wizard", async () => {
  getArtist.mockResolvedValueOnce({ id: "artist-a", stage_name: "DJ Moon", name: "Luna", email: "artist@example.test" })
  updateArtist.mockResolvedValueOnce({ success: false, error: "Synthetic save denied" })
  render(<EditArtistPage params={Promise.resolve({ id: "artist-a" })} />)
  const email = await screen.findByRole("textbox", { name: "Email" })
  expect((email as HTMLInputElement).value).toBe("artist@example.test")
  fireEvent.change(email, { target: { value: "" } })
  for (let step = 1; step < 4; step++) {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  }
  fireEvent.click(screen.getByRole("button", { name: "Save and Complete" }))
  await waitFor(() => expect(updateArtist).toHaveBeenCalledOnce())
  expect(updateArtist).toHaveBeenCalledWith("artist-a", expect.objectContaining({
    email: "", stage_name: "DJ Moon", name: "Luna", phone: undefined,
    location: undefined, fee: undefined, social_links: undefined,
  }))
  expect(await screen.findByText("Synthetic save denied")).toBeTruthy()
  expect((screen.getByRole("button", { name: "Save and Complete" }) as HTMLButtonElement).disabled).toBe(false)
  expect(router.push).not.toHaveBeenCalled()
})
