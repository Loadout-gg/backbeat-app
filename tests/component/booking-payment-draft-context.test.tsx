// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { BookingWithArtist } from "@/lib/actions/bookings";
import type { BookingPayment } from "@/lib/booking-finance";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: AuthChangeEvent, session: Session | null) => void>(),
  create: vi.fn(), updateBooking: vi.fn(), signOut: vi.fn(), subscribe: vi.fn(),
  router: { refresh: vi.fn(), push: vi.fn(), back: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
vi.mock("@/lib/actions/workspace", () => ({ signOut: mocks.signOut }));
vi.mock("@/lib/actions/bookings", () => ({ updateBooking: mocks.updateBooking, updateBookingStatus: vi.fn(), deleteBooking: vi.fn() }));
vi.mock("@/lib/actions/booking-payments", () => ({ createBookingPayment: mocks.create, updateBookingPayment: vi.fn(), voidBookingPayment: vi.fn() }));
import { EventBookingClient } from "@/app/dashboard/bookings/[id]/event-booking-client";
import { Header } from "@/components/dashboard/header";

const A = "member-A", B = "member-B";
const PRIVATE = "private unsaved member A note";
const booking: BookingWithArtist = {
  id: "booking-a", workspace_id: "workspace-a", artist_id: "artist-a", date: "2026-12-12", start_time: "19:00:00",
  fee_amount_minor: 100000, fee_currency: "EUR", hold_expires_on: null,
  commission_type: null, commission_value: null, commission_mode: null, tax_note: null,
  venue_name: null, venue_address: null, contact_name_main: null, contact_phone_main: null, contact_email_main: null,
  duration_minutes: 60, notes: null, status: "confirmed", created_at: "2026-01-02", updated_at: "",
  artist: { id: "artist-a", stage_name: "Fixture", name: "Fixture", surname: null, location: null, fee: null, currency: "EUR", profile_image_url: null },
};
const storageKey = `backbeat:payment-draft:${booking.id}`;
const rawDraft = () => window.sessionStorage.getItem(storageKey);
const payload = (note: string, currency = "EUR", amount_minor = 15000) => ({
  amount_minor, currency, note, kind: "deposit", due_on: null, paid_on: null,
});
let initialIdentity: string | null | undefined;
const session = (id: string | null) => id === null ? null : { user: { id } } as Session;
function emit(event: AuthChangeEvent, id: string | null) {
  initialIdentity = id;
  for (const listener of mocks.listeners) listener(event, session(id));
}
beforeEach(() => {
  window.sessionStorage.clear();
  vi.resetAllMocks();
  initialIdentity = A;
  mocks.create.mockResolvedValue({ success: true });
  mocks.updateBooking.mockResolvedValue({ success: true });
  mocks.subscribe.mockImplementation((listener: (event: AuthChangeEvent, session: Session | null) => void) => {
    mocks.listeners.add(listener);
    if (initialIdentity !== undefined) listener("INITIAL_SESSION", session(initialIdentity));
    return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
  });
});
afterEach(() => { cleanup(); mocks.listeners.clear(); });

const editor = (value = booking, draftOwnerId: string | null = A, payments: BookingPayment[] = []) => (
  <><Header title="Booking" /><EventBookingClient booking={value} draftOwnerId={draftOwnerId} today="2026-11-25" payments={payments} /></>
);
const click = async (name: string) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
async function financial() {
  if (screen.queryByRole("tab", { name: "Financial", selected: true })) return;
  screen.getByRole("tab", { name: "Financial" }).focus();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Performance" }), { key: "ArrowRight" });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Financial", selected: true })).toBeTruthy());
}
async function enterDraft(note = PRIVATE, amount = "150", currency = "EUR") {
  await financial();
  await click("Add payment");
  fireEvent.change(screen.getByLabelText(`Payment amount (${currency})`), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText("Payment note (optional)"), { target: { value: note } });
}
async function clickSavedIfOffered() {
  const save = screen.queryByRole("button", { name: "Save new payment" });
  if (save) await act(async () => { fireEvent.click(save); });
}

it("recovers an unchanged same-member draft on reload and submits its original currency and key", async () => {
  render(editor()); await enterDraft();
  const { operationId } = JSON.parse(rawDraft()!);
  cleanup(); render(editor());
  expect(screen.getByDisplayValue(PRIVATE)).toBeTruthy();
  await click("Save new payment");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(booking.id, payload(PRIVATE), operationId);
});

