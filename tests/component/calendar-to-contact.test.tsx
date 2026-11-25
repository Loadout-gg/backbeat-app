// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import type { Artist } from "@/lib/actions/artists"
import type { Booking } from "@/lib/actions/bookings"
import type { EventDetail, EventWithRelations } from "@/lib/actions/events"

const mocks = vi.hoisted(() => ({
  getArtist: vi.fn(), getArtists: vi.fn(), getBookings: vi.fn(),
  listEvents: vi.fn(), getEvent: vi.fn(), listPromoters: vi.fn(), createEvent: vi.fn(),
  updateEvent: vi.fn(), deleteEvent: vi.fn(),
}))
vi.mock("@/lib/actions/artists", () => ({ getArtist: mocks.getArtist, getArtists: mocks.getArtists }))
vi.mock("@/lib/actions/bookings", () => ({ getBookings: mocks.getBookings }))
vi.mock("@/lib/actions/events", () => ({
  listEvents: mocks.listEvents, getEvent: mocks.getEvent, listPromoters: mocks.listPromoters,
  createEvent: mocks.createEvent, updateEvent: mocks.updateEvent, deleteEvent: mocks.deleteEvent,
}))
vi.mock("@/components/dashboard/new-booking-modal", () => ({ NewBookingModal: () => null }))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useSearchParams: () => new URLSearchParams("tab=calendar"),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard/artists/artist-a",
}))
import ArtistPage from "@/app/dashboard/artists/[id]/page"
import EventPage from "@/app/dashboard/events/[id]/page"
import EventsPage from "@/app/dashboard/events/page"
import NewEventPage from "@/app/dashboard/events/new/page"

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const artist = { id: "artist-a", name: "Alice", stage_name: "DJ Alice" } as Artist
// Two people of the same company: only the one saved on the event may be shown.
const marta = { id: "promoter-marta", name: "Marta Rossi", company_name: "Nightwave Srl" }
const luca = { id: "promoter-luca", name: "Luca Bianchi", company_name: "Nightwave Srl" }
const relation = (promoter: typeof marta) => ({ id: promoter.id, name: promoter.name, company_name: promoter.company_name })
const events = [
  { id: EVENT_A, artist_id: "artist-a", date: "2026-10-02", title: "Autumn show", location: "Rome", status: "confirmed", promoter_id: marta.id, promoters: relation(marta) },
  { id: EVENT_B, artist_id: "artist-a", date: "2026-10-09", title: "Winter preview", location: "Milan", status: "in_progress", promoter_id: luca.id, promoters: relation(luca) },
] as (EventWithRelations & Pick<EventDetail, "promoter_id">)[]
// The contact written on a booking is the booking's own; it is not an event promoter.
const booking = {
  id: "booking-a", artist_id: "artist-a", date: "2026-10-09", start_time: "20:00", status: "in_progress",
  contact_name_main: "Giulia Verdi", contact_email_main: "giulia@example.test", contact_phone_main: null,
} as Booking
// List rows carry no promoter_id (R17); the detail read does.
const detail = (event: (typeof events)[number]): EventDetail => ({
  id: event.id, title: event.title, date: event.date, location: event.location,
  status: event.status, artist_id: event.artist_id, promoter_id: event.promoter_id,
  booking_id: null, start_time: null, fee_amount_minor: null, fee_currency: null,
})
const promoterCard = () => screen.getByRole("heading", { level: 2, name: "Promoter" }).closest('[data-slot="card"]') as HTMLElement

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 8, 29, 15))
  mocks.getArtist.mockResolvedValue(artist)
  mocks.getArtists.mockResolvedValue([artist])
  mocks.getBookings.mockResolvedValue([booking])
  mocks.listEvents.mockResolvedValue(events)
  mocks.listPromoters.mockResolvedValue([luca, marta])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it("goes from the artist calendar to the requested event and its promoter, without a search", async () => {
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  // Each of the artist's events opens its own page; the booking keeps its booking page.
  expect(screen.getByRole("link", { name: "Autumn show" }).getAttribute("href")).toBe(`/dashboard/events/${EVENT_A}`)
  const winter = screen.getByRole("link", { name: "Winter preview" })
  expect(winter.getAttribute("href")).toBe(`/dashboard/events/${EVENT_B}`)
  expect(screen.getByRole("link", { name: /DJ Alice · Booking/ }).getAttribute("href")).toBe("/dashboard/bookings/booking-a")
  // The calendar never shows the booking contact as anyone's promoter.
  expect(screen.queryByText(/Giulia Verdi/)).toBeNull()
  cleanup()

  mocks.getEvent.mockResolvedValue(detail(events[1]))
  render(await EventPage({ params: Promise.resolve({ id: EVENT_B }) }))
  expect(mocks.getEvent).toHaveBeenCalledWith(EVENT_B)
  expect(screen.getByRole("heading", { level: 1, name: "Winter preview" })).toBeTruthy()
  const card = within(promoterCard())
  const person = card.getByRole("link", { name: "Open Luca Bianchi in the promoter directory" })
  expect(person.getAttribute("href")).toBe(`/dashboard/promoters/${luca.id}/edit`)
  expect(person.textContent).toBe("Luca Bianchi")
  // Person and company are separate values, not one combined label.
  expect(card.getByText("Person")).toBeTruthy()
  expect(card.getByText("Company").nextElementSibling?.textContent).toBe("Nightwave Srl")
  expect(card.queryByText(/Marta Rossi/)).toBeNull()
  expect(card.queryByText(/Giulia Verdi/)).toBeNull()
  expect(mocks.getBookings).toHaveBeenCalledTimes(1)
})

