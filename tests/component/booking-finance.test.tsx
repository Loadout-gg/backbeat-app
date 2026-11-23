// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
const mocks = vi.hoisted(() => ({
  updateBooking: vi.fn(), updateBookingStatus: vi.fn(), deleteBooking: vi.fn(),
  createBookingPayment: vi.fn(), updateBookingPayment: vi.fn(), deleteBookingPayment: vi.fn(),
  updateArtistDefaultCommission: vi.fn(), refresh: vi.fn(), push: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push, back: vi.fn() }) }))
vi.mock("@/lib/actions/bookings", () => ({
  updateBooking: mocks.updateBooking, updateBookingStatus: mocks.updateBookingStatus, deleteBooking: mocks.deleteBooking,
}))
vi.mock("@/lib/actions/booking-payments", () => ({
  createBookingPayment: mocks.createBookingPayment, updateBookingPayment: mocks.updateBookingPayment,
  deleteBookingPayment: mocks.deleteBookingPayment,
}))
vi.mock("@/lib/actions/artists", () => ({ updateArtistDefaultCommission: mocks.updateArtistDefaultCommission }))
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client"
import { ArtistDefaultCommission } from "@/app/dashboard/artists/[id]/artist-default-commission"
import type { BookingWithArtist } from "@/lib/actions/bookings"
import type { BookingPayment } from "@/lib/booking-finance"

const TODAY = "2026-11-23"
const base: BookingWithArtist = {
  fee_amount_minor: 100000, fee_currency: "EUR", hold_expires_on: null,
  commission_type: null, commission_value: null, commission_mode: null, tax_note: null,
  id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-12-12", start_time: "19:00:00",
  venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
  duration_minutes: 60, notes: null, status: "confirmed", created_at: "2026-01-02", updated_at: "",
  artist: { id: "artist-a", stage_name: "DJ Moon", name: "Luna", surname: null, location: null, fee: null, currency: "EUR", profile_image_url: null },
}
const deposit: BookingPayment = { id: "pay-1", booking_id: "booking-a", kind: "deposit", amount_minor: 30000, currency: "EUR", due_on: "2026-11-01", paid_on: "2026-11-02", note: "bank transfer" }
const balance: BookingPayment = { id: "pay-2", booking_id: "booking-a", kind: "balance", amount_minor: 70000, currency: "EUR", due_on: "2026-11-20", paid_on: null, note: null }
const later: BookingPayment = { id: "pay-3", booking_id: "booking-a", kind: "other", amount_minor: 500, currency: "EUR", due_on: "2026-12-30", paid_on: null, note: null }

async function open(overrides: Partial<BookingWithArtist> = {}, payments: readonly BookingPayment[] | null = [], today: string | undefined = TODAY) {
  render(<EventBookingClient booking={{ ...base, ...overrides }} artistBookings={[]} today={today} payments={payments} />)
  const tab = screen.getByRole("tab", { name: "Financial" })
  tab.focus()
  fireEvent.keyDown(screen.getByRole("tab", { name: "Performance" }), { key: "ArrowRight" })
  await waitFor(() => expect(screen.getByRole("tab", { name: "Financial", selected: true })).toBeTruthy())
  return within(screen.getByRole("tabpanel", { name: "Financial" }))
}
const totals = () => {
  const section = screen.getByRole("region", { name: "Totals" })
  return Object.fromEntries([...section.querySelectorAll("dt")].map(term => [term.textContent, term.nextElementSibling?.textContent]))
}
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update booking" })) }) }
const click = async (name: string | RegExp, scope = screen) => { await act(async () => { fireEvent.click(scope.getByRole("button", { name })) }) }

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of [mocks.updateBooking, mocks.deleteBooking, mocks.createBookingPayment, mocks.updateBookingPayment, mocks.deleteBookingPayment, mocks.updateArtistDefaultCommission]) {
    action.mockResolvedValue({ success: true })
  }
})
afterEach(cleanup)

