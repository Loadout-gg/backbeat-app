// @vitest-environment jsdom
import React from "react"
import { afterEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
const m = vi.hoisted(() => ({
  refresh: vi.fn(), createTravelLeg: vi.fn(), updateTravelLeg: vi.fn(), deleteTravelLeg: vi.fn(),
  createBookingStay: vi.fn(), updateBookingStay: vi.fn(), deleteBookingStay: vi.fn(), updateBooking: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn(), back: vi.fn() }) }))
vi.mock("@/lib/actions/booking-travel", () => ({
  createTravelLeg: m.createTravelLeg, updateTravelLeg: m.updateTravelLeg, deleteTravelLeg: m.deleteTravelLeg,
  createBookingStay: m.createBookingStay, updateBookingStay: m.updateBookingStay, deleteBookingStay: m.deleteBookingStay,
}))
vi.mock("@/lib/actions/bookings", () => ({ updateBooking: m.updateBooking, deleteBooking: vi.fn(), updateBookingStatus: vi.fn() }))
import { BookingTravelPanel } from "@/components/dashboard/booking-travel/booking-travel-panel"
import { BookingStaysPanel } from "@/components/dashboard/booking-travel/booking-stays-panel"
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import type { TravelLeg, BookingStay } from "@/lib/actions/booking-travel"
import type { BookingWithArtist } from "@/lib/actions/bookings"
afterEach(cleanup)

const leg: TravelLeg = {
  id: "leg-1", booking_id: "booking-a", direction: "inbound", mode: "flight", carrier: "Moon Air", reference: "MA123",
  depart_place: "Rome FCO", depart_date: "2030-05-01", depart_time: "08:30:00", depart_zone: "CET",
  arrive_place: "London LHR", arrive_date: "2030-05-01", arrive_time: "10:15:00", arrive_zone: "GMT",
  travellers: "Artist, tour manager", driver_name: "Dan Driver", driver_phone: "+44 7000", notes: null,
}
const profile = {
  artistId: "artist-a", dateOfBirth: "1990-02-03",
  documents: [
    { id: "doc-1", artist_id: "artist-a", doc_type: "passport" as const, number: "YA0000001", issuing_country: "Italy", expires_on: "2030-04-30", holder_name: "Luna Moon" },
    { id: "doc-2", artist_id: "artist-a", doc_type: "id_card" as const, number: "CA00001", issuing_country: null, expires_on: null, holder_name: null },
  ],
}
const travelPanel = (props: Partial<React.ComponentProps<typeof BookingTravelPanel>> = {}) => (
  <BookingTravelPanel bookingId="booking-a" bookingDate="2030-05-01" artistId="artist-a" artistName="DJ Moon"
    legs={[leg]} travelProfile={profile} {...props} />
)
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

it("lists legs with local times, zone labels and driver, and the artist documents read-only", () => {
  render(travelPanel())
  const card = screen.getByRole("article", { name: "Travel leg: Inbound · flight · Moon Air" })
  expect(card.textContent).toContain("Rome FCO, 2030-05-01 08:30 CET")
  expect(card.textContent).toContain("London LHR, 2030-05-01 10:15 GMT")
  expect(card.textContent).toContain("Dan Driver, +44 7000")
  const documents = screen.getByRole("region", { name: "Travel documents: DJ Moon" })
  expect(documents.textContent).toContain("1990-02-03")
  expect(documents.textContent).toContain("YA0000001")
  expect(within(documents).getByText("Expires before this booking")).toBeTruthy()
  expect(within(documents).queryAllByRole("textbox")).toHaveLength(0)
  expect(within(documents).getByRole("link", { name: "Edit on the artist profile" }).getAttribute("href")).toBe("/dashboard/artists/artist-a")
})

