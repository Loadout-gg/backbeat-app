"use client";

import { useRef, useState } from "react";
import { BOOKING_FEE_CURRENCIES, parseBookingFee, formatBookingFeeInput, type BookingFeeError } from "@/lib/booking-fee";
import { createBookingSchema } from "@/lib/booking-validation";
import { useRouter } from "next/navigation";
import { X, Trash2, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { updateBooking, deleteBooking, type BookingWithArtist } from "@/lib/actions/bookings";
import { formatArtistBaseRate } from "@/lib/artist-base-rate";

interface EventBookingClientProps {
  booking: BookingWithArtist;
}

const TABS = [
  "Performance",
  "Financial",
  "Travel",
  "Accommodation",
  "Documents",
  "Artist contacts",
] as const;

export function EventBookingClient({ booking }: EventBookingClientProps) {
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form state - Performance tab
  const [bookingDate, setBookingDate] = useState(booking.date);
  const [feeAmount, setFeeAmount] = useState(() => formatBookingFeeInput(booking.fee_amount_minor, booking.fee_currency));
  const [feeCurrency, setFeeCurrency] = useState<string>(booking.fee_currency ?? "");
  const [feeDirty, setFeeDirty] = useState(false);

  const [startTime, setStartTime] = useState(
    booking.start_time ? booking.start_time.slice(0, 5) : "10:30"
  );
  const amPm = startTime ? (Number(startTime.split(":")[0]) >= 12 ? "PM" : "AM") : "-";
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
    const endAmPm = endH >= 12 ? "PM" : "AM";
    const display12h = endH > 12 ? endH - 12 : endH === 0 ? 12 : endH;
    return `${display12h}:${endM.toString().padStart(2, "0")} ${endAmPm}`;
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
    const fee = parseBookingFee(feeAmount, feeCurrency);
    if (feeDirty && !fee.success) {
      feeFocusTarget.current = fee.field;
      setFeeError(fee);
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
    setIsDeleting(true);
    const result = await deleteBooking(booking.id);
    setIsDeleting(false);
    if (result.success) {
      router.push("/dashboard");
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
          <h1 className="text-xl font-semibold text-foreground">
            Event Booking
          </h1>
          <button
            onClick={() => router.back()}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Artist summary bar */}
        <div className="grid min-w-0 gap-4 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] bg-muted/30 border-b border-border">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar className="h-14 w-14 shrink-0">
              <AvatarImage
                src={artist.profile_image_url || undefined}
                alt={artist.stage_name}
              />
              <AvatarFallback className="bg-muted text-foreground">
                {getInitials(artist.stage_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 break-words">
              <h2 className="font-semibold text-lg text-foreground">
                {artist.stage_name}
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
                      className="h-9 min-w-0 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-medium text-foreground mb-3">
                    Performance time
                  </h3>
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_3.5rem] gap-3 sm:grid-cols-[minmax(0,1.3fr)_3.5rem_minmax(0,1fr)_minmax(0,1fr)]">
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
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          &nbsp;
                        </label>
                        <div aria-label="Start time period" className="flex items-center h-9 px-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
                          {amPm}
                        </div>
                      </div>
                      <div className="col-span-2 min-w-0 sm:col-span-1">
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
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          End time
                        </label>
                        <div className="flex items-center h-9 px-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
                          {computeEndTime()}
                        </div>
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
                          Venue Address
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
                          Event Type
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
                Recorded for this booking only. This does not change the artist&apos;s base rate, confirm the booking, or record a payment.
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
                    onChange={(event) => { setFeeCurrency(event.target.value); setFeeDirty(true); setFeeError(null); }}
                    disabled={isSaving}
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
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
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