// --- totals ---
it("shows the five derived totals from saved values, with a percentage commission on top", async () => {
  await open({ commission_type: "percent", commission_value: 1500, commission_mode: "on_top" }, [deposit, balance])
  expect(totals()).toEqual({
    "Booking fee": "EUR 1,000.00", "Agency commission": "EUR 150.00", "Promoter total": "EUR 1,150.00",
    "Paid": "EUR 300.00", "Outstanding": "EUR 850.00", "Artist net": "EUR 1,000.00",
  })
  expect(within(screen.getByRole("region", { name: "Totals" })).getByText("15%, on top of the fee")).toBeTruthy()
})
it("deducts an included commission from the artist net, not from the promoter total", async () => {
  await open({ commission_type: "fixed", commission_value: 20000, commission_mode: "included" }, [deposit])
  expect(totals()).toMatchObject({ "Agency commission": "EUR 200.00", "Promoter total": "EUR 1,000.00", "Outstanding": "EUR 700.00", "Artist net": "EUR 800.00" })
  expect(screen.getByText("EUR 200.00, included in the fee")).toBeTruthy()
})
it("shows JPY totals as whole yen and rounds the commission half up", async () => {
  await open({ fee_amount_minor: 33333, fee_currency: "JPY", commission_type: "percent", commission_value: 1500, commission_mode: "on_top" },
    [{ ...deposit, amount_minor: 10000, currency: "JPY" }])
  expect(totals()).toEqual({
    "Booking fee": "JPY 33,333", "Agency commission": "JPY 5,000", "Promoter total": "JPY 38,333",
    "Paid": "JPY 10,000", "Outstanding": "JPY 28,333", "Artist net": "JPY 33,333",
  })
})
it("labels an overpayment instead of showing a negative outstanding amount", async () => {
  await open({}, [{ ...deposit, amount_minor: 120000 }])
  expect(totals()).toMatchObject({ "Overpaid": "EUR 200.00" })
  expect(totals()).not.toHaveProperty("Outstanding")
})
it("offers no totals and no payment entry without a saved fee", async () => {
  const panel = await open({ fee_amount_minor: null, fee_currency: null })
  expect(panel.getByText("Set and save a booking fee to see totals and record payments.")).toBeTruthy()
  expect(panel.getByText("Set and save a booking fee before recording payments.")).toBeTruthy()
  expect(panel.queryByRole("button", { name: "Add payment" })).toBeNull()
})
it("reports a failed payments read as an error with a retry, never as an empty list", async () => {
  const panel = await open({}, null)
  expect(panel.getByRole("alert").textContent).toBe("Payments could not be loaded, so totals are not shown.")
  expect(panel.queryByText("No payments recorded.")).toBeNull()
  expect(panel.queryByRole("button", { name: "Add payment" })).toBeNull()
  await click("Retry loading payments")
  expect(mocks.refresh).toHaveBeenCalledOnce()
})

// --- payments list ---
it("lists payments with kind, amount, dates, note and a derived paid / overdue / not paid state", async () => {
  await open({}, [deposit, balance, later])
  const rows = within(screen.getByRole("list", { name: "Recorded payments" })).getAllByRole("listitem").map(item => item.textContent)
  expect(rows[0]).toContain("Deposit EUR 300.00")
  expect(rows[0]).toContain("Paid")
  expect(rows[0]).toContain("Due 2026-11-01 · Paid on 2026-11-02")
  expect(rows[0]).toContain("bank transfer")
  expect(rows[1]).toContain("Balance EUR 700.00")
  expect(rows[1]).toContain("Overdue")
  expect(rows[2]).toContain("Other EUR 5.00")
  expect(rows[2]).toContain("Not paid")
})
it("says so when no payment is recorded", async () => {
  const panel = await open()
  expect(panel.getByText("No payments recorded.")).toBeTruthy()
  expect(panel.queryByRole("list", { name: "Recorded payments" })).toBeNull()
})
it("marks a payment as paid today with the server date and refreshes", async () => {
  await open({}, [balance])
  await click("Mark Balance EUR 700.00 as paid today")
  expect(mocks.updateBookingPayment).toHaveBeenCalledExactlyOnceWith("pay-2", { paid_on: TODAY })
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(within(screen.getByRole("region", { name: "Payments" })).getByRole("status").textContent).toBe("Payment marked as paid.")
  expect(mocks.updateBooking).not.toHaveBeenCalled()
})
it("unmarks a paid payment with an explicit null", async () => {
  await open({}, [deposit])
  await click("Mark Deposit EUR 300.00 as not paid")
  expect(mocks.updateBookingPayment).toHaveBeenCalledExactlyOnceWith("pay-1", { paid_on: null })
})
it("offers no one-click paid date and no overdue flag when the server date is unknown", async () => {
  render(<EventBookingClient booking={base} payments={[balance]} />)
  fireEvent.keyDown(screen.getByRole("tab", { name: "Performance" }), { key: "ArrowRight" })
  await waitFor(() => expect(screen.getByRole("tabpanel", { name: "Financial" })).toBeTruthy())
  expect(screen.queryByRole("button", { name: /as paid today/ })).toBeNull()
  expect(screen.queryByText("Overdue")).toBeNull()
  expect(screen.getByText("Not paid")).toBeTruthy()
})