it("shows unavailable states instead of empty lists when reads failed", () => {
  render(travelPanel({ legs: null, travelProfile: null }))
  expect(screen.getByText("Travel legs could not be loaded. Reload the page to try again.")).toBeTruthy()
  expect(screen.getByText("Travel documents could not be loaded. Reload the page to try again.")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Add travel leg" })).toBeNull()
  expect(screen.queryByText("No travel legs yet.")).toBeNull()
})

it("validates date order before any server call, keeps the draft", async () => {
  render(travelPanel({ legs: [] }))
  fireEvent.click(screen.getByRole("button", { name: "Add travel leg" }))
  const form = screen.getByRole("form", { name: "New travel leg" })
  fireEvent.change(within(form).getByLabelText("Departure date"), { target: { value: "2030-05-02" } })
  fireEvent.change(within(form).getByLabelText("Arrival date"), { target: { value: "2030-05-01" } })
  fireEvent.click(within(form).getByRole("button", { name: "Add travel leg" }))
  expect((await within(form).findByRole("alert")).textContent).toBe("Arrival cannot be before departure")
  expect(m.createTravelLeg).not.toHaveBeenCalled()
  expect((within(form).getByLabelText("Departure date") as HTMLInputElement).value).toBe("2030-05-02")
})

it("ignores a duplicate submit, keeps the draft after a failure and retries the same values", async () => {
  const first = deferred<{ success: boolean; error?: string }>()
  m.createTravelLeg.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ success: true })
  render(travelPanel({ legs: [] }))
  fireEvent.click(screen.getByRole("button", { name: "Add travel leg" }))
  const form = screen.getByRole("form", { name: "New travel leg" })
  fireEvent.change(within(form).getByLabelText("Direction"), { target: { value: "outbound" } })
  fireEvent.change(within(form).getByLabelText("Driver name"), { target: { value: "Dan" } })
  const submit = within(form).getByRole("button", { name: "Add travel leg" })
  fireEvent.click(submit)
  fireEvent.click(within(form).getByRole("button", { name: "Saving..." }))
  expect(m.createTravelLeg).toHaveBeenCalledTimes(1)
  await act(async () => first.resolve({ success: false, error: "Booking not found" }))
  expect(within(form).getByRole("alert").textContent).toBe("Booking not found")
  expect(m.refresh).not.toHaveBeenCalled()
  expect((within(form).getByLabelText("Driver name") as HTMLInputElement).value).toBe("Dan")
  fireEvent.click(within(form).getByRole("button", { name: "Add travel leg" }))
  await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce())
  expect(m.createTravelLeg).toHaveBeenNthCalledWith(2, "booking-a", expect.objectContaining({ direction: "outbound", driver_name: "Dan" }))
  expect(screen.queryByRole("form", { name: "New travel leg" })).toBeNull()
})

it("edits a leg with its stored values and HH:MM times", async () => {
  m.updateTravelLeg.mockResolvedValueOnce({ success: true })
  render(travelPanel())
  fireEvent.click(screen.getByRole("button", { name: "Edit travel leg: Inbound · flight · Moon Air" }))
  const form = screen.getByRole("form", { name: "Edit travel leg" })
  expect((within(form).getByLabelText("Departure time (local)") as HTMLInputElement).value).toBe("08:30")
  fireEvent.change(within(form).getByLabelText("Notes"), { target: { value: "Window seat" } })
  fireEvent.click(within(form).getByRole("button", { name: "Save travel leg" }))
  await waitFor(() => expect(m.updateTravelLeg).toHaveBeenCalledWith("booking-a", "leg-1", expect.objectContaining({ notes: "Window seat", depart_time: "08:30", arrive_time: "10:15" })))
})

it("deletes a leg only after confirmation and reports a failed delete", async () => {
  m.deleteTravelLeg.mockResolvedValueOnce({ success: false, error: "Travel leg not found" })
  render(travelPanel())
  fireEvent.click(screen.getByRole("button", { name: "Delete travel leg: Inbound · flight · Moon Air" }))
  expect(m.deleteTravelLeg).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
  expect(await screen.findByText("Travel leg not found")).toBeTruthy()
  expect(m.refresh).not.toHaveBeenCalled()
})

const stay: BookingStay = { id: "stay-1", booking_id: "booking-a", name: "Hotel Moon", address: "1 Orbit Rd", check_in_on: "2030-05-01", check_out_on: "2030-05-02", confirmation_ref: "HM-1", notes: null }

