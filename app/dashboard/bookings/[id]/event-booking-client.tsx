"use client";

import { useRef, useState } from "react";
import { BOOKING_FEE_CURRENCIES, parseBookingFee, formatBookingFeeInput, type BookingFeeError } from "@/lib/booking-fee";
import { createBookingSchema } from "@/lib/booking-validation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Trash2, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

import { updateBooking, updateBookingStatus, deleteBooking, type Booking, type BookingWithArtist } from "@/lib/actions/bookings";
import {
  BOOKING_STATUS_LABELS, BOOKING_TRANSITION_LABELS, bookingStatusBadgeVariant, findSameDayBookings,
  holdRank, holdRankLabel, isHoldExpired, isPastBookingDate, sameDayWarning,
} from "@/lib/booking-display";
import { allowedBookingTransitions, type BookingStatus } from "@/lib/booking-status";
import { formatArtistBaseRate } from "@/lib/artist-base-rate";
import {
  BOOKING_HAS_PAYMENTS_MESSAGE, COMMISSION_MODES, COMMISSION_MODE_LABELS, COMMISSION_WITHIN_FEE_MESSAGE, DEFAULT_COMMISSION_MODE,
  MAX_TAX_NOTE_LENGTH, artistDefaultCommission, bookingCommission, defaultCommissionPrefill, formatArtistDefaultCommission,
  formatBasisPoints, parseCommissionPercent, parseMoneyAmount,
  type BookingPayment, type CommissionMode, type CommissionType,
} from "@/lib/booking-finance";
import { BookingPayments, useBookingPaymentsState } from "./booking-payments";

interface EventBookingClientProps {
  booking: BookingWithArtist;
  /** This artist's bookings from the existing scoped read; null when that read failed. */
  artistBookings?: readonly Booking[] | null;
  /** Server "today" (configured calendar zone). Without it, completion is not offered. */
  today?: string;
  /** Payments of this booking; null when that read failed (shown as an error, not as "none"). */
  payments?: readonly BookingPayment[] | null;
}

const TABS = [
  "Performance",
  "Financial",
  "Travel",
  "Accommodation",
  "Documents",
  "Artist contacts",
] as const;

