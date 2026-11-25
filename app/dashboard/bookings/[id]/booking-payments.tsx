"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RetryButton } from "@/components/retry-button";
import { createBookingPayment, updateBookingPayment, voidBookingPayment } from "@/lib/actions/booking-payments";
import { formatBookingFeeInput, type BookingFeeCurrency } from "@/lib/booking-fee";
import {
  COMMISSION_MODE_LABELS, MAX_PAYMENT_NOTE_LENGTH, MAX_PAYMENT_VOID_REASON_LENGTH, PAYMENT_CURRENCY_PENDING_MESSAGE, PAYMENT_KINDS, PAYMENT_KIND_LABELS, PAYMENT_NEEDS_FEE_MESSAGE,
  bookingFinanceTotals, formatCommissionValue, formatMinorAmount, parseMoneyAmount,
  type BookingCommission, type BookingPayment, type PaymentKind,
} from "@/lib/booking-finance";

interface BookingPaymentsProps {
  bookingId: string;
  /** Saved fee and commission (server copy). Totals never use unsaved drafts. */
  feeMinor: number | null;
  feeCurrency: BookingFeeCurrency | null;
  commission: BookingCommission | null;
  /** Null when the payments read failed: shown as an error, never as "no payments". */
  payments: readonly BookingPayment[] | null;
  /** Server "today" (configured calendar zone); without it there is no overdue flag or quick "paid today". */
  today?: string;
  /** Editor state owned by the booking editor, so it survives this panel unmounting on a tab change. */
  state: BookingPaymentsState;
  /**
   * The fee currency draft differs from the saved currency. A new payment would be recorded in
   * the saved currency and then lock the fee currency at the unsaved draft, so none is recorded.
   */
  currencyChangePending?: boolean;
}

/**
 * A new payment, or a correction that replaces `replaces`. `operationId` is the id the payment
 * will have and the server's idempotency key; it is created once per draft and never changes.
 */
type Draft = { kind: PaymentKind; amount: string; dueOn: string; paidOn: string; note: string; operationId: string; replaces: string | null };
const EMPTY_DRAFT = { kind: "deposit", amount: "", dueOn: "", paidOn: "", note: "", replaces: null } as const;
type VoidDraft = { paymentId: string; reason: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A retry after a lost response and a page reload must not record a second payment.
// The unsaved draft (with its operationId) is kept in this tab's sessionStorage per booking,
// only until the server confirms it, the payment shows up in the booking, or it is cancelled.
const draftStorageKey = (bookingId: string) => `backbeat:payment-draft:${bookingId}`;
const storageListeners = new Set<() => void>();
function subscribeStoredDrafts(listener: () => void) {
  storageListeners.add(listener);
  return () => { storageListeners.delete(listener); };
}
function readStoredRaw(bookingId: string): string | null {
  try {
    return window.sessionStorage.getItem(draftStorageKey(bookingId));
  } catch {
    return null;
  }
}
function parseStoredDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Draft> | null;
    const text = (field: unknown) => typeof field === "string" ? field : null;
    if (!value || !UUID.test(text(value.operationId) ?? "") || !PAYMENT_KINDS.includes(value.kind as PaymentKind)) return null;
    const replaces = value.replaces == null ? null : text(value.replaces);
    if (replaces !== null && !UUID.test(replaces)) return null;
    const fields = [value.amount, value.dueOn, value.paidOn, value.note].map(text);
    if (fields.some((field) => field === null)) return null;
    const [amount, dueOn, paidOn, note] = fields as string[];
    return { kind: value.kind as PaymentKind, amount, dueOn, paidOn, note, operationId: value.operationId!, replaces };
  } catch {
    return null;
  }
}
const PAYMENT_SAVED_DIFFERENTLY_MESSAGE =
  "This payment was already saved with other details. Your changes are kept below as a correction of it: save to replace it, or cancel to keep it as saved.";