// --- payment editor ---
it("adds a payment in the fee currency, in minor units", async () => {
  const panel = await open()
  await click("Add payment")
  const form = within(panel.getByRole("group", { name: "New payment" }))
  fireEvent.change(form.getByLabelText("Payment type"), { target: { value: "balance" } })
  fireEvent.change(form.getByLabelText("Payment amount (EUR)"), { target: { value: "700,50" } })
  fireEvent.change(form.getByLabelText("Due date (optional)"), { target: { value: "2026-12-01" } })
  fireEvent.change(form.getByLabelText("Payment note (optional)"), { target: { value: "after the show" } })
  await click("Save new payment")
  expect(mocks.createBookingPayment).toHaveBeenCalledExactlyOnceWith("booking-a", {
    kind: "balance", amount_minor: 70050, currency: "EUR", due_on: "2026-12-01", paid_on: null, note: "after the show",
  })
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(panel.queryByRole("group", { name: "New payment" })).toBeNull()
  expect(within(screen.getByRole("region", { name: "Payments" })).getByRole("status").textContent).toBe("Payment added.")
})
it("adds a JPY payment as whole yen and refuses decimals", async () => {
  const panel = await open({ fee_amount_minor: 500000, fee_currency: "JPY" })
  await click("Add payment")
  fireEvent.change(panel.getByLabelText("Payment amount (JPY)"), { target: { value: "1500.5" } })
  await click("Save new payment")
  expect(panel.getByRole("alert").textContent).toBe("Enter a whole-number JPY payment amount without separators")
  expect(mocks.createBookingPayment).not.toHaveBeenCalled()
  fireEvent.change(panel.getByLabelText("Payment amount (JPY)"), { target: { value: "150000" } })
  await click("Save new payment")
  expect(mocks.createBookingPayment).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({ amount_minor: 150000, currency: "JPY" }))
})
it.each([["", "Enter a payment amount with at most two decimals and no grouping separators"], ["0", "Enter a payment amount greater than zero"], ["1,000.00", "Enter a payment amount with at most two decimals and no grouping separators"], ["12.345", "Enter a payment amount with at most two decimals and no grouping separators"]])(
  "keeps the draft and names the problem for the amount %j", async (amount, error) => {
    const panel = await open()
    await click("Add payment")
    fireEvent.change(panel.getByLabelText("Payment amount (EUR)"), { target: { value: amount } })
    fireEvent.change(panel.getByLabelText("Payment note (optional)"), { target: { value: "draft note" } })
    await click("Save new payment")
    expect(panel.getByRole("alert").textContent).toBe(error)
    expect(mocks.createBookingPayment).not.toHaveBeenCalled()
    expect((panel.getByLabelText("Payment note (optional)") as HTMLInputElement).value).toBe("draft note")
  })
