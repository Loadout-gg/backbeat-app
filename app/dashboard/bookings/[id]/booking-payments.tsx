"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RetryButton } from "@/components/retry-button";
import { createBookingPayment, deleteBookingPayment, updateBookingPayment } from "@/lib/actions/booking-payments";
import { formatBookingFeeInput, type BookingFeeCurrency } from "@/lib/booking-fee";
import {
  COMMISSION_MODE_LABELS, MAX_PAYMENT_NOTE_LENGTH, PAYMENT_KINDS, PAYMENT_KIND_LABELS, PAYMENT_NEEDS_FEE_MESSAGE,
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
}

type Draft = { id: string | null; kind: PaymentKind; amount: string; dueOn: string; paidOn: string; note: string };
const EMPTY_DRAFT: Draft = { id: null, kind: "deposit", amount: "", dueOn: "", paidOn: "", note: "" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fieldClass = "h-9 min-w-0 text-sm";
const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const labelClass = "mb-1.5 block text-xs font-medium text-foreground";

export function BookingPayments({ bookingId, feeMinor, feeCurrency, commission, payments, today }: BookingPaymentsProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inFlight = useRef(false);

  const totals = payments ? bookingFinanceTotals({ feeMinor, currency: feeCurrency, commission, payments }) : null;

  // One mutation at a time; a thrown action is reported as unconfirmed, never as success.
  const run = async (key: string, action: () => Promise<{ success: boolean; error?: string }>, done: string, onError: (message: string) => void) => {
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
      onError("Unable to confirm the change. Reload the booking before retrying.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const submitDraft = async () => {
    if (!draft || !feeCurrency) return;
    const amount = parseMoneyAmount(draft.amount, feeCurrency, "payment amount", true);
    if (!amount.success) { setFormError(amount.error); return; }
    if (draft.dueOn && !DATE.test(draft.dueOn)) { setFormError("Enter a valid due date"); return; }
    if (draft.paidOn && !DATE.test(draft.paidOn)) { setFormError("Enter a valid paid date"); return; }
    if (draft.note.trim().length > MAX_PAYMENT_NOTE_LENGTH) {
      setFormError(`Payment note must be at most ${MAX_PAYMENT_NOTE_LENGTH} characters`);
      return;
    }
    const fields = {
      kind: draft.kind, amount_minor: amount.data,
      due_on: draft.dueOn || null, paid_on: draft.paidOn || null, note: draft.note,
    };
    const saved = draft.id
      ? await run("form", () => updateBookingPayment(draft.id!, fields), "Payment saved.", setFormError)
      : await run("form", () => createBookingPayment(bookingId, { ...fields, currency: feeCurrency }), "Payment added.", setFormError);
    if (saved) setDraft(null);
  };

  const startEdit = (payment: BookingPayment) => {
    setFormError(null);
    setConfirmDelete(null);
    setDraft({
      id: payment.id, kind: payment.kind, amount: formatBookingFeeInput(payment.amount_minor, payment.currency),
      dueOn: payment.due_on ?? "", paidOn: payment.paid_on ?? "", note: payment.note ?? "",
    });
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
        </p>
        {payments !== null && payments.length === 0 && (
          <p className="text-sm text-muted-foreground">No payments recorded.</p>
        )}
        {payments !== null && payments.length > 0 && (
          <ul aria-label="Recorded payments" className="divide-y divide-border rounded-lg border border-border">
            {payments.map((payment) => {
              const overdue = !!today && !payment.paid_on && !!payment.due_on && payment.due_on < today;
              const name = `${PAYMENT_KIND_LABELS[payment.kind]} ${formatMinorAmount(payment.amount_minor, payment.currency)}`;
              return (
                <li key={payment.id} className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1 break-words">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      <span>{name}</span>
                      {payment.paid_on
                        ? <Badge variant="default">Paid</Badge>
                        : overdue ? <Badge variant="destructive">Overdue</Badge> : <Badge variant="secondary">Not paid</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {payment.due_on ? `Due ${payment.due_on}` : "No due date"}
                      {payment.paid_on ? ` · Paid on ${payment.paid_on}` : ""}
                    </p>
                    {payment.note && <p className="text-sm text-foreground">{payment.note}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {confirmDelete === payment.id ? (
                      <>
                        <span className="self-center text-sm text-muted-foreground">Delete this payment?</span>
                        <Button type="button" size="sm" variant="destructive" aria-disabled={busy !== null}
                          onClick={async () => { if (await run(payment.id, () => deleteBookingPayment(payment.id), "Payment deleted.", setRowError)) setConfirmDelete(null); }}>
                          {busy === payment.id ? "Deleting..." : "Yes, delete"}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Keep</Button>
                      </>
                    ) : (
                      <>
                        {today && (payment.paid_on ? (
                          <Button type="button" size="sm" variant="outline" aria-disabled={busy !== null} aria-label={`Mark ${name} as not paid`}
                            onClick={() => run(payment.id, () => updateBookingPayment(payment.id, { paid_on: null }), "Payment marked as not paid.", setRowError)}>
                            Mark as not paid
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="outline" aria-disabled={busy !== null} aria-label={`Mark ${name} as paid today`}
                            onClick={() => run(payment.id, () => updateBookingPayment(payment.id, { paid_on: today }), "Payment marked as paid.", setRowError)}>
                            Mark as paid today
                          </Button>
                        ))}
                        <Button type="button" size="sm" variant="outline" aria-label={`Edit ${name}`} onClick={() => startEdit(payment)}>Edit</Button>
                        <Button type="button" size="sm" variant="outline" aria-label={`Delete ${name}`}
                          onClick={() => { setRowError(null); setDraft(null); setConfirmDelete(payment.id); }}>
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
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
        {payments !== null && feeCurrency && draft === null && (
          <Button type="button" variant="outline" onClick={() => { setFormError(null); setConfirmDelete(null); setDraft(EMPTY_DRAFT); }}>
            Add payment
          </Button>
        )}
        {draft !== null && feeCurrency && (
          <div role="group" aria-label={draft.id ? "Edit payment" : "New payment"} className="space-y-4 rounded-lg border border-border p-4">
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="payment-kind" className={labelClass}>Payment type</label>
                <select id="payment-kind" value={draft.kind} className={selectClass}
                  onChange={(event) => setDraft({ ...draft, kind: event.target.value as PaymentKind })}>
                  {PAYMENT_KINDS.map((kind) => <option key={kind} value={kind}>{PAYMENT_KIND_LABELS[kind]}</option>)}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-amount" className={labelClass}>Payment amount ({feeCurrency})</label>
                <Input id="payment-amount" type="text" inputMode="decimal" autoComplete="off" value={draft.amount} className={fieldClass}
                  aria-describedby={formError ? "payment-form-error" : undefined}
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-due-on" className={labelClass}>Due date (optional)</label>
                <Input id="payment-due-on" type="date" value={draft.dueOn} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} />
              </div>
              <div className="min-w-0">
                <label htmlFor="payment-paid-on" className={labelClass}>Paid date (leave empty if not paid)</label>
                <Input id="payment-paid-on" type="date" value={draft.paidOn} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })} />
              </div>
              <div className="min-w-0 sm:col-span-2">
                <label htmlFor="payment-note" className={labelClass}>Payment note (optional)</label>
                <Input id="payment-note" type="text" value={draft.note} maxLength={MAX_PAYMENT_NOTE_LENGTH} className={fieldClass}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
              </div>
            </div>
            {formError && <p id="payment-form-error" role="alert" className="text-sm text-destructive">{formError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={submitDraft} aria-disabled={busy !== null} className="aria-disabled:cursor-wait aria-disabled:opacity-50">
                {busy === "form" ? "Saving..." : draft.id ? "Save payment" : "Save new payment"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setDraft(null); setFormError(null); }}>Cancel</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