it("does not restore or submit a previous member's unsaved draft on the same booking", async () => {
  render(editor()); await enterDraft();
  cleanup(); initialIdentity = B; render(editor(booking, B));
  await financial(); await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
  expect(screen.getByRole("button", { name: "Add payment" })).toBeTruthy();
});

it.each([
  ["workspace", { ...booking, workspace_id: "workspace-b" }],
  ["booking", { ...booking, id: "booking-b" }],
])("does not adopt a draft copied into a different %s context", async (_dimension, changed) => {
  render(editor()); await enterDraft();
  const raw = rawDraft()!;
  expect(JSON.parse(raw).note).toBe(PRIVATE);
  cleanup(); window.sessionStorage.setItem(`backbeat:payment-draft:${changed.id}`, raw);
  render(editor(changed)); await financial(); await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
});

it("fails closed until the browser auth snapshot agrees with the server owner", async () => {
  render(editor()); await enterDraft(); cleanup();
  initialIdentity = undefined; render(editor()); await financial();
  await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
  await act(async () => emit("INITIAL_SESSION", A));
  expect(screen.getByDisplayValue(PRIVATE)).toBeTruthy();
});

it("does not read or display A's draft when the same mounted scope returns before fresh confirmation", async () => {
  const view = render(editor()); await enterDraft();
  const { operationId } = JSON.parse(rawDraft()!);
  expect(screen.getByDisplayValue(PRIVATE)).toBeTruthy();
  view.rerender(editor(booking, null));
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
  expect(mocks.listeners.size).toBe(0);

  initialIdentity = undefined;
  const read = vi.spyOn(Object.getPrototypeOf(window.sessionStorage), "getItem");
  try {
    view.rerender(editor());
    expect(mocks.listeners.size).toBe(1);
    expect.soft(screen.queryByDisplayValue(PRIVATE)).toBeNull();
    expect.soft(read).not.toHaveBeenCalledWith(storageKey);
    await clickSavedIfOffered();
    expect(mocks.create).not.toHaveBeenCalled();

    await act(async () => emit("INITIAL_SESSION", A));
    expect(read).toHaveBeenCalledWith(storageKey);
    expect(screen.getByDisplayValue(PRIVATE)).toBeTruthy();
    await click("Save new payment");
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(booking.id, payload(PRIVATE), operationId);
  } finally {
    read.mockRestore();
  }
});

it("does not restore a draft when the browser auth snapshot fails", async () => {
  render(editor()); await enterDraft(); cleanup();
  mocks.subscribe.mockImplementationOnce(() => { throw new Error("auth unavailable"); });
  render(editor()); await financial(); await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
});

it("does not restore a draft for a mismatched browser identity", async () => {
  render(editor()); await enterDraft(); cleanup();
  initialIdentity = B; render(editor()); await financial(); await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
});

it("does not assign a valid pre-scope draft to the current member", async () => {
  window.sessionStorage.setItem(storageKey, JSON.stringify({
    kind: "deposit", amount: "150", dueOn: "", paidOn: "", note: PRIVATE,
    operationId: "21ef4aa9-f858-46ae-a87b-29ce93bb8724", replaces: null,
  }));
  render(editor()); await financial(); await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
});

it("keeps the draft and key through same-owner token refresh", async () => {
  render(editor()); await enterDraft();
  const raw = rawDraft();
  await act(async () => emit("TOKEN_REFRESHED", A));
  expect(rawDraft()).toBe(raw);
  expect(screen.getByDisplayValue(PRIVATE)).toBeTruthy();
  await click("Save new payment");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(booking.id, payload(PRIVATE), JSON.parse(raw!).operationId);
});

it("invalidates a mounted draft on null auth without restoring it on a later sign-in", async () => {
  render(editor()); await enterDraft();
  await act(async () => emit("SIGNED_OUT", null));
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
  expect(rawDraft()).toBeNull();
  await act(async () => emit("SIGNED_IN", A));
  await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
});