it("opens the other event of the same artist with its own promoter", async () => {
  render(await ArtistPage({ params: Promise.resolve({ id: artist.id }) }))
  expect(screen.getByRole("link", { name: "Autumn show" }).getAttribute("href")).toBe(`/dashboard/events/${EVENT_A}`)
  cleanup()
  mocks.getEvent.mockResolvedValue(detail(events[0]))
  render(await EventPage({ params: Promise.resolve({ id: EVENT_A }) }))
  const card = within(promoterCard())
  expect(card.getByRole("link", { name: "Open Marta Rossi in the promoter directory" }).getAttribute("href")).toBe(`/dashboard/promoters/${marta.id}/edit`)
  expect(card.queryByText(/Luca Bianchi/)).toBeNull()
})

it("says an event has no promoter without suggesting another contact", async () => {
  mocks.getEvent.mockResolvedValue({ ...detail(events[1]), promoter_id: null })
  render(await EventPage({ params: Promise.resolve({ id: EVENT_B }) }))
  const card = within(promoterCard())
  expect(card.getByText("No promoter is linked to this event.")).toBeTruthy()
  expect(card.queryByRole("link")).toBeNull()
  for (const name of [/Luca Bianchi/, /Marta Rossi/, /Nightwave/, /Giulia Verdi/]) expect(card.queryByText(name)).toBeNull()
})

it("says so when the saved promoter is no longer in the directory, without substituting anyone", async () => {
  mocks.getEvent.mockResolvedValue({ ...detail(events[1]), promoter_id: "promoter-gone" })
  render(await EventPage({ params: Promise.resolve({ id: EVENT_B }) }))
  const card = within(promoterCard())
  expect(card.getByText("The linked promoter is no longer in your promoter directory.")).toBeTruthy()
  expect(card.queryByRole("link")).toBeNull()
  expect(card.queryByText(/Luca Bianchi|Marta Rossi/)).toBeNull()
})

it("calls what the events screens create an event, with no booking-conversion wording", async () => {
  render(await EventsPage())
  expect(screen.getByText("The events you create for your artists")).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/booking|convert/i)
  cleanup()

  render(<NewEventPage />)
  expect(screen.getByRole("heading", { level: 1, name: "New event" })).toBeTruthy()
  expect(screen.getByText("Create an event for an artist")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Create event" })).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/booking|convert/i)
  await waitFor(() => expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(false))
})
