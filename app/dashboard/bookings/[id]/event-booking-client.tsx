"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { BOOKING_FEE_CURRENCIES, parseBookingFee, formatBookingFeeInput, type BookingFeeCurrency, type BookingFeeError } from "@/lib/booking-fee";
import { createBookingSchema } from "@/lib/booking-validation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Trash2, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { updateBooking, updateBookingStatus, deleteBooking, type BookingWithArtist } from "@/lib/actions/bookings";
import {
  BOOKING_STATUS_LABELS, BOOKING_TRANSITION_LABELS, bookingStatusBadgeVariant,
  holdRankLabel, isHoldExpired, isPastBookingDate, sameDayWarning,
} from "@/lib/booking-display";
import { allowedBookingTransitions, type BookingStatus } from "@/lib/booking-status";
import { formatArtistBaseRate } from "@/lib/artist-base-rate";
import { BookingPromoterSelect } from "@/components/dashboard/booking-promoter-select";
import type { PromoterOption } from "@/lib/actions/events";
import type { BookingEventLink as LinkedEvent } from "@/lib/actions/booking-events";
import { BookingEventLink } from "./booking-event-link";
import { BOOKING_EVENT_COPY, cancelBookingConfirmCopy } from "@/lib/booking-event";
import {
  BOOKING_HAS_PAYMENTS_MESSAGE, COMMISSION_CURRENCY_CHANGED_MESSAGE, COMMISSION_MODES, COMMISSION_MODE_LABELS, COMMISSION_WITHIN_FEE_MESSAGE, DEFAULT_COMMISSION_MODE,
  MAX_TAX_NOTE_LENGTH, artistDefaultCommission, bookingCommission, defaultCommissionPrefill, formatArtistDefaultCommission,
  formatBasisPoints, parseCommissionPercent, parseMoneyAmount,
  type BookingPayment, type CommissionMode, type CommissionType,
} from "@/lib/booking-finance";
import { BookingPayments, useBookingPaymentsState } from "./booking-payments";

interface EventBookingClientProps {
  booking: BookingWithArtist;
  /** Verified request user for browser payment drafts. Missing identity disables draft recovery. */
  draftOwnerId?: string | null;
  /** Counts of other non-cancelled bookings by date; null when the scoped read failed. */
  sameDayBookingCounts?: Readonly<Partial<Record<string, number>>> | null;
  /** Server-calculated priority for the persisted hold, without peer booking records. */
  holdPosition?: Readonly<{ rank: number; total: number }> | null;
  /** Server "today" (configured calendar zone). Without it, completion is not offered. */
  today?: string;
  /** Payments of this booking; null when that read failed (shown as an error, not as "none"). */
  payments?: readonly BookingPayment[] | null;
  /** Promoter directory options; null when that read failed. Omitted: no promoter selector. */
  promoters?: readonly PromoterOption[] | null;
  /** Event created from this booking; null = none, "unavailable" = read failed. Omitted: no event section. */
  linkedEvent?: LinkedEvent | null | "unavailable";
  /** Travel and Accommodation tab bodies (server-loaded, self-saving); see docs/booking-travel.md. */
  travelPanel?: ReactNode;
  accommodationPanel?: ReactNode;
}

/** Saved values the form started from; a field is sent only when the draft differs from it. */
type EditBaseline = {
  date: string; startTime: string; durationMinutes: number; notes: string;
  venueName: string; venueAddress: string; contactNameMain: string; contactPhoneMain: string; contactEmailMain: string;
  promoterId: string;
  taxNote: string;
};

function editBaseline(booking: BookingWithArtist): EditBaseline {
  return {
    date: booking.date,
    startTime: booking.start_time ? booking.start_time.slice(0, 5) : "10:30",
    durationMinutes: booking.duration_minutes || 0,
    notes: booking.notes || "",
    venueName: booking.venue_name ?? "",
    venueAddress: booking.venue_address ?? "",
    contactNameMain: booking.contact_name_main ?? "",
    contactPhoneMain: booking.contact_phone_main ?? "",
    contactEmailMain: booking.contact_email_main ?? "",
    promoterId: booking.promoter_id ?? "",
    taxNote: booking.tax_note ?? "",
  };
}

// Server trims these fields and stores blank as null; whitespace-only edits are not changes.
const sameText = (draft: string, saved: string) => draft.trim() === saved.trim();

/** Calendar-date label for a stored YYYY-MM-DD value, independent of the viewer zone. */
function savedDateLabel(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
  });
}

const UNCONFIRMED_SAVE =
  "Unable to save booking. The result could not be confirmed. Your changes are still on this page; open this booking in a new tab to check what was saved before saving again.";
const UNAVAILABLE_SAVE =
  "This booking was not found in your current workspace, so the changes were not saved. It may have been deleted or be outside your access. Your changes are still on this page; check Bookings before creating it again.";

const TABS = [
  "Performance",
  "Financial",
  "Travel",
  "Accommodation",
  "Documents",
  "Artist contacts",
] as const;