it.each([["SIGNED_OUT", null], ["SIGNED_IN", B]] as const)(
  "purges an earlier draft when %s is the first auth event before the initial snapshot",
  async (event, nextOwner) => {
    render(editor()); await enterDraft();
    expect(JSON.parse(rawDraft()!).note).toBe(PRIVATE);
    cleanup();
    initialIdentity = undefined;
    render(editor()); await financial();
    expect(mocks.listeners.size).toBe(1);
    expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
    await act(async () => emit(event, nextOwner));
    expect.soft(rawDraft()).toBeNull();
    await act(async () => emit("INITIAL_SESSION", nextOwner));

    cleanup(); initialIdentity = A; render(editor());
    await financial();
    expect.soft(screen.queryByDisplayValue(PRIVATE)).toBeNull();
    await clickSavedIfOffered();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add payment" }).getAttribute("aria-disabled")).toBe("false");
  },
);

it("fences A's pending completion from B's new draft on the same booking", async () => {
  let settle!: (result: { success: boolean }) => void;
  mocks.create.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
  const view = render(editor()); await enterDraft(); await click("Save new payment");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(booking.id, payload(PRIVATE), JSON.parse(rawDraft()!).operationId);
  await act(async () => emit("SIGNED_IN", B));
  view.rerender(editor(booking, B));
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
  await enterDraft("member B note", "25");
  const b = rawDraft();
  await act(async () => settle({ success: true }));
  expect(rawDraft()).toBe(b);
  expect(screen.getByDisplayValue("member B note")).toBeTruthy();
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  await click("Save new payment");
  expect(mocks.create).toHaveBeenLastCalledWith(booking.id, payload("member B note", "EUR", 2500), JSON.parse(b!).operationId);
});

it("does not clear a replacement draft when an unmounted editor's action completes", async () => {
  let settle!: (result: { success: boolean }) => void;
  mocks.create.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
  render(editor()); await enterDraft(); await click("Save new payment");
  expect(mocks.create).toHaveBeenCalledOnce();
  cleanup(); window.sessionStorage.removeItem(storageKey);
  initialIdentity = B; render(editor(booking, B));
  await enterDraft("replacement draft", "25");
  const replacement = rawDraft();
  await act(async () => settle({ success: true }));
  expect(rawDraft()).toBe(replacement);
  expect(screen.getByDisplayValue("replacement draft")).toBeTruthy();
  expect(mocks.router.refresh).not.toHaveBeenCalled();
});

it("clears only financial drafts through the header before the server sign-out responds", async () => {
  let settle!: () => void;
  mocks.signOut.mockImplementationOnce(() => new Promise<void>((resolve) => { settle = resolve; }));
  render(editor()); await enterDraft();
  window.sessionStorage.setItem("backbeat:payment-draft:other-booking", "old or other financial draft");
  window.sessionStorage.setItem("backbeat:unrelated", "keep");

  fireEvent.keyDown(screen.getByRole("button", { name: "Account menu for User" }), { key: "Enter" });
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })); });
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(rawDraft()).toBeNull();
  expect(window.sessionStorage.getItem("backbeat:payment-draft:other-booking")).toBeNull();
  expect(window.sessionStorage.getItem("backbeat:unrelated")).toBe("keep");

  await act(async () => emit("TOKEN_REFRESHED", A));
  await clickSavedIfOffered();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => settle());
  cleanup(); initialIdentity = B; render(editor(booking, B));
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
});

it.each(["USD", null] as const)("retains the EUR draft without submitting it after the saved currency becomes %s", async (currency) => {
  render(editor()); await enterDraft();
  const original = rawDraft();
  const key = JSON.parse(original!).operationId;
  cleanup(); render(editor({ ...booking, fee_amount_minor: currency ? booking.fee_amount_minor : null, fee_currency: currency }));
  await financial(); await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Payment amount (EUR)") as HTMLInputElement).value).toBe("150");
  expect(screen.getByDisplayValue(PRIVATE)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("The booking’s saved currency changed. Cancel this draft before starting a new payment. The amount has not been converted.");
  expect(rawDraft()).toBe(original);
  await click("Cancel");
  expect(rawDraft()).toBeNull();
  if (currency) {
    await click("Add payment");
    expect((screen.getByLabelText("Payment amount (USD)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Payment note (optional)") as HTMLInputElement).value).toBe("");
    const newKey = JSON.parse(rawDraft()!).operationId;
    expect(newKey).not.toBe(key);
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), { target: { value: "23" } });
    await click("Save new payment");
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(booking.id, payload("", "USD", 2300), newKey);
  }
});