export function EventBookingClient({ booking, artistBookings, today, payments = [] }: EventBookingClientProps) {
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
  const [pendingStatus, setPendingStatus] = useState<BookingStatus | null>(null);
  const statusInFlight = useRef(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState("");
  const [holdExpiresOn, setHoldExpiresOn] = useState(booking.hold_expires_on ?? "");

  // Form state - Performance tab
  const [bookingDate, setBookingDate] = useState(booking.date);
  const [feeAmount, setFeeAmount] = useState(() => formatBookingFeeInput(booking.fee_amount_minor, booking.fee_currency));
  const [feeCurrency, setFeeCurrency] = useState<string>(booking.fee_currency ?? "");
  const [feeDirty, setFeeDirty] = useState(false);
  // Financial tab drafts: commission and tax note are saved with "Update booking", like the fee.
  const savedCommission = bookingCommission(booking);
  const [commissionType, setCommissionType] = useState<CommissionType | "">(savedCommission?.type ?? "");
  const [commissionValue, setCommissionValue] = useState(() => !savedCommission ? ""
    : savedCommission.type === "percent" ? formatBasisPoints(savedCommission.value)
    : formatBookingFeeInput(savedCommission.value, booking.fee_currency ?? "EUR"));
  const [commissionMode, setCommissionMode] = useState<CommissionMode>(savedCommission?.mode ?? DEFAULT_COMMISSION_MODE);
  const [commissionDirty, setCommissionDirty] = useState(false);
  const [commissionError, setCommissionError] = useState<string | null>(null);
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
  // Owned here, not by the panel: the Financial tab content unmounts on a tab change.
  const paymentsState = useBookingPaymentsState();

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

  // Driver fields (placeholder UI)
  const [sameDriver, setSameDriver] = useState(true);
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverDistance, setDriverDistance] = useState("");

  // Main contact and secondary contact placeholders
  const [contactNameMain, setContactNameMain] = useState(booking.contact_name_main ?? "");
  const [contactPhoneMain, setContactPhoneMain] = useState(booking.contact_phone_main ?? "");
  const [contactEmailMain, setContactEmailMain] = useState(booking.contact_email_main ?? "");
  const [contactNameSecondary, setContactNameSecondary] = useState("");
  const [contactPhoneSecondary, setContactPhoneSecondary] = useState("");
  const [contactEmailSecondary, setContactEmailSecondary] = useState("");

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

  // Non-blocking notice for the draft date; the current booking and cancelled ones are excluded.
  const sameDayCount = artistBookings
    ? findSameDayBookings(artistBookings, { artistId: booking.artist_id, date: bookingDate, excludeId: booking.id }).length
    : 0;
  const sameDayNotice = artistBookings === null
    ? "Other bookings for this date could not be checked."
    : sameDayCount > 0 ? sameDayWarning(sameDayCount) : null;

  // Status is always read from the server copy of the booking, never from a local draft.
  const statusTargets = today ? allowedBookingTransitions(booking.status, booking.date, today) : [];
  const holdExpired = today ? isHoldExpired(booking, today) : false;
  const holdPriority = holdRankLabel(artistBookings ? holdRank(artistBookings, booking) : null);
  const completionHint = booking.status === "confirmed" && !!today && isPastBookingDate(booking.date, today);
  const savedHoldExpiry = booking.hold_expires_on ?? "";

  const handleStatusChange = async (target: BookingStatus) => {
    if (statusInFlight.current) return;
    statusInFlight.current = true;
    setPendingStatus(target);
    setStatusError(null);
    setStatusNotice("");
    try {
      const result = await updateBookingStatus(booking.id, target, booking.status);
      if (!result.success) {
        setStatusError(result.error || "Unable to update the booking status. Please try again.");
        return;
      }
      setHoldExpiresOn("");
      setStatusNotice(`Status changed to ${BOOKING_STATUS_LABELS[target].toLowerCase()}.`);
      router.refresh();
    } catch {
      setStatusError("Unable to confirm the status change. Reload the booking before retrying.");
    } finally {
      statusInFlight.current = false;
      setPendingStatus(null);
    }
  };

  const handleUpdateBooking = async () => {
    if (saveInFlight.current) return;
    setIsSaved(false);
    setSaveError(null);
    setFeeError(null);
    if (!createBookingSchema.shape.date.safeParse(bookingDate).success) {
      setSaveError("Enter a valid booking date");
      return;
    }
    const holdExpiryChanged = booking.status === "hold" && holdExpiresOn !== savedHoldExpiry;
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
    let commissionPatch: { commission_type: CommissionType | null; commission_value: number | null; commission_mode: CommissionMode | null } | null = null;
    if (commissionDirty) {
      const failCommission = (message: string) => { setCommissionError(message); setActiveTab("Financial"); };
      if (commissionType === "") {
        commissionPatch = { commission_type: null, commission_value: null, commission_mode: null };
      } else if (commissionType === "percent") {
        const percent = parseCommissionPercent(commissionValue);
        if (!percent.success) return failCommission(percent.error);
        commissionPatch = { commission_type: "percent", commission_value: percent.data, commission_mode: commissionMode };
      } else {
        const currency = BOOKING_FEE_CURRENCIES.find((code) => code === feeCurrency);
        if (!currency) return failCommission("Choose a booking fee currency before entering a fixed commission");
        const amount = parseMoneyAmount(commissionValue, currency, "commission amount");
        if (!amount.success) return failCommission(amount.error);
        const draftFee = fee.success ? fee.data.fee_amount_minor : null;
        if (commissionMode === "included" && draftFee !== null && amount.data > draftFee) return failCommission(COMMISSION_WITHIN_FEE_MESSAGE);
        commissionPatch = { commission_type: "fixed", commission_value: amount.data, commission_mode: commissionMode };
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

    try {
      const result = await updateBooking(booking.id, {
        ...(bookingDate !== booking.date ? { date: bookingDate } : {}),
        ...(feeDirty && fee.success ? fee.data : {}),
        ...(commissionPatch ?? {}),
        ...(taxNote !== savedTaxNote ? { tax_note: taxNote } : {}),
        ...(holdExpiryChanged ? { hold_expires_on: holdExpiresOn || null } : {}),
        start_time: startTime,
        duration_minutes: durationMinutes || null,
        notes: notes || null,
        venue_name: venueName,
        venue_address: venueAddress,
        contact_name_main: contactNameMain,
        contact_phone_main: contactPhoneMain,
        contact_email_main: contactEmailMain,
      });
      if (!result.success) {
        setSaveError(result.error || "Unable to save booking. Please try again.");
        return;
      }
      setFeeDirty(false);
      setCommissionDirty(false);
      setCommissionPrefilled(false);
      setIsSaved(draftRevision.current === submittedRevision);
      router.refresh();
    } catch {
      setSaveError("Unable to save booking. Please try again.");
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const result = await deleteBooking(booking.id);
      if (result.success) {
        router.push("/dashboard/bookings");
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
      {saveError && <p role="alert" className="mb-4 text-sm text-destructive">{saveError}</p>}
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
            aria-label="Close"
          >
            <X className="h-5 w-5" />
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
          {completionHint && (
            <p className="text-sm text-muted-foreground">This show date has passed. Mark as completed?</p>
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
                Saved with Update booking. An expired hold is only flagged, never changed automatically.
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
                  onClick={() => handleStatusChange(target)}
                  aria-disabled={pendingStatus !== null}
                  className="h-auto min-h-9 whitespace-normal aria-disabled:cursor-wait aria-disabled:opacity-50"
                >
                  {pendingStatus === target ? "Updating..." : BOOKING_TRANSITION_LABELS[target]}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {booking.status === "completed" ? "A completed booking cannot change status." : "No status change is available right now."}
            </p>
          )}
          {statusError && <p role="alert" className="text-sm text-destructive">{statusError}</p>}
          {statusNotice && <p role="status" className="text-sm text-foreground">{statusNotice}</p>}
        </section>

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
                        {sameDayNotice}
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
                  Not available yet: event type, expected audience, lineup, driver and secondary contact fields are not saved.
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

              {/* Driver inbound */}
              <div>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <h3 className="text-base font-medium text-foreground">
                    Driver inbound
                  </h3>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      disabled
                      id="same-driver"
                      checked={sameDriver}
                      onCheckedChange={(checked) =>
                        setSameDriver(checked === true)
                      }
                    />
                    <label
                      htmlFor="same-driver"
                      className="text-sm text-foreground cursor-not-allowed"
                    >
                      Same driver Inbound/Outbound
                    </label>
                  </div>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Driver name
                      </label>
                      <Input
                        placeholder="Driver name"
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        className="min-w-0 h-9 text-sm placeholder:text-foreground"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Driver phone number
                      </label>
                      <Input
                        placeholder="Driver phone number"
                        value={driverPhone}
                        onChange={(e) => setDriverPhone(e.target.value)}
                        className="min-w-0 h-9 text-sm placeholder:text-foreground"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Distance
                      </label>
                      <Input
                        placeholder="Distance"
                        value={driverDistance}
                        onChange={(e) => setDriverDistance(e.target.value)}
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
              />
            </div>
          </TabsContent>
          {TABS.filter((tab) => tab !== "Performance" && tab !== "Financial").map((tab) => (
            <TabsContent key={tab} value={tab.replaceAll(" ", "-")} className="min-w-0 px-4 py-16 text-center sm:px-6">
              <h2 className="text-lg font-medium text-foreground mb-2">{tab}</h2>
              <p className="text-muted-foreground">This section is coming soon.</p>
            </TabsContent>
          ))}
        </Tabs>

        {/* Bottom actions */}
        <div className="flex flex-col gap-4 rounded-b-xl bg-card px-4 py-4 sm:px-6 lg:sticky lg:bottom-0 lg:z-10 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between border-t border-border">
          <div className="relative">
            {deleteError && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {deleteError}
              </p>
            )}
            {showDeleteConfirm ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Are you sure?
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
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteError(null);
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-foreground">
              {isSaved ? "Booking saved." : ""}
            </p>
            <Button
              variant="default"
              onClick={handleUpdateBooking}
              aria-disabled={isSaving}
              className="aria-disabled:cursor-wait aria-disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Update booking"}
            </Button>
            <Button
              variant="outline"
              className="whitespace-normal h-auto min-h-9"
              disabled
              title="Coming soon"
            >
              Complete and create event
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