/** Whether a recorded payment holds exactly what the draft would have sent (normalized as the server does). */
function draftMatches(draft: Draft, payment: BookingPayment): boolean {
  const amount = parseMoneyAmount(draft.amount, payment.currency, "payment amount", true);
  const note = draft.note.trim() || null;
  return amount.success && amount.data === payment.amount_minor && draft.kind === payment.kind
    && (draft.dueOn || null) === payment.due_on && (draft.paidOn || null) === payment.paid_on
    && note === payment.note && (draft.replaces?.toLowerCase() ?? null) === (payment.replaces_payment_id ?? null);
}
function storeDraft(bookingId: string, draft: Draft | null) {
  try {
    if (draft) window.sessionStorage.setItem(draftStorageKey(bookingId), JSON.stringify(draft));
    else window.sessionStorage.removeItem(draftStorageKey(bookingId));
  } catch {
    // Storage unavailable (private mode, blocked): the draft still works until a reload.
  }
  for (const listener of storageListeners) listener();
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fieldClass = "h-9 min-w-0 text-sm";
const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const labelClass = "mb-1.5 block text-xs font-medium text-foreground";

/**
 * Draft, in-flight and feedback state of the payments panel. The booking editor calls this
 * hook and hands the result down: the Financial tab panel unmounts when another tab is
 * selected, and neither an unsaved payment draft nor a pending request may be lost with it.
 */
export function useBookingPaymentsState(bookingId: string, payments?: readonly BookingPayment[] | null) {
  const router = useRouter();
  // undefined: nothing chosen in this page yet, so the draft stored before a reload applies.
  // The server snapshot is null, so hydration matches and the stored draft appears right after.
  const [localDraft, setLocalDraft] = useState<Draft | null | undefined>(undefined);
  const storedRaw = useSyncExternalStore(subscribeStoredDrafts, () => readStoredRaw(bookingId), () => null);
  const stored = useMemo(() => parseStoredDraft(storedRaw), [storedRaw]);
  const [voidDraft, setVoidDraft] = useState<VoidDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [noticeState, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const inFlight = useRef(false);
  const candidate = localDraft !== undefined ? localDraft : stored;
  // The lost response did commit: a payment with the draft's key is in the booking.
  const recorded = candidate && busy === null
    ? payments?.find((payment) => payment.id === candidate.operationId.toLowerCase()) ?? null : null;
  // Done only when it holds what the draft holds; edits made after the lost response are kept.
  const committed = !!candidate && !!recorded && draftMatches(candidate, recorded);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  if (candidate && recorded && !committed) {
    // Adjusted during render: keep the edits as a correction of the recorded payment (new key).
    setLocalDraft({ ...candidate, operationId: crypto.randomUUID(), replaces: recorded.id });
    setNotice("");
    setFormError(PAYMENT_SAVED_DIFFERENTLY_MESSAGE);
  }
  if (committed) {
    // Adjusted during render (no effect): close the draft and report it as saved.
    setLocalDraft(null);
    setSavedKey(candidate.operationId);
    setFormError(null);
    setNotice(candidate.replaces ? "Payment corrected." : "Payment added.");
  }
  const draft = committed ? null : candidate;
  const notice = noticeState;
  /** A draft came back after a reload, so the editor can show the Financial tab. */
  const restored = localDraft === undefined && stored !== null;
  // Storage is the external system. Keep it equal to the draft in this page, including a draft
  // rebuilt during render (a reconciled correction gets a new key that must survive a reload).
  useEffect(() => {
    if (localDraft && JSON.stringify(localDraft) !== storedRaw) storeDraft(bookingId, localDraft);
  }, [bookingId, localDraft, storedRaw]);
  // Drop the saved draft, unless a newer one replaced it.
  useEffect(() => {
    if (savedKey && parseStoredDraft(readStoredRaw(bookingId))?.operationId === savedKey) storeDraft(bookingId, null);
  }, [bookingId, savedKey]);
  const setDraft = (next: Draft | null) => { setLocalDraft(next); storeDraft(bookingId, next); };

  // One mutation at a time; a thrown action is reported as unconfirmed, never as success.
  // While it runs the editor cannot be opened, replaced or closed (see `locked` below), so
  // a completion always belongs to the editor that is still on screen.
  const run = async (key: string, action: () => Promise<{ success: boolean; error?: string }>, done: string, onError: (message: string) => void, retrySameDraft = false) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(key);
    setFormError(null);
    setRowError(null);
    setNotice("");
    try {
      const result = await action();
      if (!result.success) {
        onError(result.error || "Unable to save the payment. Please try again.");
        return false;
      }
      setNotice(done);
      router.refresh();
      return true;
    } catch {
      onError(retrySameDraft
        ? "Unable to confirm the change. Retry this draft or check the booking before starting another payment."
        : "Unable to confirm the change. Reload the booking before retrying.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  /** Runs an editor change only when no request is pending. */
  const unlessBusy = (change: () => void) => { if (!inFlight.current) change(); };

  return {
    draft, setDraft, voidDraft, setVoidDraft, formError, setFormError,
    rowError, setRowError, notice, busy, run, unlessBusy, restored,
  };
}
export type BookingPaymentsState = ReturnType<typeof useBookingPaymentsState>;

export function BookingPayments({ bookingId, feeMinor, feeCurrency, commission, payments, today, state, currencyChangePending = false }: BookingPaymentsProps) {
  const { draft, setDraft, voidDraft, setVoidDraft, formError, setFormError, rowError, setRowError, notice, busy, run, unlessBusy } = state;
  const locked = busy !== null;

  const totals = payments ? bookingFinanceTotals({ feeMinor, currency: feeCurrency, commission, payments }) : null;

  const submitDraft = async () => {
    if (!draft || !feeCurrency) return;
    if (currencyChangePending) { setFormError(PAYMENT_CURRENCY_PENDING_MESSAGE); return; }
    const amount = parseMoneyAmount(draft.amount, feeCurrency, "payment amount", true);
    if (!amount.success) { setFormError(amount.error); return; }
    if (draft.dueOn && !DATE.test(draft.dueOn)) { setFormError("Enter a valid due date"); return; }
    if (draft.paidOn && !DATE.test(draft.paidOn)) { setFormError("Enter a valid paid date"); return; }
    if (draft.note.trim().length > MAX_PAYMENT_NOTE_LENGTH) {
      setFormError(`Payment note must be at most ${MAX_PAYMENT_NOTE_LENGTH} characters`);
      return;
    }
    const fields = {
      kind: draft.kind, amount_minor: amount.data, due_on: draft.dueOn || null,
      paid_on: draft.paidOn || null, note: draft.note, currency: feeCurrency,
    };
    // The same operationId on every attempt, before and after a reload: one payment at most.
    const saved = draft.replaces
      ? await run("form", () => createBookingPayment(bookingId, fields, draft.operationId, draft.replaces!), "Payment corrected.", setFormError, true)
      : await run("form", () => createBookingPayment(bookingId, fields, draft.operationId), "Payment added.", setFormError, true);
    if (saved) setDraft(null);
  };

  const startCorrection = (payment: BookingPayment) => unlessBusy(() => {
    setFormError(null);
    setVoidDraft(null);
    setDraft({
      operationId: crypto.randomUUID(), replaces: payment.id, kind: payment.kind,
      amount: formatBookingFeeInput(payment.amount_minor, payment.currency),
      dueOn: payment.due_on ?? "", paidOn: payment.paid_on ?? "", note: payment.note ?? "",
    });
  });

  const submitVoid = async () => {
    if (!voidDraft) return;
    const reason = voidDraft.reason.trim();
    if (!reason) { setRowError("Enter why this payment is voided"); return; }
    const done = await run(voidDraft.paymentId, () => voidBookingPayment(voidDraft.paymentId, reason), "Payment voided.", setRowError);
    if (done) setVoidDraft(null);
  };

  const commissionSummary = commission
    ? `${formatCommissionValue(commission.type, commission.value, feeCurrency)}, ${commission.mode === "on_top" ? "on top of the fee" : "included in the fee"}`
    : "None";

  return (
    <div className="space-y-8">
      <section aria-labelledby="booking-totals-heading" className="space-y-3">
        <h2 id="booking-totals-heading" className="text-base font-medium text-foreground">Totals</h2>
        {payments === null ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">Payments could not be loaded, so totals are not shown.</p>
            <RetryButton label="Retry loading payments" />
          </div>
        ) : totals === null ? (
          <p className="text-sm text-muted-foreground">Set and save a booking fee to see totals and record payments.</p>
        ) : (
          <>
            <dl className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-3 rounded-lg border border-border p-4 sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Booking fee</dt><dd className="text-sm font-medium text-foreground">{formatMinorAmount(totals.feeMinor, totals.currency)}</dd></div>
              <div>
                <dt className="text-xs text-muted-foreground">Agency commission</dt>
                <dd className="text-sm font-medium text-foreground">{formatMinorAmount(totals.commissionMinor, totals.currency)}</dd>
                <dd className="text-xs text-muted-foreground">{commissionSummary}</dd>
              </div>
              <div><dt className="text-xs text-muted-foreground">Promoter total</dt><dd className="text-sm font-medium text-foreground">{formatMinorAmount(totals.promoterTotalMinor, totals.currency)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Paid</dt><dd className="text-sm font-medium text-foreground">{formatMinorAmount(totals.paidTotalMinor, totals.currency)}</dd></div>
              <div>
                <dt className="text-xs text-muted-foreground">{totals.outstandingMinor < 0 ? "Overpaid" : "Outstanding"}</dt>
                <dd className="text-sm font-medium text-foreground">{formatMinorAmount(Math.abs(totals.outstandingMinor), totals.currency)}</dd>
              </div>
              <div><dt className="text-xs text-muted-foreground">Artist net</dt><dd className="text-sm font-medium text-foreground">{formatMinorAmount(totals.artistNetMinor, totals.currency)}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Calculated from the saved fee, commission and payments; nothing here is stored. Only payments with a paid date count as paid. Taxes are not calculated.
            </p>
            {totals.ignoredPayments > 0 && (
              <p role="alert" className="text-sm text-destructive">
                {totals.ignoredPayments} payment(s) in another currency are not included in these totals.
              </p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="booking-payments-heading" className="space-y-3">
        <h2 id="booking-payments-heading" className="text-base font-medium text-foreground">Payments</h2>
        <p className="text-sm text-muted-foreground">
          Recorded by the agency, in the booking fee currency. A payment is paid when it has a paid date. This does not collect money, issue an invoice or change the booking status.
          Payments are never deleted: Void one that is no longer due (for example, the event was cancelled) or Correct one whose details changed; the original stays in the history.
        </p>
        {payments !== null && payments.length === 0 && (
          <p className="text-sm text-muted-foreground">No payments recorded.</p>
        )}
        {payments !== null && payments.length > 0 && (
          <ul aria-label="Recorded payments" className="divide-y divide-border rounded-lg border border-border">
            {payments.map((payment) => {
              const closed = payment.void_kind != null;
              const overdue = !closed && !!today && !payment.paid_on && !!payment.due_on && payment.due_on < today;
              const name = `${PAYMENT_KIND_LABELS[payment.kind]} ${formatMinorAmount(payment.amount_minor, payment.currency)}`;
              const replaced = payments.find((other) => other.id === payment.replaces_payment_id);
              return (
                <li key={payment.id} className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className={`min-w-0 space-y-1 break-words ${closed ? "text-muted-foreground" : ""}`}>
                    <p className={`flex flex-wrap items-center gap-2 text-sm font-medium ${closed ? "text-muted-foreground" : "text-foreground"}`}>
                      <span className={closed ? "line-through" : undefined}>{name}</span>
                      {payment.void_kind === "void" ? <Badge variant="outline">Voided</Badge>
                        : payment.void_kind === "corrected" ? <Badge variant="outline">Corrected</Badge>
                        : payment.paid_on
                        ? <Badge variant="default">Paid</Badge>
                        : overdue ? <Badge variant="destructive">Overdue</Badge> : <Badge variant="secondary">Not paid</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {payment.due_on ? `Due ${payment.due_on}` : "No due date"}
                      {payment.paid_on ? ` · Paid on ${payment.paid_on}` : ""}
                    </p>
                    {payment.note && <p className={`text-sm ${closed ? "" : "text-foreground"}`}>{payment.note}</p>}
                    {payment.void_kind === "void" && <p className="text-xs">Voided: {payment.void_reason}{payment.voided_at ? ` (${payment.voided_at.slice(0, 10)})` : ""}. Kept as history; not counted.</p>}
                    {payment.void_kind === "corrected" && <p className="text-xs">Replaced by a correction{payment.voided_at ? ` on ${payment.voided_at.slice(0, 10)}` : ""}. Kept as history; not counted.</p>}
                    {payment.replaces_payment_id && <p className="text-xs text-muted-foreground">Correction of {replaced ? `${PAYMENT_KIND_LABELS[replaced.kind]} ${formatMinorAmount(replaced.amount_minor, replaced.currency)}` : "an earlier payment"}.</p>}
                  </div>
                  {!closed && (
                    <div className="flex flex-wrap gap-2">
                      {/* Not offered for the payment being corrected: the correction replaces it. */}
                      {draft?.replaces === payment.id && <span className="self-center text-sm text-muted-foreground">Being corrected below</span>}
                      {today && !payment.paid_on && draft?.replaces !== payment.id && (
                        <Button type="button" size="sm" variant="outline" aria-disabled={busy !== null} aria-label={`Mark ${name} as paid today`}
                          onClick={() => run(payment.id, () => updateBookingPayment(payment.id, { paid_on: today }), "Payment marked as paid.", setRowError)}>
                          Mark as paid today
                        </Button>
                      )}
                      {draft === null && (
                        <>
                          <Button type="button" size="sm" variant="outline" aria-disabled={locked} aria-label={`Correct ${name}`} onClick={() => startCorrection(payment)}>Correct</Button>
                          {voidDraft?.paymentId !== payment.id && (
                            <Button type="button" size="sm" variant="outline" aria-disabled={locked} aria-label={`Void ${name}`}
                              onClick={() => unlessBusy(() => { setRowError(null); setVoidDraft({ paymentId: payment.id, reason: "" }); })}>
                              Void
                            </Button>
                          )}
                        </>
                      )}
                      {voidDraft?.paymentId === payment.id && (
                        <div role="group" aria-label={`Void ${name}`} className="flex w-full min-w-0 flex-col gap-2 sm:w-72">
                          <label htmlFor={`void-reason-${payment.id}`} className={labelClass}>Why is it voided? (e.g. event cancelled)</label>
                          <Input id={`void-reason-${payment.id}`} disabled={locked} type="text" value={voidDraft.reason} maxLength={MAX_PAYMENT_VOID_REASON_LENGTH} className={fieldClass}
                            onChange={(event) => setVoidDraft({ paymentId: payment.id, reason: event.target.value })} />
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="destructive" aria-disabled={locked} onClick={submitVoid}>
                              {busy === payment.id ? "Voiding..." : "Void payment"}
                            </Button>
                            <Button type="button" size="sm" variant="outline" aria-disabled={locked} onClick={() => unlessBusy(() => { setVoidDraft(null); setRowError(null); })}>Keep payment</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {rowError && <p role="alert" className="text-sm text-destructive">{rowError}</p>}
        {notice && <p role="status" className="text-sm text-foreground">{notice}</p>}

        {payments !== null && !feeCurrency && (
          <p className="text-sm text-muted-foreground">{PAYMENT_NEEDS_FEE_MESSAGE}</p>
        )}
        {payments !== null && feeCurrency && currencyChangePending && (
          <p className="text-sm text-muted-foreground">{PAYMENT_CURRENCY_PENDING_MESSAGE}</p>
        )}
        {payments !== null && feeCurrency && !currencyChangePending && draft === null && (
          <Button type="button" variant="outline" aria-disabled={locked}
            onClick={() => unlessBusy(() => { setFormError(null); setVoidDraft(null); setDraft({ ...EMPTY_DRAFT, operationId: crypto.randomUUID() }); })}>
            Add payment
          </Button>
        )}
        {draft !== null && feeCurrency && (
          <div role="group" aria-label={draft.replaces ? "Correct payment" : "New payment"} className="space-y-4 rounded-lg border border-border p-4">
            {draft.replaces && <p className="text-sm text-muted-foreground">Saving records this as a new payment and keeps the original as corrected history.</p>}
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="payment-kind" className={labelClass}>Payment type</label>
                <select id="payment-kind" value={draft.kind} disabled={locked} className={selectClass}
                  onChange={(event) => setDraft({ ...draft, kind: event.target.value as PaymentKind })}>
                  {PAYMENT_KINDS.map((kind) => <option key={kind} value={kind}>{PAYMENT_KIND_LABELS[kind]}</option>)}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-amount" className={labelClass}>Payment amount ({feeCurrency})</label>
                <Input id="payment-amount" disabled={locked} type="text" inputMode="decimal" autoComplete="off" value={draft.amount} className={fieldClass}
                  aria-describedby={formError ? "payment-form-error" : undefined}
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-due-on" className={labelClass}>Due date (optional)</label>
                <Input id="payment-due-on" disabled={locked} type="date" value={draft.dueOn} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} />
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-paid-on" className={labelClass}>Paid date (leave empty if not paid)</label>
                <Input id="payment-paid-on" disabled={locked} type="date" value={draft.paidOn} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })} />
              </div>
              <div className="min-w-0 sm:col-span-2">
                <label htmlFor="payment-note" className={labelClass}>Payment note (optional)</label>
                <Input id="payment-note" disabled={locked} type="text" value={draft.note} maxLength={MAX_PAYMENT_NOTE_LENGTH} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
              </div>
            </div>
            {formError && <p id="payment-form-error" role="alert" className="text-sm text-destructive">{formError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={submitDraft} aria-disabled={busy !== null} className="aria-disabled:cursor-wait aria-disabled:opacity-50">
                {busy === "form" ? "Saving..." : draft.replaces ? "Save correction" : "Save new payment"}
              </Button>
              <Button type="button" variant="outline" aria-disabled={locked} onClick={() => unlessBusy(() => { setDraft(null); setFormError(null); })}>Cancel</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