it("cancels an EUR draft and starts a blank USD payment after a mounted saved-currency refresh", async () => {
  const view = render(editor()); await enterDraft();
  const original = rawDraft();
  const originalKey = JSON.parse(original!).operationId;
  view.rerender(editor({ ...booking, fee_amount_minor: 123450, fee_currency: "USD" }));

  expect((screen.getByLabelText("Payment amount (EUR)") as HTMLInputElement).value).toBe("150");
  expect(screen.getByDisplayValue(PRIVATE)).toBeTruthy();
  expect(rawDraft()).toBe(original);
  expect(screen.getByRole("alert").textContent).toMatch(/saved currency changed/);
  await click("Save new payment");
  expect(mocks.create).not.toHaveBeenCalled();
  await click("Cancel");
  expect(rawDraft()).toBeNull();
  await click("Add payment");

  expect((screen.getByLabelText("Booking fee currency") as HTMLSelectElement).value).toBe("USD");
  expect((screen.getByLabelText("Booking fee amount") as HTMLInputElement).value).toBe("1234.50");
  const amount = screen.getByLabelText("Payment amount (USD)") as HTMLInputElement;
  expect(amount.value).toBe("");
  expect((screen.getByLabelText("Payment note (optional)") as HTMLInputElement).value).toBe("");
  const newKey = JSON.parse(rawDraft()!).operationId;
  expect(newKey).not.toBe(originalKey);
  fireEvent.change(amount, { target: { value: "23" } });
  await click("Save new payment");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(booking.id, payload("", "USD", 2300), newKey);
  expect(mocks.updateBooking).not.toHaveBeenCalled();
});

it("revisits a deferred fee rebase after a tax-only save and restarts the payment in USD", async () => {
  const view = render(editor()); await enterDraft();
  const original = rawDraft();
  const originalKey = JSON.parse(original!).operationId;
  const fee = screen.getByLabelText("Booking fee amount") as HTMLInputElement;
  expect(fee.value).toBe("1000.00");
  fireEvent.change(fee, { target: { value: "1090" } });
  fireEvent.change(fee, { target: { value: "1000.00" } });
  const refreshed: BookingWithArtist = { ...booking, fee_amount_minor: 123450, fee_currency: "USD" };
  view.rerender(editor(refreshed));
  expect((screen.getByLabelText("Booking fee currency") as HTMLSelectElement).value).toBe("EUR");
  expect(fee.value).toBe("1000.00");
  expect(rawDraft()).toBe(original);
  expect(screen.getByRole("alert").textContent).toMatch(/saved currency changed/);
  await click("Save new payment");
  expect(mocks.create).not.toHaveBeenCalled();

  const taxNote = "Tax note only";
  fireEvent.change(screen.getByLabelText("Tax note"), { target: { value: taxNote } });
  await click("Update booking");
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith(booking.id, { tax_note: taxNote });
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
  view.rerender(editor({ ...refreshed, tax_note: taxNote }));
  expect(rawDraft()).toBe(original);
  await click("Cancel");
  expect(rawDraft()).toBeNull();
  await click("Add payment");

  expect((screen.getByLabelText("Booking fee currency") as HTMLSelectElement).value).toBe("USD");
  expect(fee.value).toBe("1234.50");
  const amount = screen.getByLabelText("Payment amount (USD)") as HTMLInputElement;
  expect(amount.value).toBe("");
  expect((screen.getByLabelText("Payment note (optional)") as HTMLInputElement).value).toBe("");
  const newKey = JSON.parse(rawDraft()!).operationId;
  expect(newKey).not.toBe(originalKey);
  fireEvent.change(amount, { target: { value: "23" } });
  await click("Save new payment");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(booking.id, payload("", "USD", 2300), newKey);
});