export function EventBookingClient({ booking, draftOwnerId, sameDayBookingCounts, holdPosition, today, payments = [], promoters, linkedEvent, travelPanel, accommodationPanel }: EventBookingClientProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = useRef(false);
  const draftRevision = useRef(0);
  const [isSaved, setIsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [feeError, setFeeError] = useState<BookingFeeError | null>(null);
  const [activeTab, setActiveTab] = useState("Performance");
  const feeFocusTarget = useRef<BookingFeeError["field"] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteInFlight = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const deleteQuestionId = useId();
  const deleteBlockedId = useId();
  // A booking that has an event cannot be deleted (migration 008); it can only be cancelled.
  const hasLinkedEvent = linkedEvent != null && linkedEvent !== "unavailable";
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  // Keyboard flow: opening moves focus to Cancel (the safe choice); Cancel returns it to Delete.
  const deleteFocusAfterRender = useRef<"cancel" | "trigger" | null>(null);
  useEffect(() => {
    const target = deleteFocusAfterRender.current;
    deleteFocusAfterRender.current = null;
    if (target === "cancel") deleteCancelRef.current?.focus();
    if (target === "trigger") deleteTriggerRef.current?.focus();
  }, [showDeleteConfirm]);
  const [pendingStatus, setPendingStatus] = useState<BookingStatus | null>(null);
  const statusInFlight = useRef(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState("");
  const [statusChangedTo, setStatusChangedTo] = useState<BookingStatus | null>(null);
  // "Cancel booking" asks first: for a converted booking it is final and cancels the event.
  const [confirmCancel, setConfirmCancel] = useState(false);
  // A save or status change is reported only once the refreshed server copy is rendered,
  // so the page never says "saved" next to stale totals or lists.
  const [isRefreshing, startRefresh] = useTransition();
  const refreshAfterWrite = () => startRefresh(() => router.refresh());
  const baseline = useRef<EditBaseline | null>(null);
  if (baseline.current === null) baseline.current = editBaseline(booking);
  // Fields sent by a save whose outcome was not confirmed: their stored value is unknown,
  // so they are resent with the current draft until a save is confirmed.
  const uncertainFields = useRef(new Set<string>());
  const [holdExpiresOn, setHoldExpiresOn] = useState(booking.hold_expires_on ?? "");

  // Form state - Performance tab
  const [bookingDate, setBookingDate] = useState(booking.date);
  const [feeAmount, setFeeAmount] = useState(() => formatBookingFeeInput(booking.fee_amount_minor, booking.fee_currency));
  const [feeCurrency, setFeeCurrency] = useState<string>(booking.fee_currency ?? "");
  const [feeDirty, setFeeDirty] = useState(false);
  const [feeBaseline, setFeeBaseline] = useState(() => ({ fee_amount_minor: booking.fee_amount_minor, fee_currency: booking.fee_currency }));
  const [feeSync, setFeeSync] = useState({ savedCurrency: booking.fee_currency, rebasePending: false, commissionHydrationPending: false });
  // Financial tab drafts: commission and tax note are saved with "Update booking", like the fee.
  const savedCommission = bookingCommission(booking);
  const [commissionType, setCommissionType] = useState<CommissionType | "">(savedCommission?.type ?? "");
  const [commissionValue, setCommissionValue] = useState(() => !savedCommission ? ""
    : savedCommission.type === "percent" ? formatBasisPoints(savedCommission.value)
    : formatBookingFeeInput(savedCommission.value, booking.fee_currency ?? "EUR"));
  const [commissionMode, setCommissionMode] = useState<CommissionMode>(savedCommission?.mode ?? DEFAULT_COMMISSION_MODE);
  const [commissionDirty, setCommissionDirty] = useState(false);
  const [commissionError, setCommissionError] = useState<string | null>(null);
  if (feeSync.savedCurrency !== booking.fee_currency) {
    setFeeSync({ savedCurrency: booking.fee_currency, rebasePending: true, commissionHydrationPending: true });
  } else if (feeSync.rebasePending && !feeDirty && !(commissionDirty && commissionType === "fixed")) {
    // Keep the rebase pending while edits are dirty. Rebase the clean pair together;
    // neither the fee nor an untouched fixed commission is relabelled in a new currency.
    setFeeSync({ ...feeSync, rebasePending: false, commissionHydrationPending: false });
    setFeeAmount(formatBookingFeeInput(booking.fee_amount_minor, booking.fee_currency));
    setFeeCurrency(booking.fee_currency ?? "");
    setFeeBaseline({ fee_amount_minor: booking.fee_amount_minor, fee_currency: booking.fee_currency });
    if (feeSync.commissionHydrationPending && !commissionDirty && (commissionType === "fixed" || savedCommission?.type === "fixed")) {
      setCommissionType(savedCommission?.type ?? "");
      setCommissionValue(!savedCommission ? "" : savedCommission.type === "percent" ? formatBasisPoints(savedCommission.value)
        : formatBookingFeeInput(savedCommission.value, booking.fee_currency));
      setCommissionMode(savedCommission?.mode ?? DEFAULT_COMMISSION_MODE);
    }
  }
  // A fixed artist default is in its own currency and a booking is created without a fee, so it
  // is prefilled here: when a booking that currently has no saved fee and no saved commission
  // gets a fee in that currency. While a fee is saved the default is not offered, so removing
  // the commission of a priced booking sticks. Nothing durable records "the default was already
  // offered": a booking whose fee was cleared and saved is again a booking without a fee, and
  // the prefill (always visible, with its notice, and editable before saving) is offered again.
  const artistDefault = artistDefaultCommission(booking.artist);
  const fixedDefaultPending = !savedCommission && booking.fee_currency === null && artistDefault?.type === "fixed";
  const [commissionPrefilled, setCommissionPrefilled] = useState(false);
  const applyFixedDefault = (nextCurrency: string) => {
    if (!fixedDefaultPending || !artistDefault) return false;
    const prefill = defaultCommissionPrefill(artistDefault, nextCurrency || null);
    if (prefill.status === "applied" && artistDefault.currency && (commissionPrefilled || (!commissionDirty && commissionType === ""))) {
      setCommissionType("fixed");
      setCommissionValue(formatBookingFeeInput(prefill.commission.value, artistDefault.currency));
      setCommissionMode(prefill.commission.mode);
      setCommissionDirty(true);
      setCommissionPrefilled(true);
      setCommissionError(null);
      return true;
    }
    if (prefill.status !== "applied" && commissionPrefilled) {
      // The untouched prefill does not follow the fee into another currency.
      setCommissionType("");
      setCommissionValue("");
      setCommissionMode(DEFAULT_COMMISSION_MODE);
      setCommissionDirty(false);
      setCommissionPrefilled(false);
      setCommissionError(null);
      return true;
    }
    return false;
  };
  // Neutral notice about the artist's fixed default: prefilled, or not prefilled because the
  // booking fee is in another currency (no conversion). Nothing is shown once a commission is saved.
  const feeCurrencyDraft = BOOKING_FEE_CURRENCIES.find((code) => code === feeCurrency);
  const commissionDefaultNotice = !artistDefault || artistDefault.type !== "fixed" || !artistDefault.currency || savedCommission
    ? null
    : commissionPrefilled
      ? `Prefilled from the artist's default commission (${formatArtistDefaultCommission(artistDefault)}). Saved with Update booking.`
      : commissionType === "" && feeCurrencyDraft && feeCurrencyDraft !== artistDefault.currency
        ? `The artist's default commission (${formatArtistDefaultCommission(artistDefault)}) is not prefilled: it is in ${artistDefault.currency} and this booking's fee is in ${feeCurrencyDraft}.`
        : null;
  const savedTaxNote = booking.tax_note ?? "";
  const [taxNote, setTaxNote] = useState(savedTaxNote);
  const hasPayments = !!payments && payments.length > 0;
  const deleteBlocked = hasPayments || hasLinkedEvent;
  // Owned here, not by the panel: the Financial tab content unmounts on a tab change.
  const paymentsState = useBookingPaymentsState(draftOwnerId, booking.workspace_id, booking.id, payments);
  // A payment draft restored after a reload is shown once, so it can be retried with its original
  // key (state adjusted during render, not in an effect: https://react.dev/learn/you-might-not-need-an-effect).
  const [restoredDraftShown, setRestoredDraftShown] = useState(false);
  if (paymentsState.restored && !restoredDraftShown) {
    setRestoredDraftShown(true);
    setActiveTab("Financial");
  }

  const [startTime, setStartTime] = useState(
    booking.start_time ? booking.start_time.slice(0, 5) : "10:30"
  );
  const [durationMinutes, setDurationMinutes] = useState(
    booking.duration_minutes || 0
  );
  const [notes, setNotes] = useState(booking.notes || "");

  // Venue fields
  const [venueName, setVenueName] = useState(booking.venue_name ?? "");
  const [venueAddress, setVenueAddress] = useState(booking.venue_address ?? "");
  const [eventType, setEventType] = useState("");
  const [expectedAudience, setExpectedAudience] = useState("");

  // Lineup fields (placeholder UI)
  const [openArtist1, setOpenArtist1] = useState("");
  const [openArtist2, setOpenArtist2] = useState("");
  const [closeArtist, setCloseArtist] = useState("");

  // Main contact and secondary contact placeholders
  const [contactNameMain, setContactNameMain] = useState(booking.contact_name_main ?? "");
  const [contactPhoneMain, setContactPhoneMain] = useState(booking.contact_phone_main ?? "");
  const [contactEmailMain, setContactEmailMain] = useState(booking.contact_email_main ?? "");
  const [contactNameSecondary, setContactNameSecondary] = useState("");
  const [contactPhoneSecondary, setContactPhoneSecondary] = useState("");
  const [contactEmailSecondary, setContactEmailSecondary] = useState("");
  const [promoterId, setPromoterId] = useState(booking.promoter_id ?? "");

  const artist = booking.artist;
  const artistDisplayName = artist.stage_name || artist.name || "Unknown";

  // Consume submit-only focus intent when Radix mounts the field, even from another tab.
  const focusFeeError = (field: BookingFeeError["field"], element: HTMLElement | null) => {
    if (element && feeFocusTarget.current === field) {
      feeFocusTarget.current = null;
      element.focus();
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60)
      .toString()
      .padStart(2, "0");
    const m = (mins % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  };

  const computeEndTime = () => {
    if (!startTime || !durationMinutes) return "-";
    const [h, m] = startTime.split(":").map(Number);
    const totalMins = h * 60 + m + durationMinutes;
    const endH = Math.floor((totalMins % (24 * 60)) / 60);
    const endM = totalMins % 60;
    return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
  };

  // Non-blocking notice for the draft date, using only server-projected counts.
  const sameDayCount = sameDayBookingCounts?.[bookingDate] ?? 0;
  const draftDateChanged = bookingDate !== booking.date;
  const sameDayNotice = sameDayBookingCounts === null
    ? "Other bookings for this date could not be checked."
    : sameDayCount > 0 ? sameDayWarning(sameDayCount) : null;

  // Status is always read from the server copy of the booking, never from a local draft.
  // A cancelled booking that has an event never reopens (008 BB009): rebooking is a new booking.
  const cancelledWithEvent = booking.status === "cancelled" && hasLinkedEvent;
  const statusTargets = (today ? allowedBookingTransitions(booking.status, booking.date, today) : [])
    .filter((target) => !(cancelledWithEvent && target === "in_progress"));
  const holdExpired = today ? isHoldExpired(booking, today) : false;
  const holdPriority = holdRankLabel(holdPosition ?? null);
  const completionHint = booking.status === "confirmed" && !!today && isPastBookingDate(booking.date, today);
  const savedHoldExpiry = booking.hold_expires_on ?? "";

  const handleStatusChange = async (target: BookingStatus) => {
    if (statusInFlight.current || isRefreshing) return;
    statusInFlight.current = true;
    setConfirmCancel(false);
    setPendingStatus(target);
    setStatusError(null);
    setStatusNotice("");
    setStatusChangedTo(null);
    try {
      const result = await updateBookingStatus(booking.id, target, booking.status);
      if (!result.success) {
        setStatusError(result.error || "Unable to update the booking status. Please try again.");
        return;
      }
      setHoldExpiresOn("");
      setStatusNotice(`Status changed to ${BOOKING_STATUS_LABELS[target].toLowerCase()}.`);
      setStatusChangedTo(target);
      refreshAfterWrite();
    } catch {
      setStatusError("Unable to confirm the status change. Reload the booking before retrying.");
    } finally {
      statusInFlight.current = false;
      setPendingStatus(null);
    }
  };

  const handleUpdateBooking = async () => {
    if (saveInFlight.current || isRefreshing) return;
    setIsSaved(false);
    setSaveError(null);
    setFeeError(null);
    if (!createBookingSchema.shape.date.safeParse(bookingDate).success) {
      setSaveError("Enter a valid booking date");
      return;
    }
    const uncertain = uncertainFields.current;
    const holdExpiryChanged = booking.status === "hold" &&
      (holdExpiresOn !== savedHoldExpiry || uncertain.has("hold_expires_on"));
    if (holdExpiryChanged && holdExpiresOn && !createBookingSchema.shape.date.safeParse(holdExpiresOn).success) {
      setSaveError("Enter a valid hold expiry date");
      return;
    }
    const fee = parseBookingFee(feeAmount, feeCurrency);
    if (feeDirty && !fee.success) {
      feeFocusTarget.current = fee.field;
      setFeeError(fee);
      setActiveTab("Financial");
      return;
    }
    // Commission: sent only when edited. A fixed amount is read in the fee currency of this draft.
    setCommissionError(null);
    let commissionPatch: { commission_type: CommissionType | null; commission_value: number | null; commission_mode: CommissionMode | null; expected_fee_currency?: BookingFeeCurrency } | null = null;
    if (commissionDirty || uncertain.has("commission_type")) {
      const failCommission = (message: string) => { setCommissionError(message); setActiveTab("Financial"); };
      if (commissionType === "") {
        commissionPatch = { commission_type: null, commission_value: null, commission_mode: null };
      } else if (commissionType === "percent") {
        const percent = parseCommissionPercent(commissionValue);
        if (!percent.success) return failCommission(percent.error);
        commissionPatch = { commission_type: "percent", commission_value: percent.data, commission_mode: commissionMode };
      } else {
        if (!feeDirty && feeCurrency !== (booking.fee_currency ?? "")) {
          // The saved fee currency changed under an unchanged fee draft: adopt it and let the
          // member re-check the amount, instead of reinterpreting it in the new currency.
          setFeeSync({ ...feeSync, rebasePending: false, commissionHydrationPending: false });
          setFeeAmount(formatBookingFeeInput(booking.fee_amount_minor, booking.fee_currency));
          setFeeCurrency(booking.fee_currency ?? "");
          setFeeBaseline({ fee_amount_minor: booking.fee_amount_minor, fee_currency: booking.fee_currency });
          return failCommission(COMMISSION_CURRENCY_CHANGED_MESSAGE);
        }
        const currency = BOOKING_FEE_CURRENCIES.find((code) => code === feeCurrency);
        if (!currency) return failCommission("Choose a booking fee currency before entering a fixed commission");
        const amount = parseMoneyAmount(commissionValue, currency, "commission amount");
        if (!amount.success) return failCommission(amount.error);
        const draftFee = fee.success ? fee.data.fee_amount_minor : null;
        if (commissionMode === "included" && draftFee !== null && amount.data > draftFee) return failCommission(COMMISSION_WITHIN_FEE_MESSAGE);
        commissionPatch = { commission_type: "fixed", commission_value: amount.data, commission_mode: commissionMode, expected_fee_currency: currency };
      }
    }
    if (taxNote.trim().length > MAX_TAX_NOTE_LENGTH) {
      setSaveError(`Tax note must be at most ${MAX_TAX_NOTE_LENGTH} characters`);
      setActiveTab("Financial");
      return;
    }
    saveInFlight.current = true;
    const submittedRevision = draftRevision.current;
    setIsSaving(true);

    // Send only what this editor changed since the values it loaded or last saved,
    // so a concurrent edit to another field is not overwritten with a stale copy.
    const saved = baseline.current ?? editBaseline(booking);
    const send = (field: string, changed: boolean) => changed || uncertain.has(field);
    const feePatch = feeDirty && fee.success && send("fee_amount_minor",
      fee.data.fee_amount_minor !== feeBaseline.fee_amount_minor || fee.data.fee_currency !== feeBaseline.fee_currency)
      ? fee.data : null;
    const submitted: EditBaseline = {
      date: bookingDate, startTime, durationMinutes, notes,
      venueName, venueAddress, contactNameMain, contactPhoneMain, contactEmailMain,
      promoterId,
      taxNote,
    };

    const patch = {
      ...(send("date", bookingDate !== saved.date) ? { date: bookingDate } : {}),
      ...(feePatch ?? {}),
      ...(commissionPatch ?? {}),
      ...(send("tax_note", !sameText(taxNote, saved.taxNote)) ? { tax_note: taxNote } : {}),
      ...(holdExpiryChanged ? { hold_expires_on: holdExpiresOn || null } : {}),
      ...(send("promoter_id", promoterId !== saved.promoterId) ? { promoter_id: promoterId || null } : {}),
      ...(send("start_time", startTime !== saved.startTime) ? { start_time: startTime } : {}),
      ...(send("duration_minutes", durationMinutes !== saved.durationMinutes) ? { duration_minutes: durationMinutes || null } : {}),
      ...(send("notes", notes !== saved.notes) ? { notes: notes || null } : {}),
      ...(send("venue_name", !sameText(venueName, saved.venueName)) ? { venue_name: venueName } : {}),
      ...(send("venue_address", !sameText(venueAddress, saved.venueAddress)) ? { venue_address: venueAddress } : {}),
      ...(send("contact_name_main", !sameText(contactNameMain, saved.contactNameMain)) ? { contact_name_main: contactNameMain } : {}),
      ...(send("contact_phone_main", !sameText(contactPhoneMain, saved.contactPhoneMain)) ? { contact_phone_main: contactPhoneMain } : {}),
      ...(send("contact_email_main", !sameText(contactEmailMain, saved.contactEmailMain)) ? { contact_email_main: contactEmailMain } : {}),
    };

    try {
      const result = await updateBooking(booking.id, patch);
      if (!result.success) {
        setSaveError(result.error === "Booking not found"
          ? UNAVAILABLE_SAVE
          : result.error || "Unable to save booking. Please try again.");
        // Load the saved currency so the next save adopts it before re-checking the amount.
        if (result.error === COMMISSION_CURRENCY_CHANGED_MESSAGE) router.refresh();
        return;
      }
      baseline.current = submitted;
      if (feePatch) setFeeBaseline(feePatch);
      if (feePatch || commissionPatch) {
        // A fee acknowledgement supersedes the deferred rebase. A commission-only
        // acknowledgement skips only stale commission hydration, not the fee rebase.
        setFeeSync((current) => current.rebasePending
          ? { ...current, rebasePending: !feePatch, commissionHydrationPending: false }
          : current);
      }
      uncertain.clear();
      setFeeDirty(false);
      setCommissionDirty(false);
      setCommissionPrefilled(false);
      setIsSaved(draftRevision.current === submittedRevision);
      refreshAfterWrite();
    } catch {
      // The write may have committed: keep these fields in every later save until one is confirmed.
      for (const field of Object.keys(patch)) uncertain.add(field);
      setSaveError(UNCONFIRMED_SAVE);
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteInFlight.current || deleteBlocked) return;
    deleteInFlight.current = true;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const result = await deleteBooking(booking.id);
      if (result.success) {
        router.push("/dashboard/bookings");
      } else if (result.error === BOOKING_EVENT_COPY.bookingHasEvent) {
        // An event was linked meanwhile (another tab): keep the booking and show the link.
        setShowDeleteConfirm(false);
        setDeleteError(BOOKING_EVENT_COPY.bookingHasEvent);
        router.refresh();
      } else {
        // Only the fixed "has payments" copy is shown as returned; anything else stays generic.
        setDeleteError(result.error === BOOKING_HAS_PAYMENTS_MESSAGE ? BOOKING_HAS_PAYMENTS_MESSAGE : "Unable to delete booking. Please try again.");
      }
    } catch {
      setDeleteError(
        "Unable to confirm deletion. Check the booking list before retrying."
      );
    } finally {
      deleteInFlight.current = false;
      setIsDeleting(false);
    }
  };

  const realName = artist.surname
    ? `${artist.name || ""} ${artist.surname}`.trim()
    : artist.name || "";

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto" onChangeCapture={() => { draftRevision.current += 1; setIsSaved(false); }}>
      {/* Card container */}
      <div className="min-w-0 bg-card border border-border rounded-xl shadow-sm">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 border-b border-border">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">
              Event booking
            </h1>
            <Badge variant={bookingStatusBadgeVariant(booking.status)} aria-label={`Status: ${BOOKING_STATUS_LABELS[booking.status]}`}>
              {BOOKING_STATUS_LABELS[booking.status]}
            </Badge>
          </div>
          <Link
            href="/dashboard/bookings"
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close booking, back to Bookings"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>

        {/* Artist summary bar */}
        <div className="grid min-w-0 gap-4 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] bg-muted/30 border-b border-border">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar className="h-14 w-14 shrink-0">
              <AvatarImage
                src={artist.profile_image_url || undefined}
                alt={artistDisplayName}
              />
              <AvatarFallback className="bg-muted text-foreground">
                {getInitials(artistDisplayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 break-words">
              <h2 className="font-semibold text-lg text-foreground">
                {artistDisplayName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {realName || "Name unknown"}
              </p>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(5rem,1fr)_minmax(0,auto)] items-start gap-4 break-words xl:text-right">
            <div>
              <p className="text-sm text-foreground">
                {artist.location || "Location N/A"}
              </p>
              <p className="text-xs text-muted-foreground">Location</p>
            </div>
            <div>
              <p className="font-semibold text-lg text-foreground">
                {formatArtistBaseRate(artist.fee, artist.currency)}
              </p>
              <p className="text-xs text-muted-foreground">Base rate</p>
            </div>
          </div>
        </div>

        {/* Status: transitions are separate from "Update booking" and apply immediately. */}
        <section aria-labelledby="booking-status-heading" className="space-y-3 border-b border-border px-4 py-4 sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 id="booking-status-heading" className="text-base font-medium text-foreground">Status</h2>
            <Badge variant={bookingStatusBadgeVariant(booking.status)}>{BOOKING_STATUS_LABELS[booking.status]}</Badge>
            {holdExpired && <Badge variant="destructive">Hold expired</Badge>}
            {holdPriority && <Badge variant="outline">{holdPriority}</Badge>}
          </div>
          <p id="booking-status-scope" className="text-sm text-muted-foreground">
            Status changes apply immediately to the saved booking on {savedDateLabel(booking.date)}.
            Other edits on this page are saved only with Update booking.
          </p>
          {draftDateChanged && (
            <p className="text-sm text-foreground">
              The booking date below is changed but not saved. Status{holdPriority ? ", hold priority" : ""} and
              hold expiry still refer to the saved date, {savedDateLabel(booking.date)}.
            </p>
          )}
          {holdExpired && (
            <p className="text-sm text-muted-foreground">
              The hold expiry date has passed. The booking stays on hold until you change its status; nothing was cancelled.
            </p>
          )}
          {completionHint && (
            <p className="text-sm text-muted-foreground">This show date has passed. Mark as completed once the show has taken place.</p>
          )}
          {(booking.status === "completed" || statusTargets.includes("completed")) && (
            <p className="text-sm text-muted-foreground">Completed means the show took place. It does not record a payment.</p>
          )}
          {booking.status === "hold" && (
            <div className="max-w-xs">
              <label htmlFor="booking-hold-expiry" className="mb-1.5 block text-xs font-medium text-foreground">
                Hold expires on (optional)
              </label>
              <Input
                id="booking-hold-expiry"
                type="date"
                value={holdExpiresOn}
                onChange={(event) => setHoldExpiresOn(event.target.value)}
                disabled={isSaving}
                aria-describedby="booking-hold-expiry-help"
                className="h-9 min-w-0 text-sm"
              />
              <p id="booking-hold-expiry-help" className="mt-1.5 text-xs text-muted-foreground">
                Saved with Update booking. After this date the hold is flagged as expired; it is not cancelled or changed automatically.
              </p>
            </div>
          )}
          {statusTargets.length > 0 ? (
            <div role="group" aria-label="Change status" className="flex min-w-0 flex-wrap gap-2">
              {statusTargets.map((target) => (
                <Button
                  key={target}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (pendingStatus !== null || isRefreshing) return;
                    if (target === "cancelled") setConfirmCancel(true);
                    else void handleStatusChange(target);
                  }}
                  aria-disabled={pendingStatus !== null || isRefreshing}
                  className="h-auto min-h-9 whitespace-normal aria-disabled:cursor-wait aria-disabled:opacity-50"
                >
                  {pendingStatus === target ? "Updating..." : BOOKING_TRANSITION_LABELS[target]}
                </Button>
              ))}
            </div>
          ) : cancelledWithEvent ? null : (
            <p className="text-sm text-muted-foreground">
              {booking.status === "completed" ? "A completed booking cannot change status." : "No status change is available right now."}
            </p>
          )}
          {cancelledWithEvent && (
            <p className="text-sm text-muted-foreground">
              {`This booking has an event and was cancelled, so it cannot be reopened. ${BOOKING_EVENT_COPY.rebook} `}
              <Link href={`/dashboard/artists/${booking.artist_id}`} className="font-medium text-foreground underline underline-offset-4">
                {`Open ${artistDisplayName} to create a new booking`}
              </Link>
            </p>
          )}
          <Dialog open={confirmCancel} onOpenChange={(open) => { if (!open) setConfirmCancel(false); }}>
            <DialogContent showCloseButton={false} role="alertdialog">
              <DialogHeader>
                <DialogTitle>Cancel this booking?</DialogTitle>
                <DialogDescription>
                  {cancelBookingConfirmCopy(linkedEvent === "unavailable" ? "unknown" : hasLinkedEvent)}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmCancel(false)} autoFocus>
                  Keep booking
                </Button>
                <Button type="button" variant="destructive" onClick={() => handleStatusChange("cancelled")}>
                  Yes, cancel booking
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {statusError && <p role="alert" className="text-sm text-destructive">{statusError}</p>}
          {isRefreshing && statusNotice && (
            <p role="status" className="text-sm text-muted-foreground">Updating the page...</p>
          )}
          {statusNotice && !isRefreshing && <p role="status" className="text-sm text-foreground">{statusNotice}</p>}
          {statusNotice && statusChangedTo && !isRefreshing && (
            <p className="text-sm">
              <Link href={`/dashboard/bookings?status=${statusChangedTo}`} className="underline underline-offset-4">
                {`View ${BOOKING_STATUS_LABELS[statusChangedTo].toLowerCase()} bookings`}
              </Link>
            </p>
          )}
        </section>

        {linkedEvent !== undefined && (
          <BookingEventLink bookingId={booking.id} status={booking.status} linkedEvent={linkedEvent} />
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0 min-w-0">
          <div className="px-4 py-3 sm:px-6 border-b border-border">
            <TabsList aria-label="Booking sections" className="grid h-auto w-full grid-cols-2 gap-1 bg-transparent p-0 sm:grid-cols-3 xl:flex xl:justify-start">
              {TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab.replaceAll(" ", "-")} className="min-h-10 min-w-0 whitespace-normal px-3 py-2 xl:flex-none data-[state=active]:bg-muted data-[state=active]:shadow-none">
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="Performance" className="min-w-0 px-4 py-6 sm:px-6">
            <div className="space-y-8">
              {/* Performance date & time */}
              <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <h3 className="text-base font-medium text-foreground mb-3">
                    Performance date
                  </h3>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <label htmlFor="booking-date" className="mb-1.5 block text-xs font-medium text-foreground">
                      Booking date
                    </label>
                    <Input
                      id="booking-date"
                      type="date"
                      required
                      value={bookingDate}
                      onChange={(event) => setBookingDate(event.target.value)}
                      disabled={isSaving}
                      aria-describedby={sameDayNotice ? "booking-same-day" : undefined}
                      className="h-9 min-w-0 text-sm"
                    />
                    {sameDayNotice && (
                      <p id="booking-same-day" role="status" className="mt-2 text-sm text-muted-foreground">
                        {draftDateChanged && <span>{`For the new date ${savedDateLabel(bookingDate)} (not saved yet): `}</span>}
                        <span>{sameDayNotice}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-medium text-foreground mb-3">
                    Performance time
                  </h3>
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label htmlFor="booking-start-time" className="text-xs font-medium text-foreground mb-1.5 block">
                          Start time
                        </label>
                        <div className="relative">
                          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            id="booking-start-time"
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="min-w-0 pl-8 h-9 text-sm"
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="booking-duration" className="text-xs font-medium text-foreground mb-1.5 block">
                          Duration
                        </label>
                        <Input
                          id="booking-duration"
                          type="time"
                          value={formatDuration(durationMinutes)}
                          onChange={(e) => {
                            const [h, m] = e.target.value
                              .split(":")
                              .map(Number);
                            setDurationMinutes((h || 0) * 60 + (m || 0));
                          }}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="booking-end-time" className="text-xs font-medium text-foreground mb-1.5 block">
                          End time
                        </label>
                        <Input
                          id="booking-end-time"
                          readOnly
                          value={computeEndTime()}
                          className="min-w-0 h-9 border-transparent bg-muted/50 text-sm text-muted-foreground"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

                <p id="unavailable-booking-fields" className="text-sm text-muted-foreground">
                  Not available yet: event type, expected audience, lineup and secondary contact fields are not saved. Drivers are recorded per travel leg in the Travel tab.
                </p>
              {/* Venue & Additional details */}
              <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
                <div>
                  <h3 className="text-base font-medium text-foreground mb-3">
                    Venue
                  </h3>
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="venue-name" className="text-xs font-medium text-foreground mb-1.5 block">
                          Venue name
                        </label>
                        <Input
                          placeholder="Venue name"
                          id="venue-name"
                          value={venueName}
                          onChange={(e) => setVenueName(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                      <div>
                        <label htmlFor="venue-address" className="text-xs font-medium text-foreground mb-1.5 block">
                          Venue address
                        </label>
                        <Input
                          placeholder="Venue address"
                          id="venue-address"
                          value={venueAddress}
                          onChange={(e) => setVenueAddress(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <fieldset disabled aria-describedby="unavailable-booking-fields" className="min-w-0">
                  <h3 className="text-base font-medium text-foreground mb-3">
                    Additional details
                  </h3>
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Event type
                        </label>
                        <Input
                          placeholder="Event type"
                          value={eventType}
                          onChange={(e) => setEventType(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Expected audience
                        </label>
                        <Input
                          placeholder="Expected audience"
                          value={expectedAudience}
                          onChange={(e) => setExpectedAudience(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                    </div>
                  </div>
                </fieldset>
              </div>

              <fieldset disabled aria-describedby="unavailable-booking-fields" className="min-w-0 space-y-8">
              {/* Lineup */}
              <div>
                <h3 className="text-base font-medium text-foreground mb-3">
                  Lineup
                </h3>
                <div className="border border-border rounded-lg p-4">
                  <div className="grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Open artist
                      </label>
                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                          placeholder="Artist name"
                          value={openArtist1}
                          onChange={(e) => setOpenArtist1(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                        <Input
                          placeholder="Artist name"
                          value={openArtist2}
                          onChange={(e) => setOpenArtist2(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="bg-foreground text-background hover:bg-foreground/90 h-9"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add artist
                    </Button>
                    <div className="min-w-0">
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Close artist
                      </label>
                      <Input
                        placeholder="Artist name"
                        value={closeArtist}
                        onChange={(e) => setCloseArtist(e.target.value)}
                        className="min-w-0 h-9 text-sm placeholder:text-foreground"
                      />
                    </div>
                  </div>
                </div>
              </div>

              </fieldset>

              {/* Contact info */}
              <div>
                <h3 className="text-base font-medium text-foreground mb-3">
                  Contact info
                </h3>
                <div className="space-y-4">
                  {promoters !== undefined && (
                    <BookingPromoterSelect
                      id="booking-promoter"
                      value={promoterId}
                      onChange={setPromoterId}
                      options={promoters}
                      disabled={isSaving}
                      className="max-w-md"
                    />
                  )}
                  {/* Main contact */}
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label htmlFor="contact-name-main" className="text-xs font-medium text-foreground mb-1.5 block">
                          Contact name (main)
                        </label>
                        <Input
                          placeholder="Contact name"
                          id="contact-name-main"
                          value={contactNameMain}
                          onChange={(e) => setContactNameMain(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-phone-main" className="text-xs font-medium text-foreground mb-1.5 block">
                          Phone number
                        </label>
                        <Input
                          placeholder="Phone number"
                          id="contact-phone-main"
                          value={contactPhoneMain}
                          onChange={(e) => setContactPhoneMain(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-email-main" className="text-xs font-medium text-foreground mb-1.5 block">
                          Email
                        </label>
                        <Input
                          placeholder="Email"
                          id="contact-email-main"
                          type="email"
                          value={contactEmailMain}
                          onChange={(e) => setContactEmailMain(e.target.value)}
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Secondary contact */}
                  <fieldset disabled aria-describedby="unavailable-booking-fields" className="min-w-0 border border-border rounded-lg p-4">
                    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Contact name (secondary)
                        </label>
                        <Input
                          placeholder="Contact name"
                          value={contactNameSecondary}
                          onChange={(e) =>
                            setContactNameSecondary(e.target.value)
                          }
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Phone number
                        </label>
                        <Input
                          placeholder="Phone number"
                          value={contactPhoneSecondary}
                          onChange={(e) =>
                            setContactPhoneSecondary(e.target.value)
                          }
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Email
                        </label>
                        <Input
                          placeholder="Email"
                          value={contactEmailSecondary}
                          onChange={(e) =>
                            setContactEmailSecondary(e.target.value)
                          }
                          className="min-w-0 h-9 text-sm placeholder:text-foreground"
                        />
                      </div>
                    </div>
                  </fieldset>
                </div>
              </div>

              {/* Notes */}
              <div>
                <h3 className="text-base font-medium text-foreground mb-3">
                  <label htmlFor="booking-note">Note</label>
                </h3>
                <Textarea
                  id="booking-note"
                  placeholder="Type your note here."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-w-0 min-h-[100px] resize-y placeholder:text-foreground"
                />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="Financial" className="min-w-0 px-4 py-6 sm:px-6">
            <div className="max-w-xl space-y-4">
              <h2 className="text-base font-medium text-foreground">Booking fee</h2>
              <p id="booking-fee-help" className="text-sm text-muted-foreground">
                Recorded for this booking only. This does not change the artist&apos;s base rate or confirm the booking.
                Clear both fields to remove the fee. Enter amounts without grouping separators; JPY uses whole numbers.
              </p>
              <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="booking-fee-amount" className="mb-1.5 block text-xs font-medium text-foreground">
                    Booking fee amount
                  </label>
                  <Input
                    id="booking-fee-amount"
                    ref={(element) => focusFeeError("amount", element)}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={feeAmount}
                    onChange={(event) => { setFeeAmount(event.target.value); setFeeDirty(true); setFeeError(null); }}
                    disabled={isSaving}
                    aria-invalid={feeError?.field === "amount"}
                    aria-describedby={feeError?.field === "amount" ? "booking-fee-help booking-fee-amount-error" : "booking-fee-help"}
                    className="h-9 min-w-0 text-sm"
                  />
                  {feeError?.field === "amount" && (
                    <p id="booking-fee-amount-error" role="alert" className="mt-1.5 text-sm text-destructive">{feeError.error}</p>
                  )}
                </div>
                <div className="min-w-0">
                  <label htmlFor="booking-fee-currency" className="mb-1.5 block text-xs font-medium text-foreground">
                    Booking fee currency
                  </label>
                  <select
                    id="booking-fee-currency"
                    ref={(element) => focusFeeError("currency", element)}
                    value={feeCurrency}
                    onChange={(event) => {
                      setFeeCurrency(event.target.value); setFeeDirty(true); setFeeError(null);
                      if (applyFixedDefault(event.target.value)) return;
                      // A fixed commission is an amount in the fee currency: re-read it in the new one.
                      if (commissionType === "fixed") setCommissionDirty(true);
                    }}
                    disabled={isSaving || hasPayments}
                    aria-invalid={feeError?.field === "currency"}
                    aria-describedby={feeError?.field === "currency" ? "booking-fee-help booking-fee-currency-error" : "booking-fee-help"}
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive"
                  >
                    <option value="">Not specified</option>
                    {BOOKING_FEE_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                  {feeError?.field === "currency" && (
                    <p id="booking-fee-currency-error" role="alert" className="mt-1.5 text-sm text-destructive">{feeError.error}</p>
                  )}
                </div>
              </div>
              {hasPayments && (
                <p className="text-sm text-muted-foreground">
                  Payments are recorded for this booking: the fee amount can change, the fee currency cannot.
                </p>
              )}

              <h2 className="pt-4 text-base font-medium text-foreground">Agency commission</h2>
              <p id="booking-commission-help" className="text-sm text-muted-foreground">
                Saved with Update booking. New bookings start from the artist&apos;s default commission, if one is set;
                a fixed default applies only when the fee is in the same currency. A fixed amount is in the booking fee currency.
              </p>
              <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="booking-commission-type" className="mb-1.5 block text-xs font-medium text-foreground">
                    Commission type
                  </label>
                  <select
                    id="booking-commission-type"
                    value={commissionType}
                    onChange={(event) => {
                      setCommissionType(event.target.value as CommissionType | "");
                      setCommissionValue(""); setCommissionDirty(true); setCommissionError(null); setCommissionPrefilled(false);
                    }}
                    disabled={isSaving}
                    aria-describedby="booking-commission-help"
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <option value="">No commission</option>
                    <option value="percent">Percentage of the fee</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </div>
                {commissionType !== "" && (
                  <div className="min-w-0">
                    <label htmlFor="booking-commission-value" className="mb-1.5 block text-xs font-medium text-foreground">
                      {commissionType === "percent" ? "Commission percentage (%)" : `Commission amount (${feeCurrency || "fee currency"})`}
                    </label>
                    <Input
                      id="booking-commission-value"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={commissionValue}
                      onChange={(event) => { setCommissionValue(event.target.value); setCommissionDirty(true); setCommissionError(null); setCommissionPrefilled(false); }}
                      disabled={isSaving}
                      aria-invalid={commissionError !== null}
                      aria-describedby={commissionError ? "booking-commission-help booking-commission-error" : "booking-commission-help"}
                      className="h-9 min-w-0 text-sm"
                    />
                  </div>
                )}
                {commissionType !== "" && (
                  <div className="min-w-0 sm:col-span-2">
                    <label htmlFor="booking-commission-mode" className="mb-1.5 block text-xs font-medium text-foreground">
                      Commission mode
                    </label>
                    <select
                      id="booking-commission-mode"
                      value={commissionMode}
                      onChange={(event) => { setCommissionMode(event.target.value as CommissionMode); setCommissionDirty(true); setCommissionError(null); setCommissionPrefilled(false); }}
                      disabled={isSaving}
                      className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {COMMISSION_MODES.map((mode) => <option key={mode} value={mode}>{COMMISSION_MODE_LABELS[mode]}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {commissionError && (
                <p id="booking-commission-error" role="alert" className="text-sm text-destructive">{commissionError}</p>
              )}
              {commissionDefaultNotice && (
                <p id="booking-commission-default" className="text-sm text-muted-foreground">{commissionDefaultNotice}</p>
              )}

              <h2 className="pt-4 text-base font-medium text-foreground">
                <label htmlFor="booking-tax-note">Tax note</label>
              </h2>
              <Textarea
                id="booking-tax-note"
                value={taxNote}
                onChange={(event) => setTaxNote(event.target.value)}
                disabled={isSaving}
                maxLength={MAX_TAX_NOTE_LENGTH}
                aria-describedby="booking-tax-note-help"
                className="min-w-0 min-h-[80px] resize-y"
              />
              <p id="booking-tax-note-help" className="text-xs text-muted-foreground">
                Free text, saved with Update booking. No tax is calculated from it.
              </p>
            </div>
            <div className="mt-8 max-w-3xl border-t border-border pt-6">
              <BookingPayments
                bookingId={booking.id}
                feeMinor={booking.fee_amount_minor}
                feeCurrency={booking.fee_currency}
                commission={savedCommission}
                payments={payments}
                today={today}
                state={paymentsState}
                currencyChangePending={feeCurrency !== (booking.fee_currency ?? "")}
              />
            </div>
          </TabsContent>
          {/* Mounted while hidden so an unsaved travel or accommodation draft survives a tab switch. */}
          {travelPanel && (
            <TabsContent value="Travel" forceMount className="min-w-0 px-4 py-6 sm:px-6 data-[state=inactive]:hidden">
              {travelPanel}
            </TabsContent>
          )}
          {accommodationPanel && (
            <TabsContent value="Accommodation" forceMount className="min-w-0 px-4 py-6 sm:px-6 data-[state=inactive]:hidden">
              {accommodationPanel}
            </TabsContent>
          )}
          {TABS.filter((tab) => tab !== "Performance" && tab !== "Financial"
            && !(tab === "Travel" && travelPanel) && !(tab === "Accommodation" && accommodationPanel)).map((tab) => (
            <TabsContent key={tab} value={tab.replaceAll(" ", "-")} className="min-w-0 px-4 py-16 text-center sm:px-6">
              <h2 className="text-lg font-medium text-foreground mb-2">{tab}</h2>
              <p className="text-muted-foreground">This section is coming soon.</p>
            </TabsContent>
          ))}
        </Tabs>

        {/* Bottom actions */}
        <div className="flex flex-col gap-4 rounded-b-xl bg-card px-4 py-4 sm:px-6 lg:sticky lg:bottom-0 lg:z-10 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between border-t border-border">
          <div className="relative">
            {deleteError && !deleteBlocked && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {deleteError}
              </p>
            )}
            {deleteBlocked ? (
              // A booking with an event (008, BB011) or with any payment row (007 RESTRICT FK,
              // owner decision incl. voided or corrected rows) is cancelled, never deleted. The
              // database stays the authority; this only avoids a dead end.
              <div className="flex max-w-md flex-col gap-2">
                <Button variant="outline" disabled aria-describedby={deleteBlockedId}>
                  <Trash2 aria-hidden="true" className="h-4 w-4 mr-2" />
                  Delete
                </Button>
                <p id={deleteBlockedId} className="text-sm text-muted-foreground">
                  {hasLinkedEvent ? BOOKING_EVENT_COPY.bookingHasEvent : BOOKING_HAS_PAYMENTS_MESSAGE}
                </p>
              </div>
            ) : showDeleteConfirm ? (
              <div role="group" aria-labelledby={deleteQuestionId} className="flex flex-wrap items-center gap-2">
                <span id={deleteQuestionId} className="text-sm text-muted-foreground">
                  Delete this booking?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Yes, delete"}
                </Button>
                <Button
                  ref={deleteCancelRef}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    deleteFocusAfterRender.current = "trigger";
                    setShowDeleteConfirm(false);
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                ref={deleteTriggerRef}
                variant="outline"
                onClick={() => {
                  setDeleteError(null);
                  deleteFocusAfterRender.current = "cancel";
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {saveError && <p role="alert" className="max-w-md text-sm text-destructive">{saveError}</p>}
            <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-foreground">
              {isSaved ? (isRefreshing ? "Saving..." : "Booking saved.") : ""}
            </p>
            <Button
              variant="default"
              onClick={handleUpdateBooking}
              aria-disabled={isSaving || isRefreshing}
              className="aria-disabled:cursor-wait aria-disabled:opacity-50"
            >
              {isSaving || isRefreshing ? "Saving..." : "Update booking"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
