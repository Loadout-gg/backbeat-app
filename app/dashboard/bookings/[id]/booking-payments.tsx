"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RetryButton } from "@/components/retry-button";
import { createBookingPayment, updateBookingPayment, voidBookingPayment } from "@/lib/actions/booking-payments";
import { BOOKING_FEE_CURRENCIES, formatBookingFeeInput, type BookingFeeCurrency } from "@/lib/booking-fee";
import { createClient } from "@/lib/supabase/client";
import { clearPaymentDrafts, readPaymentDraft, subscribePaymentDraftLogout, subscribePaymentDrafts, writePaymentDraft } from "@/lib/payment-draft-storage";
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
type Draft = { kind: PaymentKind; amount: string; currency: BookingFeeCurrency; dueOn: string; paidOn: string; note: string; operationId: string; replaces: string | null };
const EMPTY_DRAFT = { kind: "deposit", amount: "", dueOn: "", paidOn: "", note: "", replaces: null } as const;
type VoidDraft = { paymentId: string; reason: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Legacy records omit this exact owner/workspace/booking tuple and cannot be adopted.
function parseStoredDraft(raw: string | null, scope: string | null): Draft | null {
  if (!raw || !scope) return null;
  try {
    const value = JSON.parse(raw) as Partial<Draft & { scope: string }> | null;
    const text = (field: unknown) => typeof field === "string" ? field : null;
    if (!value || value.scope !== scope || !UUID.test(text(value.operationId) ?? "") || !PAYMENT_KINDS.includes(value.kind as PaymentKind)) return null;
    const currency = BOOKING_FEE_CURRENCIES.find((code) => code === value.currency);
    if (!currency) return null;
    const replaces = value.replaces == null ? null : text(value.replaces);
    if (value.replaces != null && (replaces === null || !UUID.test(replaces))) return null;
    const fields = [value.amount, value.dueOn, value.paidOn, value.note].map(text);
    if (fields.some((field) => field === null)) return null;
    const [amount, dueOn, paidOn, note] = fields as string[];
    return { kind: value.kind as PaymentKind, amount, currency, dueOn, paidOn, note, operationId: value.operationId!, replaces };
  } catch {
    return null;
  }
}
const PAYMENT_SAVED_DIFFERENTLY_MESSAGE =
  "This payment was already saved with other details. Your changes are kept below as a correction of it: save to replace it, or cancel to keep it as saved.";
const PAYMENT_DRAFT_CURRENCY_CHANGED_MESSAGE =
  "The booking’s saved currency changed. Cancel this draft before starting a new payment. The amount has not been converted.";
/** Whether a recorded payment holds exactly what the draft would have sent (normalized as the server does). */
function draftMatches(draft: Draft, payment: BookingPayment): boolean {
  const amount = parseMoneyAmount(draft.amount, draft.currency, "payment amount", true);
  const note = draft.note.trim() || null;
  return amount.success && amount.data === payment.amount_minor && draft.kind === payment.kind
    && (draft.dueOn || null) === payment.due_on && (draft.paidOn || null) === payment.paid_on
    && note === payment.note && (draft.replaces?.toLowerCase() ?? null) === (payment.replaces_payment_id ?? null);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fieldClass = "h-9 min-w-0 text-sm";
const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const labelClass = "mb-1.5 block text-xs font-medium text-foreground";
type DraftGeneration = { scope: string | null };
type DraftLease = { scope: string; generation: DraftGeneration };

/**
 * Draft, in-flight and feedback state of the payments panel. The booking editor calls this
 * hook and hands the result down: the Financial tab panel unmounts when another tab is
 * selected, and neither an unsaved payment draft nor a pending request may be lost with it.
 */
export function useBookingPaymentsState(ownerId: string | null | undefined, workspaceId: string, bookingId: string, payments?: readonly BookingPayment[] | null) {
  const router = useRouter();
  const scope = ownerId && workspaceId && bookingId ? JSON.stringify([ownerId, workspaceId, bookingId]) : null;
  // A scope that disappears and then returns must be confirmed again. A tuple alone
  // cannot identify which visit its auth snapshot belongs to.
  const [generation, setGeneration] = useState<DraftGeneration>({ scope });
  if (generation.scope !== scope) setGeneration({ scope });
  const [lease, setLease] = useState<DraftLease | null>(null);
  const activeLease = useRef<DraftLease | null>(null);
  // The browser snapshot can confirm or invalidate the verified request owner; it cannot
  // choose who owns a draft. Never read sensitive storage before the two agree.
  useLayoutEffect(() => {
    if (!scope || generation.scope !== scope) return;
    let live = true;
    let loggingOut = false;
    let previousOwner: string | null | undefined;
    const publish = (next: DraftLease | null) => {
      activeLease.current = next;
      setLease(next);
    };
    const stopLogout = subscribePaymentDraftLogout(() => {
      loggingOut = true;
      publish(null);
    });
    let unsubscribe: (() => void) | undefined;
    try {
      const { data: { subscription } } = createClient().auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
        if (!live || loggingOut) return;
        const signedOut = event === "SIGNED_OUT";
        const browserOwner = signedOut ? null : session?.user?.id ?? null;
        if (browserOwner !== ownerId) publish(null);
        // The SDK registers this subscriber before initialization finishes. A real event
        // can arrive before INITIAL_SESSION; use the verified page owner as its starting point.
        const identityChanged = previousOwner === undefined
          ? event !== "INITIAL_SESSION" && browserOwner !== ownerId
          : previousOwner !== browserOwner;
        if (signedOut || identityChanged) clearPaymentDrafts();
        previousOwner = browserOwner;
        // Synchronous: the SDK may be holding its auth lock during this callback.
        if (browserOwner === ownerId && activeLease.current === null) publish({ scope, generation });
      });
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      // A missing/failed browser client leaves recovery and edits closed.
    }
    return () => {
      live = false;
      activeLease.current = null;
      stopLogout();
      unsubscribe?.();
    };
  }, [ownerId, scope, generation]);

  const currentLease = generation.scope === scope && lease?.generation === generation ? lease : null;
  const scopeIsCurrent = () => currentLease !== null && activeLease.current === currentLease;
  // undefined: nothing chosen in this page yet, so the draft stored before a reload applies.
  const [localDraft, setLocalDraft] = useState<Draft | null | undefined>();
  const storedRaw = useSyncExternalStore(subscribePaymentDrafts, () => currentLease ? readPaymentDraft(bookingId) : null, () => null);
  const stored = useMemo(() => parseStoredDraft(storedRaw, scope), [storedRaw, scope]);
  const [voidDraft, setLocalVoidDraft] = useState<VoidDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [noticeState, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // The confirmation is shown only once the refreshed payments and totals are rendered.
  const [refreshing, startRefresh] = useTransition();

  const inFlight = useRef<DraftLease | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [editorLease, setEditorLease] = useState<DraftLease | null>(null);
  if (editorLease !== currentLease) {
    setEditorLease(currentLease);
    setLocalDraft(undefined);
    setLocalVoidDraft(null);
    setFormError(null);
    setRowError(null);
    setNotice("");
    setBusy(null);
    setSavedKey(null);
  }
  const candidate = !currentLease || editorLease !== currentLease ? null : localDraft !== undefined ? localDraft : stored;
  // The lost response did commit: a payment with the draft's key is in the booking.
  const recorded = candidate && busy === null
    ? payments?.find((payment) => payment.id === candidate.operationId.toLowerCase() && payment.currency === candidate.currency) ?? null : null;
  // Done only when it holds what the draft holds; edits made after the lost response are kept.
  const committed = !!candidate && !!recorded && draftMatches(candidate, recorded);
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
  const notice = refreshing && noticeState ? "Updating payments and totals..." : noticeState;
  /** A draft came back after a reload, so the editor can show the Financial tab. */
  const restored = localDraft === undefined && stored !== null;
  // Storage is the external system. Keep it equal to the draft in this page, including a draft
  // rebuilt during render (a reconciled correction gets a new key that must survive a reload).
  useEffect(() => {
    if (!currentLease || activeLease.current !== currentLease || !localDraft) return;
    const raw = JSON.stringify({ ...localDraft, scope: currentLease.scope });
    if (raw !== readPaymentDraft(bookingId)) writePaymentDraft(bookingId, raw);
  }, [bookingId, currentLease, localDraft]);
  // Drop the saved draft, unless a newer one replaced it.
  useEffect(() => {
    if (!currentLease || activeLease.current !== currentLease || !savedKey) return;
    if (parseStoredDraft(readPaymentDraft(bookingId), currentLease.scope)?.operationId === savedKey) writePaymentDraft(bookingId, null);
  }, [bookingId, currentLease, savedKey]);
  const setDraft = (next: Draft | null) => {
    if (!scopeIsCurrent() || !currentLease) return;
    setLocalDraft(next);
    writePaymentDraft(bookingId, next ? JSON.stringify({ ...next, scope: currentLease.scope }) : null);
  };
  const setVoidDraft = (next: VoidDraft | null) => { if (scopeIsCurrent()) setLocalVoidDraft(next); };

  // One mutation at a time; a thrown action is reported as unconfirmed, never as success.
  // Even a successful late response may not affect a different or invalidated editor.
  const run = async (key: string, action: () => Promise<{ success: boolean; error?: string }>, done: string, onError: (message: string) => void, retrySameDraft = false) => {
    if (!scopeIsCurrent() || inFlight.current === currentLease || refreshing) return false;
    inFlight.current = currentLease;
    setBusy(key);
    setFormError(null);
    setRowError(null);
    setNotice("");
    try {
      const result = await action();
      if (!scopeIsCurrent()) return false;
      if (!result.success) {
        onError(result.error || "Unable to save the payment. Please try again.");
        return false;
      }
      setNotice(done);
      startRefresh(() => router.refresh());
      return true;
    } catch {
      if (!scopeIsCurrent()) return false;
      onError(retrySameDraft
        ? "Unable to confirm the change. Retry this draft or check the booking before starting another payment."
        : "Unable to confirm the change. Reload the booking before retrying.");
      return false;
    } finally {
      if (inFlight.current === currentLease) inFlight.current = null;
      if (scopeIsCurrent()) setBusy(null);
    }
  };
  /** Runs an editor change only when no request is pending. */
  const unlessBusy = (change: () => void) => { if (scopeIsCurrent() && inFlight.current !== currentLease && !refreshing) change(); };

  return {
    draft, setDraft, voidDraft, setVoidDraft, formError, setFormError,
    rowError, setRowError, notice, busy, refreshing, run, unlessBusy, restored, ready: currentLease !== null,
  };
}
export type BookingPaymentsState = ReturnType<typeof useBookingPaymentsState>;

export function BookingPayments({ bookingId, feeMinor, feeCurrency, commission, payments, today, state, currencyChangePending = false }: BookingPaymentsProps) {
  const { draft, setDraft, voidDraft, setVoidDraft, formError, setFormError, rowError, setRowError, notice, busy, refreshing, run, unlessBusy, ready } = state;
  // While the refreshed server copy loads, nothing is edited against stale totals.
  const locked = busy !== null || !ready || refreshing;
  const currencyMismatch = draft !== null && draft.currency !== feeCurrency;
  const draftLocked = locked || currencyMismatch;

  const totals = payments ? bookingFinanceTotals({ feeMinor, currency: feeCurrency, commission, payments }) : null;

  const submitDraft = async () => {
    if (!draft || draft.currency !== feeCurrency) return;
    if (currencyChangePending) { setFormError(PAYMENT_CURRENCY_PENDING_MESSAGE); return; }
    const amount = parseMoneyAmount(draft.amount, draft.currency, "payment amount", true);
    if (!amount.success) { setFormError(amount.error); return; }
    if (draft.dueOn && !DATE.test(draft.dueOn)) { setFormError("Enter a valid due date"); return; }
    if (draft.paidOn && !DATE.test(draft.paidOn)) { setFormError("Enter a valid paid date"); return; }
    if (draft.note.trim().length > MAX_PAYMENT_NOTE_LENGTH) {
      setFormError(`Payment note must be at most ${MAX_PAYMENT_NOTE_LENGTH} characters`);
      return;
    }
    const fields = {
      kind: draft.kind, amount_minor: amount.data, due_on: draft.dueOn || null,
      paid_on: draft.paidOn || null, note: draft.note, currency: draft.currency,
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
      currency: payment.currency,
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
                        <Button type="button" size="sm" variant="outline" aria-disabled={locked} aria-label={`Mark ${name} as paid today`}
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
            onClick={() => unlessBusy(() => { setFormError(null); setVoidDraft(null); setDraft({ ...EMPTY_DRAFT, currency: feeCurrency, operationId: crypto.randomUUID() }); })}>
            Add payment
          </Button>
        )}
        {draft !== null && (
          <div role="group" aria-label={draft.replaces ? "Correct payment" : "New payment"} className="space-y-4 rounded-lg border border-border p-4">
            {draft.replaces && <p className="text-sm text-muted-foreground">Saving records this as a new payment and keeps the original as corrected history.</p>}
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="payment-kind" className={labelClass}>Payment type</label>
                <select id="payment-kind" value={draft.kind} disabled={draftLocked} className={selectClass}
                  onChange={(event) => setDraft({ ...draft, kind: event.target.value as PaymentKind })}>
                  {PAYMENT_KINDS.map((kind) => <option key={kind} value={kind}>{PAYMENT_KIND_LABELS[kind]}</option>)}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-amount" className={labelClass}>Payment amount ({draft.currency})</label>
                <Input id="payment-amount" disabled={draftLocked} type="text" inputMode="decimal" autoComplete="off" value={draft.amount} className={fieldClass}
                  aria-describedby={currencyMismatch || formError ? "payment-form-error" : undefined}
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-due-on" className={labelClass}>Due date (optional)</label>
                <Input id="payment-due-on" disabled={draftLocked} type="date" value={draft.dueOn} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} />
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-paid-on" className={labelClass}>Paid date (leave empty if not paid)</label>
                <Input id="payment-paid-on" disabled={draftLocked} type="date" value={draft.paidOn} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })} />
              </div>
              <div className="min-w-0 sm:col-span-2">
                <label htmlFor="payment-note" className={labelClass}>Payment note (optional)</label>
                <Input id="payment-note" disabled={draftLocked} type="text" value={draft.note} maxLength={MAX_PAYMENT_NOTE_LENGTH} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
              </div>
            </div>
            {(currencyMismatch || formError) && <p id="payment-form-error" role="alert" className="text-sm text-destructive">{currencyMismatch ? PAYMENT_DRAFT_CURRENCY_CHANGED_MESSAGE : formError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={submitDraft} disabled={currencyMismatch} aria-disabled={draftLocked} className="aria-disabled:cursor-wait aria-disabled:opacity-50">
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