it("keeps a just-acknowledged fee edit while saved props delivered during the write are still stale", async () => {
  let acknowledge!: (result: { success: boolean }) => void;
  mocks.updateBooking.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
  const view = render(editor()); await financial();
  const fee = screen.getByLabelText("Booking fee amount") as HTMLInputElement;
  const currency = screen.getByLabelText("Booking fee currency") as HTMLSelectElement;
  fireEvent.change(fee, { target: { value: "1090" } });
  fireEvent.change(currency, { target: { value: "GBP" } });
  await click("Update booking");
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith(booking.id, { fee_amount_minor: 109000, fee_currency: "GBP" });
  const stale: BookingWithArtist = { ...booking, fee_amount_minor: 120000, fee_currency: "USD" };
  view.rerender(editor(stale));
  expect(currency.value).toBe("GBP");
  await act(async () => acknowledge({ success: true }));
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
  expect(currency.value).toBe("GBP");
  expect(fee.value).toBe("1090");
  expect(screen.queryByRole("button", { name: "Add payment" })).toBeNull();
  view.rerender(editor({ ...stale }));
  expect(currency.value).toBe("GBP");
  expect(fee.value).toBe("1090");
  view.rerender(editor({ ...booking, fee_amount_minor: 109000, fee_currency: "GBP" }));
  expect(screen.getByRole("button", { name: "Add payment" })).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("resends an uncertain fee after its normalized pair returns to baseline despite a saved-currency refresh", async () => {
  const view = render(editor()); await financial();
  const fee = screen.getByLabelText("Booking fee amount") as HTMLInputElement;
  const currency = screen.getByLabelText("Booking fee currency") as HTMLSelectElement;
  fireEvent.change(fee, { target: { value: "1090" } });
  mocks.updateBooking.mockRejectedValueOnce(new Error("reply lost"));
  await click("Update booking");
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith(booking.id, { fee_amount_minor: 109000, fee_currency: "EUR" });
  expect(screen.getByRole("alert").textContent).toMatch(/could not be confirmed/);
  fireEvent.change(fee, { target: { value: "1000.00" } });
  view.rerender(editor({ ...booking, fee_amount_minor: 120000, fee_currency: "USD" }));
  expect(fee.value).toBe("1000.00");
  expect(currency.value).toBe("EUR");
  expect(screen.queryByRole("button", { name: "Add payment" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Tax note"), { target: { value: "Retry with tax note" } });
  await click("Update booking");
  expect(mocks.updateBooking).toHaveBeenNthCalledWith(2, booking.id, { fee_amount_minor: 100000, fee_currency: "EUR", tax_note: "Retry with tax note" });
  expect(mocks.updateBooking).toHaveBeenCalledTimes(2);
  expect(currency.value).toBe("EUR");
  expect(fee.value).toBe("1000.00");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("rebases clean fee and saved fixed amounts together without leaking them into a partial booking save", async () => {
  const priced: BookingWithArtist = { ...booking, commission_type: "fixed", commission_value: 5550, commission_mode: "included" };
  const view = render(editor(priced)); await financial();
  expect((screen.getByLabelText("Commission amount (EUR)") as HTMLInputElement).value).toBe("55.50");
  view.rerender(editor({ ...priced, fee_amount_minor: 1040, fee_currency: "JPY", commission_value: 75 }));
  const fee = screen.getByLabelText("Booking fee amount") as HTMLInputElement;
  expect.soft(fee.value).toBe("1040");
  expect.soft((screen.queryByLabelText("Commission amount (JPY)") as HTMLInputElement | null)?.value).toBe("75");
  // Returning the edited fee to its refreshed baseline is not a write.
  fireEvent.change(fee, { target: { value: "1090" } });
  fireEvent.change(fee, { target: { value: "1040" } });
  fireEvent.change(screen.getByLabelText("Tax note"), { target: { value: "Only this changed" } });
  await click("Update booking");
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith(booking.id, { tax_note: "Only this changed" });
});

it("preserves a genuine dirty fee pair and payment guard across a mounted saved-currency refresh", async () => {
  const view = render(editor()); await financial();
  fireEvent.change(screen.getByLabelText("Booking fee amount"), { target: { value: "1090" } });
  fireEvent.change(screen.getByLabelText("Booking fee currency"), { target: { value: "GBP" } });
  view.rerender(editor({ ...booking, fee_amount_minor: 120000, fee_currency: "USD" }));
  expect((screen.getByLabelText("Booking fee amount") as HTMLInputElement).value).toBe("1090");
  expect((screen.getByLabelText("Booking fee currency") as HTMLSelectElement).value).toBe("GBP");
  expect(screen.queryByRole("button", { name: "Add payment" })).toBeNull();
  expect(screen.getByText("Save or undo the fee currency change before recording a payment.")).toBeTruthy();
  await click("Update booking");
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith(booking.id, { fee_amount_minor: 109000, fee_currency: "GBP" });
  expect(mocks.create).not.toHaveBeenCalled();
});

it("keeps an edited fixed commission in its entered denomination on refreshed props", async () => {
  const priced: BookingWithArtist = { ...booking, commission_type: "fixed", commission_value: 5550, commission_mode: "included" };
  const view = render(editor(priced)); await financial();
  fireEvent.change(screen.getByLabelText("Commission amount (EUR)"), { target: { value: "58.25" } });
  view.rerender(editor({ ...priced, fee_amount_minor: 1040, fee_currency: "JPY", commission_value: 75 }));
  expect((screen.getByLabelText("Commission amount (EUR)") as HTMLInputElement).value).toBe("58.25");
  expect(screen.queryByLabelText("Commission amount (JPY)")).toBeNull();
  expect(mocks.updateBooking).not.toHaveBeenCalled();
});

it("keeps an acknowledged fixed commission while applying the deferred fee rebase", async () => {
  let acknowledge!: (result: { success: boolean }) => void;
  mocks.updateBooking.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
  const priced: BookingWithArtist = { ...booking, commission_type: "fixed", commission_value: 5550, commission_mode: "included" };
  const view = render(editor(priced)); await financial();
  const commission = () => (screen.getByLabelText("Commission amount (EUR)") as HTMLInputElement).value;
  const mode = () => (screen.getByLabelText("Commission mode") as HTMLSelectElement).value;
  const fee = () => (screen.getByLabelText("Booking fee amount") as HTMLInputElement).value;
  expect(commission()).toBe("55.50");
  fireEvent.change(screen.getByLabelText("Commission amount (EUR)"), { target: { value: "58.25" } });
  fireEvent.change(screen.getByLabelText("Commission mode"), { target: { value: "on_top" } });
  view.rerender(editor({ ...priced, fee_currency: "USD" }));
  const stale = { ...priced, fee_amount_minor: 123450 };
  view.rerender(editor(stale));
  expect(commission()).toBe("58.25");
  expect(mode()).toBe("on_top");
  expect(fee()).toBe("1000.00");
  await click("Update booking");
  expect(mocks.updateBooking).toHaveBeenCalledExactlyOnceWith(booking.id, {
    commission_type: "fixed", commission_value: 5825, commission_mode: "on_top",
  });
  await act(async () => acknowledge({ success: true }));
  expect(screen.getByText("Booking saved.")).toBeTruthy();
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
  expect(fee()).toBe("1234.50");
  expect.soft(commission()).toBe("58.25");
  expect.soft(mode()).toBe("on_top");

  view.rerender(editor({ ...stale, commission_value: 5825, commission_mode: "on_top" }));
  expect.soft(commission()).toBe("58.25");
  expect.soft(mode()).toBe("on_top");

  // Suppression belongs to the obsolete snapshot, not future clean currency observations.
  view.rerender(editor({ ...stale, fee_currency: "JPY", fee_amount_minor: 1040, commission_value: 75 }));
  expect(fee()).toBe("1040");
  expect((screen.getByLabelText("Commission amount (JPY)") as HTMLInputElement).value).toBe("75");
  expect(mode()).toBe("included");
});

it.each([
  ["invalid JSON", () => "{"],
  ["unsupported currency", (raw: string) => JSON.stringify({ ...JSON.parse(raw), currency: "XYZ" })],
  ["non-string replacement ID", (raw: string) => JSON.stringify({ ...JSON.parse(raw), replaces: 42 })],
])("ignores a malformed stored draft with %s", async (_description, corrupt) => {
  render(editor()); await enterDraft();
  const raw = rawDraft()!;
  expect(JSON.parse(raw).note).toBe(PRIVATE);
  cleanup(); window.sessionStorage.setItem(storageKey, corrupt(raw));
  render(editor()); await financial(); await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(PRIVATE)).toBeNull();
});

it("does not reconcile an EUR draft against a recorded row with the same key in USD", async () => {
  render(editor()); await enterDraft();
  const original = rawDraft();
  const id = JSON.parse(original!).operationId;
  cleanup(); render(editor({ ...booking, fee_currency: "USD" }, A, [{
    id, booking_id: booking.id, kind: "deposit", currency: "USD", amount_minor: 15000, note: PRIVATE,
    due_on: null, paid_on: null, voided_at: null, void_kind: null, void_reason: null, replaces_payment_id: null,
  }]));
  await financial();
  expect(rawDraft()).toBe(original);
  expect(screen.queryByText("Payment added.")).toBeNull();
  await clickSavedIfOffered();
  expect(mocks.create).not.toHaveBeenCalled();
});