it("lists, validates and adds accommodation", async () => {
  m.createBookingStay.mockResolvedValueOnce({ success: true })
  render(<BookingStaysPanel bookingId="booking-a" stays={[stay]} />)
  expect(screen.getByRole("article", { name: "Accommodation: Hotel Moon" }).textContent).toContain("HM-1")
  fireEvent.click(screen.getByRole("button", { name: "Add accommodation" }))
  const form = screen.getByRole("form", { name: "New accommodation" })
  fireEvent.click(within(form).getByRole("button", { name: "Add accommodation" }))
  expect((await within(form).findByRole("alert")).textContent).toBe("Enter the accommodation name")
  fireEvent.change(within(form).getByLabelText("Accommodation name"), { target: { value: "Dayroom" } })
  fireEvent.change(within(form).getByLabelText("Check-in date"), { target: { value: "2030-05-02" } })
  fireEvent.change(within(form).getByLabelText("Check-out date"), { target: { value: "2030-05-01" } })
  fireEvent.click(within(form).getByRole("button", { name: "Add accommodation" }))
  expect((await within(form).findByRole("alert")).textContent).toBe("Check-out cannot be before check-in")
  fireEvent.change(within(form).getByLabelText("Check-out date"), { target: { value: "2030-05-02" } })
  fireEvent.click(within(form).getByRole("button", { name: "Add accommodation" }))
  await waitFor(() => expect(m.createBookingStay).toHaveBeenCalledWith("booking-a", expect.objectContaining({ name: "Dayroom", check_in_on: "2030-05-02", check_out_on: "2030-05-02" })))
  expect(m.refresh).toHaveBeenCalledOnce()
})

it("shows an unavailable accommodation state without an add control", () => {
  render(<BookingStaysPanel bookingId="booking-a" stays={null} />)
  expect(screen.getByText("Accommodation could not be loaded. Reload the page to try again.")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Add accommodation" })).toBeNull()
})

const booking: BookingWithArtist = {
  fee_amount_minor: null, fee_currency: null, id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a",
  date: "2030-05-01", start_time: "19:00:00", venue_name: null, venue_address: null, contact_name_main: null,
  contact_phone_main: null, contact_email_main: null, duration_minutes: 60, notes: null, status: "in_progress",
  created_at: "", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: null, profile_image_url: null },
}

it("replaces the coming-soon Travel and Accommodation panels and keeps a travel draft across tab switches", async () => {
  render(<EventBookingClient booking={booking} travelPanel={travelPanel({ legs: [] })}
    accommodationPanel={<BookingStaysPanel bookingId="booking-a" stays={[]} />} />)
  const tabs = within(screen.getByRole("tablist", { name: "Booking sections" }))
  act(() => tabs.getByRole("tab", { name: "Travel" }).focus())
  const travel = await screen.findByRole("tabpanel", { name: "Travel" })
  expect(travel.textContent).not.toContain("coming soon")
  fireEvent.click(within(travel).getByRole("button", { name: "Add travel leg" }))
  fireEvent.change(within(travel).getByLabelText("Driver name"), { target: { value: "Unsaved driver" } })
  act(() => tabs.getByRole("tab", { name: "Accommodation" }).focus())
  const accommodation = await screen.findByRole("tabpanel", { name: "Accommodation" })
  expect(within(accommodation).getByText("No accommodation yet.")).toBeTruthy()
  act(() => tabs.getByRole("tab", { name: "Travel" }).focus())
  await waitFor(() => expect(tabs.getByRole("tab", { name: "Travel" }).getAttribute("aria-selected")).toBe("true"))
  expect((within(screen.getByRole("tabpanel", { name: "Travel" })).getByLabelText("Driver name") as HTMLInputElement).value).toBe("Unsaved driver")
  act(() => tabs.getByRole("tab", { name: "Documents" }).focus())
  expect((await screen.findByRole("tabpanel", { name: "Documents" })).textContent).toContain("This section is coming soon.")
  expect(m.updateBooking).not.toHaveBeenCalled()
})