it("shows the action's fixed copy, keeps the draft open and does not refresh on failure", async () => {
  mocks.createBookingPayment.mockResolvedValue({ success: false, error: "A payment must be in the booking fee currency." })
  const panel = await open()
  await click("Add payment")
  fireEvent.change(panel.getByLabelText("Payment amount (EUR)"), { target: { value: "10" } })
  await click("Save new payment")
  expect(panel.getByRole("alert").textContent).toBe("A payment must be in the booking fee currency.")
  expect(panel.getByRole("group", { name: "New payment" })).toBeTruthy()
  expect(mocks.refresh).not.toHaveBeenCalled()
})
it("does not claim success when the action throws", async () => {
  mocks.createBookingPayment.mockRejectedValue(new Error("network"))
  const panel = await open()
  await click("Add payment")
  fireEvent.change(panel.getByLabelText("Payment amount (EUR)"), { target: { value: "10" } })
  await click("Save new payment")
  expect(panel.getByRole("alert").textContent).toBe("Unable to confirm the change. Reload the booking before retrying.")
  expect(mocks.refresh).not.toHaveBeenCalled()
})
it("ignores a second submit while the first is in flight", async () => {
  let finish: (value: { success: boolean }) => void = () => {}
  mocks.createBookingPayment.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const panel = await open()
  await click("Add payment")
  fireEvent.change(panel.getByLabelText("Payment amount (EUR)"), { target: { value: "10" } })
  await click("Save new payment")
  await click("Saving...")
  expect(mocks.createBookingPayment).toHaveBeenCalledOnce()
  await act(async () => { finish({ success: true }) })
  expect(mocks.refresh).toHaveBeenCalledOnce()
})
const goToTab = async (name: string) => {
  act(() => screen.getByRole("tab", { name }).focus())
  await waitFor(() => expect(screen.getByRole("tab", { name, selected: true })).toBeTruthy())
}
it("keeps an unsaved payment draft, its error and the open editor across booking tabs", async () => {
  await open({}, [deposit])
  await click("Add payment")
  fireEvent.change(screen.getByLabelText("Payment type"), { target: { value: "balance" } })
  fireEvent.change(screen.getByLabelText("Payment amount (EUR)"), { target: { value: "12.345" } })
  fireEvent.change(screen.getByLabelText("Payment note (optional)"), { target: { value: "draft note" } })
  await click("Save new payment")
  await goToTab("Performance")
  expect(screen.queryByLabelText("Payment amount (EUR)")).toBeNull()
  await goToTab("Financial")
  const form = within(screen.getByRole("group", { name: "New payment" }))
  expect((form.getByLabelText("Payment type") as HTMLSelectElement).value).toBe("balance")
  expect((form.getByLabelText("Payment amount (EUR)") as HTMLInputElement).value).toBe("12.345")
  expect((form.getByLabelText("Payment note (optional)") as HTMLInputElement).value).toBe("draft note")
  expect(within(screen.getByRole("region", { name: "Payments" })).getByRole("alert").textContent)
    .toBe("Enter a payment amount with at most two decimals and no grouping separators")
  expect(mocks.createBookingPayment).not.toHaveBeenCalled()
})
it("keeps an edit draft across booking tabs and still saves it as an update", async () => {
  await open({}, [deposit])
  await click("Edit Deposit EUR 300.00")
  fireEvent.change(screen.getByLabelText("Payment amount (EUR)"), { target: { value: "350" } })
  await goToTab("Travel")
  await goToTab("Financial")
  expect((within(screen.getByRole("group", { name: "Edit payment" })).getByLabelText("Payment amount (EUR)") as HTMLInputElement).value).toBe("350")
  await click("Save payment")
  expect(mocks.updateBookingPayment).toHaveBeenCalledExactlyOnceWith("pay-1", expect.objectContaining({ amount_minor: 35000 }))
})
it("locks the payment editor while a save is pending, so its completion cannot close another editor", async () => {
  let finish: (value: { success: boolean; error?: string }) => void = () => {}
  mocks.createBookingPayment.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await open({}, [deposit])
  await click("Add payment")
  fireEvent.change(screen.getByLabelText("Payment amount (EUR)"), { target: { value: "10" } })
  await click("Save new payment")
  // Cancel, Edit and Delete cannot replace or close the editor that submitted.
  for (const name of ["Cancel", "Edit Deposit EUR 300.00", "Delete Deposit EUR 300.00"]) {
    expect(screen.getByRole("button", { name }).getAttribute("aria-disabled")).toBe("true")
    await click(name)
  }
  const form = within(screen.getByRole("group", { name: "New payment" }))
  expect((form.getByLabelText("Payment amount (EUR)") as HTMLInputElement).value).toBe("10")
  expect((form.getByLabelText("Payment amount (EUR)") as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByRole("group", { name: "Edit payment" })).toBeNull()
  expect(screen.queryByText("Delete this payment?")).toBeNull()
  // A tab round trip during the request neither unlocks the editor nor allows a second submit.
  await goToTab("Performance")
  await goToTab("Financial")
  await click("Saving...")
  expect(mocks.createBookingPayment).toHaveBeenCalledOnce()
  expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-disabled")).toBe("true")
  await act(async () => { finish({ success: false, error: "Unable to save the payment. Please try again." }) })
  // The failure lands on the editor that submitted it, which is still open with its draft.
  expect(within(screen.getByRole("region", { name: "Payments" })).getByRole("alert").textContent).toBe("Unable to save the payment. Please try again.")
  expect((screen.getByLabelText("Payment amount (EUR)") as HTMLInputElement).value).toBe("10")
  expect((screen.getByLabelText("Payment amount (EUR)") as HTMLInputElement).disabled).toBe(false)
  expect(mocks.refresh).not.toHaveBeenCalled()
  await click("Cancel")
  expect(screen.queryByRole("group", { name: "New payment" })).toBeNull()
})
it("reports a save that completes while another tab is open when the user returns", async () => {
  let finish: (value: { success: boolean }) => void = () => {}
  mocks.createBookingPayment.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await open()
  await click("Add payment")
  fireEvent.change(screen.getByLabelText("Payment amount (EUR)"), { target: { value: "10" } })
  await click("Save new payment")
  await goToTab("Performance")
  await act(async () => { finish({ success: true }) })
  expect(mocks.refresh).toHaveBeenCalledOnce()
  await goToTab("Financial")
  expect(screen.queryByRole("group", { name: "New payment" })).toBeNull()
  expect(within(screen.getByRole("region", { name: "Payments" })).getByRole("status").textContent).toBe("Payment added.")
  expect(screen.getByRole("button", { name: "Add payment" }).getAttribute("aria-disabled")).toBe("false")
})
it("edits a payment from its stored values without sending a currency", async () => {
  const panel = await open({}, [deposit])
  await click("Edit Deposit EUR 300.00")
  const form = within(panel.getByRole("group", { name: "Edit payment" }))
  expect((form.getByLabelText("Payment amount (EUR)") as HTMLInputElement).value).toBe("300.00")
  expect((form.getByLabelText("Paid date (leave empty if not paid)") as HTMLInputElement).value).toBe("2026-11-02")
  fireEvent.change(form.getByLabelText("Payment amount (EUR)"), { target: { value: "350" } })
  fireEvent.change(form.getByLabelText("Paid date (leave empty if not paid)"), { target: { value: "" } })
  await click("Save payment")
  expect(mocks.updateBookingPayment).toHaveBeenCalledExactlyOnceWith("pay-1", {
    kind: "deposit", amount_minor: 35000, due_on: "2026-11-01", paid_on: null, note: "bank transfer",
  })
  expect(mocks.createBookingPayment).not.toHaveBeenCalled()
})
it("offers no paid shortcut for the payment open in the editor, so a stale draft cannot undo it", async () => {
  await open({}, [balance, deposit])
  await click("Edit Balance EUR 700.00")
  expect(screen.queryByRole("button", { name: "Mark Balance EUR 700.00 as paid today" })).toBeNull()
  expect(screen.getByText("Open in the editor below")).toBeTruthy()
  // Other payments keep their shortcut; the edited one gets it back when the editor closes.
  expect(screen.getByRole("button", { name: "Mark Deposit EUR 300.00 as not paid" })).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Paid date (leave empty if not paid)"), { target: { value: "2026-11-22" } })
  await click("Save payment")
  expect(mocks.updateBookingPayment).toHaveBeenCalledExactlyOnceWith("pay-2", expect.objectContaining({ paid_on: "2026-11-22" }))
  expect(screen.getByRole("button", { name: "Mark Balance EUR 700.00 as paid today" })).toBeTruthy()
  expect(screen.queryByText("Open in the editor below")).toBeNull()
})
it("deletes a payment only after an explicit confirmation", async () => {
  await open({}, [deposit])
  await click("Delete Deposit EUR 300.00")
  expect(mocks.deleteBookingPayment).not.toHaveBeenCalled()
  expect(screen.getByText("Delete this payment?")).toBeTruthy()
  await click("Keep")
  expect(screen.queryByText("Delete this payment?")).toBeNull()
  await click("Delete Deposit EUR 300.00")
  await click("Yes, delete")
  expect(mocks.deleteBookingPayment).toHaveBeenCalledExactlyOnceWith("pay-1")
  expect(mocks.refresh).toHaveBeenCalledOnce()
})
it("shows the fixed copy when a payment delete fails", async () => {
  mocks.deleteBookingPayment.mockResolvedValue({ success: false, error: "Payment not found" })
  await open({}, [deposit])
  await click("Delete Deposit EUR 300.00")
  await click("Yes, delete")
  expect(within(screen.getByRole("region", { name: "Payments" })).getByRole("alert").textContent).toBe("Payment not found")
  expect(mocks.refresh).not.toHaveBeenCalled()
})

// --- fee currency lock and booking delete ---
it("locks the fee currency while payments exist and still saves a new fee amount", async () => {
  const panel = await open({}, [deposit])
  expect((panel.getByLabelText("Booking fee currency") as HTMLSelectElement).disabled).toBe(true)
  expect(panel.getByText("Payments are recorded for this booking: the fee amount can change, the fee currency cannot.")).toBeTruthy()
  fireEvent.change(panel.getByLabelText("Booking fee amount"), { target: { value: "1200" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({ fee_amount_minor: 120000, fee_currency: "EUR" }))
})
it("keeps the fee currency editable without payments", async () => {
  const panel = await open()
  expect((panel.getByLabelText("Booking fee currency") as HTMLSelectElement).disabled).toBe(false)
})
it("explains that a booking with payments cannot be deleted, with the fixed copy only", async () => {
  mocks.deleteBooking.mockResolvedValue({ success: false, error: "This booking has recorded payments and cannot be deleted. Remove its payments first, or cancel the booking instead." })
  await open({}, [deposit])
  await click("Delete")
  await click("Yes, delete")
  expect(screen.getByText("This booking has recorded payments and cannot be deleted. Remove its payments first, or cancel the booking instead.")).toBeTruthy()
  expect(mocks.push).not.toHaveBeenCalled()
  cleanup()
  mocks.deleteBooking.mockResolvedValue({ success: false, error: "some other provider text" })
  await open()
  await click("Delete")
  await click("Yes, delete")
  expect(screen.getByText("Unable to delete booking. Please try again.")).toBeTruthy()
  expect(screen.queryByText("some other provider text")).toBeNull()
})

// --- commission and tax note ---
it("sends neither commission nor tax note when they were not edited", async () => {
  await open({ commission_type: "percent", commission_value: 1500, commission_mode: "on_top", tax_note: "VAT" })
  await save()
  const patch = mocks.updateBooking.mock.calls[0][1]
  for (const field of ["commission_type", "commission_value", "commission_mode", "tax_note", "fee_amount_minor"]) expect(patch).not.toHaveProperty(field)
})
it("saves a percentage commission in basis points with its mode", async () => {
  const panel = await open()
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: "percent" } })
  fireEvent.change(panel.getByLabelText("Commission percentage (%)"), { target: { value: "12.5" } })
  fireEvent.change(panel.getByLabelText("Commission mode"), { target: { value: "included" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({
    commission_type: "percent", commission_value: 1250, commission_mode: "included",
  }))
})
it("starts a new commission as on top and saves a fixed amount in the fee currency", async () => {
  const panel = await open()
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: "fixed" } })
  expect((panel.getByLabelText("Commission mode") as HTMLSelectElement).value).toBe("on_top")
  fireEvent.change(panel.getByLabelText("Commission amount (EUR)"), { target: { value: "250" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({
    commission_type: "fixed", commission_value: 25000, commission_mode: "on_top",
  }))
})
it("shows the stored commission and clears all three fields together", async () => {
  const panel = await open({ commission_type: "percent", commission_value: 1505, commission_mode: "included" })
  expect((panel.getByLabelText("Commission percentage (%)") as HTMLInputElement).value).toBe("15.05")
  expect((panel.getByLabelText("Commission mode") as HTMLSelectElement).value).toBe("included")
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: "" } })
  expect(panel.queryByLabelText("Commission mode")).toBeNull()
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({
    commission_type: null, commission_value: null, commission_mode: null,
  }))
})
it.each([
  ["percent", "Commission percentage (%)", "101", "Enter a commission percentage between 0 and 100 with at most two decimals"],
  ["percent", "Commission percentage (%)", "12.345", "Enter a commission percentage between 0 and 100 with at most two decimals"],
  ["fixed", "Commission amount (EUR)", "abc", "Enter a commission amount with at most two decimals and no grouping separators"],
])("blocks the save and names the problem for a %s commission of %s %s", async (type, label, value, error) => {
  const panel = await open()
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: type } })
  fireEvent.change(panel.getByLabelText(label), { target: { value } })
  await save()
  expect(panel.getByText(error).getAttribute("role")).toBe("alert")
  expect(mocks.updateBooking).not.toHaveBeenCalled()
})
it("refuses an included fixed commission above the fee being saved", async () => {
  const panel = await open()
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: "fixed" } })
  fireEvent.change(panel.getByLabelText("Commission amount (EUR)"), { target: { value: "1000.01" } })
  fireEvent.change(panel.getByLabelText("Commission mode"), { target: { value: "included" } })
  await save()
  expect(panel.getByText("A fixed commission included in the fee cannot be greater than the fee")).toBeTruthy()
  expect(mocks.updateBooking).not.toHaveBeenCalled()
  fireEvent.change(panel.getByLabelText("Commission mode"), { target: { value: "on_top" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledOnce()
})
it("needs a fee currency before a fixed commission can be saved", async () => {
  const panel = await open({ fee_amount_minor: null, fee_currency: null })
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: "fixed" } })
  fireEvent.change(panel.getByLabelText("Commission amount (fee currency)"), { target: { value: "250" } })
  await save()
  expect(panel.getByText("Choose a booking fee currency before entering a fixed commission")).toBeTruthy()
  expect(mocks.updateBooking).not.toHaveBeenCalled()
})
it("re-reads a fixed commission in the new fee currency when the currency changes", async () => {
  const panel = await open({ commission_type: "fixed", commission_value: 25000, commission_mode: "on_top" })
  expect((panel.getByLabelText("Commission amount (EUR)") as HTMLInputElement).value).toBe("250.00")
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "JPY" } })
  fireEvent.change(panel.getByLabelText("Booking fee amount"), { target: { value: "150000" } })
  await save()
  expect(panel.getByText("Enter a whole-number JPY commission amount without separators")).toBeTruthy()
  expect(mocks.updateBooking).not.toHaveBeenCalled()
  fireEvent.change(panel.getByLabelText("Commission amount (JPY)"), { target: { value: "25000" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({
    fee_amount_minor: 150000, fee_currency: "JPY", commission_type: "fixed", commission_value: 25000, commission_mode: "on_top",
  }))
})
it("saves the tax note only when it changed and shows the stored one", async () => {
  const panel = await open({ tax_note: "VAT reverse charge" })
  const note = panel.getByLabelText("Tax note") as HTMLTextAreaElement
  expect(note.value).toBe("VAT reverse charge")
  expect(note.maxLength).toBe(2000)
  fireEvent.change(note, { target: { value: "Withholding tax 30%" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({ tax_note: "Withholding tax 30%" }))
  expect(panel.getByText("Free text, saved with Update booking. No tax is calculated from it.")).toBeTruthy()
})

// --- prefill from a fixed artist default (decision 12) ---
const eurDefault = { default_commission_type: "fixed", default_commission_value: 25000, default_commission_mode: "included", default_commission_currency: "EUR" }
const jpyDefault = { default_commission_type: "fixed", default_commission_value: 30000, default_commission_mode: "on_top", default_commission_currency: "JPY" }
const newBooking = (artistDefault: Record<string, unknown>) =>
  ({ fee_amount_minor: null, fee_currency: null, artist: { ...base.artist, ...artistDefault } })
const MATCH = /^Prefilled from the artist's default commission/
const MISMATCH = /is not prefilled: it is in/
it("prefills a fixed default when the new booking's fee is in the default currency, and saves it with the fee", async () => {
  const panel = await open(newBooking(eurDefault))
  expect(panel.queryByLabelText("Commission mode")).toBeNull()
  expect(panel.queryByText(MATCH)).toBeNull()
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  expect((panel.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("fixed")
  expect((panel.getByLabelText("Commission amount (EUR)") as HTMLInputElement).value).toBe("250.00")
  expect((panel.getByLabelText("Commission mode") as HTMLSelectElement).value).toBe("included")
  expect(panel.getByText("Prefilled from the artist's default commission (EUR 250.00, included in the fee). Saved with Update booking.")).toBeTruthy()
  fireEvent.change(panel.getByLabelText("Booking fee amount"), { target: { value: "1000" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({
    fee_amount_minor: 100000, fee_currency: "EUR", commission_type: "fixed", commission_value: 25000, commission_mode: "included",
  }))
})
it("prefills nothing and says so neutrally when the fee currency differs from the default currency", async () => {
  const panel = await open(newBooking(eurDefault))
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "JPY" } })
  expect((panel.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("")
  const notice = panel.getByText("The artist's default commission (EUR 250.00, included in the fee) is not prefilled: it is in EUR and this booking's fee is in JPY.")
  expect(notice.getAttribute("role")).toBeNull()
  expect(notice.className).not.toContain("destructive")
  fireEvent.change(panel.getByLabelText("Booking fee amount"), { target: { value: "150000" } })
  await save()
  const patch = mocks.updateBooking.mock.calls[0][1]
  expect(patch).toMatchObject({ fee_amount_minor: 150000, fee_currency: "JPY" })
  for (const field of ["commission_type", "commission_value", "commission_mode"]) expect(patch).not.toHaveProperty(field)
})
it("prefills a JPY default as whole yen on a JPY booking and nothing on a EUR booking", async () => {
  const panel = await open(newBooking(jpyDefault))
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  expect((panel.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("")
  expect(panel.getByText("The artist's default commission (JPY 30,000, on top of the fee) is not prefilled: it is in JPY and this booking's fee is in EUR.")).toBeTruthy()
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "JPY" } })
  expect((panel.getByLabelText("Commission amount (JPY)") as HTMLInputElement).value).toBe("30000")
  expect((panel.getByLabelText("Commission mode") as HTMLSelectElement).value).toBe("on_top")
  expect(panel.queryByText(MISMATCH)).toBeNull()
  fireEvent.change(panel.getByLabelText("Booking fee amount"), { target: { value: "500000" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({
    fee_amount_minor: 500000, fee_currency: "JPY", commission_type: "fixed", commission_value: 30000, commission_mode: "on_top",
  }))
})
it("withdraws an untouched prefill when the fee moves to another currency, but keeps a commission the user edited", async () => {
  const panel = await open(newBooking(eurDefault))
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "USD" } })
  expect((panel.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("")
  expect(panel.getByText(MISMATCH)).toBeTruthy()
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  fireEvent.change(panel.getByLabelText("Commission amount (EUR)"), { target: { value: "300" } })
  expect(panel.queryByText(MATCH)).toBeNull()
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "USD" } })
  expect((panel.getByLabelText("Commission amount (USD)") as HTMLInputElement).value).toBe("300")
  expect(panel.queryByText(MISMATCH)).toBeNull()
})
it("does not overwrite a commission the user already entered on the new booking", async () => {
  const panel = await open(newBooking(eurDefault))
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: "percent" } })
  fireEvent.change(panel.getByLabelText("Commission percentage (%)"), { target: { value: "10" } })
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  expect((panel.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("percent")
  expect(panel.queryByText(MATCH)).toBeNull()
})
it("never prefills a booking that already has a saved fee or a saved commission", async () => {
  const withFee = await open({ artist: { ...base.artist, ...eurDefault } })
  expect((withFee.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("")
  expect(withFee.queryByText(MATCH)).toBeNull()
  expect(withFee.queryByText(MISMATCH)).toBeNull()
  fireEvent.change(withFee.getByLabelText("Booking fee currency"), { target: { value: "USD" } })
  fireEvent.change(withFee.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  expect((withFee.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("")
  cleanup()
  const withCommission = await open({ fee_amount_minor: 500000, fee_currency: "JPY", commission_type: "percent", commission_value: 1000, commission_mode: "on_top", artist: { ...base.artist, ...eurDefault } })
  expect((withCommission.getByLabelText("Commission percentage (%)") as HTMLInputElement).value).toBe("10")
  expect(withCommission.queryByText(MISMATCH)).toBeNull()
})
it("offers the prefill by the booking's current state: saved again without a fee, it is offered again, visibly and editable", async () => {
  // No column records that the default was already offered (docs/booking-finance.md, Known behaviour).
  const panel = await open({ ...newBooking(eurDefault), updated_at: "2026-11-23T10:00:00Z", notes: "fee and commission were removed earlier" })
  fireEvent.change(panel.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  expect(panel.getByText(MATCH)).toBeTruthy()
  // The user can decline it before saving: nothing about a commission is then sent.
  fireEvent.change(panel.getByLabelText("Commission type"), { target: { value: "" } })
  expect(panel.queryByText(MATCH)).toBeNull()
  fireEvent.change(panel.getByLabelText("Booking fee amount"), { target: { value: "1000" } })
  await save()
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith("booking-a", expect.objectContaining({
    fee_amount_minor: 100000, fee_currency: "EUR", commission_type: null, commission_value: null, commission_mode: null,
  }))
})
it("shows the mismatch notice on a saved booking in another currency that has no commission", async () => {
  const panel = await open({ fee_amount_minor: 500000, fee_currency: "JPY", artist: { ...base.artist, ...eurDefault } })
  expect(panel.getByText(MISMATCH)).toBeTruthy()
  expect((panel.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("")
})
it("shows no default notice for a percent default or for an artist without a default", async () => {
  const percent = await open(newBooking({ default_commission_type: "percent", default_commission_value: 1250, default_commission_mode: "on_top", default_commission_currency: null }))
  fireEvent.change(percent.getByLabelText("Booking fee currency"), { target: { value: "JPY" } })
  expect(percent.queryByText(MATCH)).toBeNull()
  expect(percent.queryByText(MISMATCH)).toBeNull()
  expect((percent.getByLabelText("Commission type") as HTMLSelectElement).value).toBe("")
  cleanup()
  const none = await open(newBooking({}))
  fireEvent.change(none.getByLabelText("Booking fee currency"), { target: { value: "EUR" } })
  expect(none.queryByText(MATCH)).toBeNull()
  expect(none.queryByText(MISMATCH)).toBeNull()
})

// --- artist default commission (decisions 12 and 13) ---
const artistSection = () => within(screen.getByRole("region", { name: "Default agency commission" }))
it("artist profile: sets a percentage default with its mode and no currency", async () => {
  render(<ArtistDefaultCommission artistId="artist-a" type={null} value={null} mode={null} currency={null} />)
  expect(artistSection().getByText("Not specified")).toBeTruthy()
  await click("Set default commission")
  fireEvent.change(artistSection().getByLabelText("Default commission type"), { target: { value: "percent" } })
  expect(artistSection().queryByLabelText("Default commission currency")).toBeNull()
  expect((artistSection().getByLabelText("Default commission mode") as HTMLSelectElement).value).toBe("on_top")
  fireEvent.change(artistSection().getByLabelText("Default commission percentage (%)"), { target: { value: "15" } })
  fireEvent.change(artistSection().getByLabelText("Default commission mode"), { target: { value: "included" } })
  await click("Save default commission")
  expect(mocks.updateArtistDefaultCommission).toHaveBeenCalledExactlyOnceWith("artist-a", { type: "percent", value: 1500, mode: "included", currency: null })
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(artistSection().getByRole("status").textContent).toBe("Default commission saved.")
})
it("artist profile: a fixed default gets its own currency, EUR preselected, entered in that currency's minor units", async () => {
  render(<ArtistDefaultCommission artistId="artist-a" />)
  await click("Set default commission")
  fireEvent.change(artistSection().getByLabelText("Default commission type"), { target: { value: "fixed" } })
  const currency = artistSection().getByLabelText("Default commission currency") as HTMLSelectElement
  expect(currency.value).toBe("EUR")
  expect([...currency.options].map(option => option.value)).toEqual(["EUR", "USD", "GBP", "JPY"])
  fireEvent.change(artistSection().getByLabelText("Default commission amount (EUR)"), { target: { value: "300.5" } })
  await click("Save default commission")
  expect(mocks.updateArtistDefaultCommission).toHaveBeenCalledExactlyOnceWith("artist-a", { type: "fixed", value: 30050, mode: "on_top", currency: "EUR" })
})
it("artist profile: a JPY fixed default takes whole yen only", async () => {
  render(<ArtistDefaultCommission artistId="artist-a" />)
  await click("Set default commission")
  fireEvent.change(artistSection().getByLabelText("Default commission type"), { target: { value: "fixed" } })
  fireEvent.change(artistSection().getByLabelText("Default commission currency"), { target: { value: "JPY" } })
  fireEvent.change(artistSection().getByLabelText("Default commission amount (JPY)"), { target: { value: "300.50" } })
  await click("Save default commission")
  expect(artistSection().getByRole("alert").textContent).toBe("Enter a whole-number JPY commission amount without separators")
  expect(mocks.updateArtistDefaultCommission).not.toHaveBeenCalled()
  fireEvent.change(artistSection().getByLabelText("Default commission amount (JPY)"), { target: { value: "30000" } })
  fireEvent.change(artistSection().getByLabelText("Default commission mode"), { target: { value: "included" } })
  await click("Save default commission")
  expect(mocks.updateArtistDefaultCommission).toHaveBeenCalledExactlyOnceWith("artist-a", { type: "fixed", value: 30000, mode: "included", currency: "JPY" })
})
it("artist profile: shows and edits a stored fixed default in its own currency", async () => {
  render(<ArtistDefaultCommission artistId="artist-a" type="fixed" value={30000} mode="included" currency="JPY" />)
  expect(artistSection().getByText("JPY 30,000, included in the fee")).toBeTruthy()
  expect(artistSection().getByText(/A fixed amount is prefilled only on bookings whose fee is in the same currency; nothing is converted\./)).toBeTruthy()
  await click("Edit default commission")
  expect((artistSection().getByLabelText("Default commission currency") as HTMLSelectElement).value).toBe("JPY")
  expect((artistSection().getByLabelText("Default commission amount (JPY)") as HTMLInputElement).value).toBe("30000")
  expect((artistSection().getByLabelText("Default commission mode") as HTMLSelectElement).value).toBe("included")
  cleanup()
  render(<ArtistDefaultCommission artistId="artist-a" type="fixed" value={25000} mode="on_top" currency="EUR" />)
  expect(artistSection().getByText("EUR 250.00, on top of the fee")).toBeTruthy()
  await click("Edit default commission")
  expect((artistSection().getByLabelText("Default commission amount (EUR)") as HTMLInputElement).value).toBe("250.00")
})
it("artist profile: treats an inconsistent stored default as not specified", () => {
  render(<ArtistDefaultCommission artistId="artist-a" type="fixed" value={25000} mode="on_top" currency={null} />)
  expect(artistSection().getByText("Not specified")).toBeTruthy()
})
it("artist profile: shows a percentage default, clears it, and reports failures with fixed copy", async () => {
  render(<ArtistDefaultCommission artistId="artist-a" type="percent" value={1250} mode="on_top" currency={null} />)
  expect(artistSection().getByText("12.5%, on top of the fee")).toBeTruthy()
  await click("Edit default commission")
  fireEvent.change(artistSection().getByLabelText("Default commission percentage (%)"), { target: { value: "150" } })
  await click("Save default commission")
  expect(artistSection().getByRole("alert").textContent).toBe("Enter a commission percentage between 0 and 100 with at most two decimals")
  expect(mocks.updateArtistDefaultCommission).not.toHaveBeenCalled()
  fireEvent.change(artistSection().getByLabelText("Default commission type"), { target: { value: "" } })
  mocks.updateArtistDefaultCommission.mockResolvedValueOnce({ success: false, error: "Artist not found" })
  await click("Save default commission")
  expect(mocks.updateArtistDefaultCommission).toHaveBeenCalledExactlyOnceWith("artist-a", null)
  expect(artistSection().getByRole("alert").textContent).toBe("Artist not found")
  expect(mocks.refresh).not.toHaveBeenCalled()
})
