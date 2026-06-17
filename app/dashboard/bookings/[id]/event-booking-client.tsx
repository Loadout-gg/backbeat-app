"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Trash2, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateBooking, deleteBooking, type BookingWithArtist } from "@/lib/actions/bookings";

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

type TabValue = (typeof TABS)[number];

export function EventBookingClient({ booking }: EventBookingClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabValue>("Performance");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form state - Performance tab
  const [startTime, setStartTime] = useState(
    booking.start_time ? booking.start_time.slice(0, 5) : "10:30"
  );
  const [amPm, setAmPm] = useState<"AM" | "PM">(() => {
    if (!booking.start_time) return "PM";
    const hour = parseInt(booking.start_time.split(":")[0], 10);
    return hour >= 12 ? "PM" : "AM";
  });
  const [durationMinutes, setDurationMinutes] = useState(
    booking.duration_minutes || 0
  );
  const [notes, setNotes] = useState(booking.notes || "");

  // Venue fields (not stored in DB yet - placeholder UI)
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
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

  // Contact info (placeholder UI)
  const [contactNameMain, setContactNameMain] = useState("");
  const [contactPhoneMain, setContactPhoneMain] = useState("");
  const [contactEmailMain, setContactEmailMain] = useState("");
  const [contactNameSecondary, setContactNameSecondary] = useState("");
  const [contactPhoneSecondary, setContactPhoneSecondary] = useState("");
  const [contactEmailSecondary, setContactEmailSecondary] = useState("");

  const artist = booking.artist;

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatCurrency = (amount: number | null, currency?: string | null) => {
    if (!amount) return "N/A";
    const symbol = currency === "EUR" ? "\u20AC" : "$";
    return `${symbol}${amount.toLocaleString()}`;
  };

  const formatBookingDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    };
    const formatted = d.toLocaleDateString("en-US", options);
    const parts = formatted.split(", ");
    if (parts.length === 3) {
      return `${parts[1]}, ${parts[2]} (${parts[0]})`;
    }
    return formatted;
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
    let totalMins = h * 60 + m + durationMinutes;
    // Adjust for AM/PM
    if (amPm === "PM" && h < 12) totalMins += 12 * 60;
    if (amPm === "AM" && h === 12) totalMins -= 12 * 60;
    const endH = Math.floor((totalMins % (24 * 60)) / 60);
    const endM = totalMins % 60;
    const endAmPm = endH >= 12 ? "PM" : "AM";
    const display12h = endH > 12 ? endH - 12 : endH === 0 ? 12 : endH;
    return `${display12h}:${endM.toString().padStart(2, "0")} ${endAmPm}`;
  };

  const handleUpdateBooking = async () => {
    setIsSaving(true);
    // Convert 12h to 24h for storage
    let [h, m] = startTime.split(":").map(Number);
    if (amPm === "PM" && h < 12) h += 12;
    if (amPm === "AM" && h === 12) h = 0;
    const time24 = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

    await updateBooking(booking.id, {
      start_time: time24,
      duration_minutes: durationMinutes || null,
      notes: notes || null,
    });
    setIsSaving(false);
    router.refresh();
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
    <div className="max-w-5xl mx-auto">
      {/* Card container */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {/* Header row */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
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
        <div className="flex items-center justify-between px-6 py-4 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarImage
                src={artist.profile_image_url || undefined}
                alt={artist.stage_name}
              />
              <AvatarFallback className="bg-muted text-muted-foreground">
                {getInitials(artist.stage_name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="font-semibold text-lg text-foreground">
                {artist.stage_name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {realName || "Name unknown"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-right">
            <div>
              <p className="text-sm text-foreground">
                {artist.location || "Location N/A"}
              </p>
              <p className="text-xs text-muted-foreground">Location</p>
            </div>
            <div>
              <p className="font-semibold text-lg text-foreground">
                {formatCurrency(artist.fee, artist.currency)}
              </p>
              <p className="text-xs text-muted-foreground">Base rate</p>
            </div>
          </div>
        </div>

        {/* Tabs row */}
        <div className="px-6 border-b border-border">
          <div className="flex gap-0">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="px-6 py-6">
          {activeTab === "Performance" && (
            <div className="space-y-8">
              {/* Performance date & time */}
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <h3 className="text-base font-medium text-foreground mb-3 text-muted-foreground/80">
                    Performance date
                  </h3>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="font-medium text-foreground">
                      {formatBookingDate(booking.date)}
                    </p>
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-medium text-muted-foreground/80 mb-3">
                    Performance time
                  </h3>
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Start time
                        </label>
                        <div className="relative">
                          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="pl-8 h-9 text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          &nbsp;
                        </label>
                        <Select
                          value={amPm}
                          onValueChange={(v) => setAmPm(v as "AM" | "PM")}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="AM">AM</SelectItem>
                            <SelectItem value="PM">PM</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Duration
                        </label>
                        <Input
                          type="time"
                          value={formatDuration(durationMinutes)}
                          onChange={(e) => {
                            const [h, m] = e.target.value
                              .split(":")
                              .map(Number);
                            setDurationMinutes((h || 0) * 60 + (m || 0));
                          }}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div>
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

              {/* Venue & Additional details */}
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <h3 className="text-base font-medium text-muted-foreground/80 mb-3">
                    Venue
                  </h3>
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Venue name
                        </label>
                        <Input
                          placeholder="Venue name"
                          value={venueName}
                          onChange={(e) => setVenueName(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Venue Address
                        </label>
                        <Input
                          placeholder="Venue address"
                          value={venueAddress}
                          onChange={(e) => setVenueAddress(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-medium text-muted-foreground/80 mb-3">
                    Additional details
                  </h3>
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Event Type
                        </label>
                        <Input
                          placeholder="Event type"
                          value={eventType}
                          onChange={(e) => setEventType(e.target.value)}
                          className="h-9 text-sm"
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
                          className="h-9 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lineup */}
              <div>
                <h3 className="text-base font-medium text-muted-foreground/80 mb-3">
                  Lineup
                </h3>
                <div className="border border-border rounded-lg p-4">
                  <div className="flex items-end gap-4">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Open artist
                      </label>
                      <div className="flex gap-3">
                        <Input
                          placeholder="Artist name"
                          value={openArtist1}
                          onChange={(e) => setOpenArtist1(e.target.value)}
                          className="h-9 text-sm"
                        />
                        <Input
                          placeholder="Artist name"
                          value={openArtist2}
                          onChange={(e) => setOpenArtist2(e.target.value)}
                          className="h-9 text-sm"
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
                    <div className="flex-1 max-w-[200px]">
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Close artist
                      </label>
                      <Input
                        placeholder="Artist name"
                        value={closeArtist}
                        onChange={(e) => setCloseArtist(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Driver inbound */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-base font-medium text-muted-foreground/80">
                    Driver inbound
                  </h3>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="same-driver"
                      checked={sameDriver}
                      onCheckedChange={(checked) =>
                        setSameDriver(checked === true)
                      }
                    />
                    <label
                      htmlFor="same-driver"
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      Same driver Inbound/Outbound
                    </label>
                  </div>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1.5 block">
                        Driver name
                      </label>
                      <Input
                        placeholder="Driver name"
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        className="h-9 text-sm"
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
                        className="h-9 text-sm"
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
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact info */}
              <div>
                <h3 className="text-base font-medium text-muted-foreground/80 mb-3">
                  Contact info
                </h3>
                <div className="space-y-4">
                  {/* Main contact */}
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Contact name (main)
                        </label>
                        <Input
                          placeholder="Contact name"
                          value={contactNameMain}
                          onChange={(e) => setContactNameMain(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Phone number
                        </label>
                        <Input
                          placeholder="Phone number"
                          value={contactPhoneMain}
                          onChange={(e) => setContactPhoneMain(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1.5 block">
                          Email
                        </label>
                        <Input
                          placeholder="Email"
                          value={contactEmailMain}
                          onChange={(e) => setContactEmailMain(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Secondary contact */}
                  <div className="border border-border rounded-lg p-4">
                    <div className="grid grid-cols-3 gap-4">
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
                          className="h-9 text-sm"
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
                          className="h-9 text-sm"
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
                          className="h-9 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <h3 className="text-base font-medium text-muted-foreground/80 mb-3">
                  Note
                </h3>
                <Textarea
                  placeholder="Type your note here."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[100px] resize-y"
                />
              </div>
            </div>
          )}

          {/* Other tabs - Coming soon */}
          {activeTab !== "Performance" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-lg font-medium text-foreground mb-2">
                {activeTab}
              </p>
              <p className="text-muted-foreground">
                This section is coming soon.
              </p>
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div className="relative">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleUpdateBooking}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Update booking"}
            </Button>
            <Button
              className="bg-foreground text-background hover:bg-foreground/90"
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
