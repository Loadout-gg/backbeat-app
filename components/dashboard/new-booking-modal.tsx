"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Clock, Calendar, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getArtists, type Artist } from "@/lib/actions/artists";
import { createBooking, type Booking } from "@/lib/actions/bookings";
import { formatArtistBaseRate } from "@/lib/artist-base-rate";

type ModalStep = "select-artist" | "booking-details" | "success";

interface NewBookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedArtist?: Artist | null;
}

export function NewBookingModal({
  open,
  onOpenChange,
  preselectedArtist,
}: NewBookingModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<ModalStep>(
    preselectedArtist ? "booking-details" : "select-artist"
  );
  const [artists, setArtists] = useState<Artist[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(
    preselectedArtist || null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);

  // Form state
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:30");
  const [duration, setDuration] = useState("00:00");
  const [notes, setNotes] = useState("");

  // Load artists when modal opens at step 1
  useEffect(() => {
    if (open && !preselectedArtist) {
      // This controlled modal stays mounted; loading starts on each external open transition.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(true);
      getArtists()
        .then(setArtists)
        .finally(() => setIsLoading(false));
    }
  }, [open, preselectedArtist]);

  const previousSelection = useRef<{ open: boolean; artistId?: string }>({ open: false });

  // Reset only for a new modal session or a different artist, not an RSC refresh.
  useEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = { open, artistId: preselectedArtist?.id };
    if (open && (!previous.open || previous.artistId !== preselectedArtist?.id)) {
      if (preselectedArtist) {
        // A controlled open/artist transition initializes this modal's draft.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedArtist(preselectedArtist);
        setStep("booking-details");
      } else {
        setStep("select-artist");
        setSelectedArtist(null);
      }
      setSearchQuery("");
      setDate("");
      setStartTime("10:30");
      setDuration("00:00");
      setNotes("");
      setCreatedBooking(null);
      setSaveError(null);
    }
  }, [open, preselectedArtist]);

  const filteredArtists = artists.filter((artist) => {
    const query = searchQuery.toLowerCase();
    return (
      artist.stage_name?.toLowerCase().includes(query) ||
      artist.name?.toLowerCase().includes(query) ||
      artist.surname?.toLowerCase().includes(query) ||
      artist.real_name?.toLowerCase().includes(query) ||
      artist.genre?.toLowerCase().includes(query) ||
      artist.genres?.some((g) => g.toLowerCase().includes(query)) ||
      artist.location?.toLowerCase().includes(query)
    );
  });

  const handleSelectArtist = (artist: Artist) => {
    setSelectedArtist(artist);
    setStep("booking-details");
  };

  const handleSaveBooking = async () => {
    if (!selectedArtist || !date || !startTime) return;

    setIsSaving(true);
    setSaveError(null);

    // Parse duration (HH:MM format) to minutes
    const [hours, minutes] = duration.split(":").map(Number);
    const durationMinutes = (hours || 0) * 60 + (minutes || 0);

    try {
      const result = await createBooking({
        artistId: selectedArtist.id,
        date,
        startTime,
        durationMinutes,
        notes: notes || undefined,
      });
      if (result.success && result.booking) {
        setCreatedBooking(result.booking);
        setStep("success");
      } else {
        setSaveError(result.error || "Unable to save booking. Please try again.");
      }
    } catch {
      setSaveError("Unable to save booking. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBackToDashboard = () => {
    onOpenChange(false);
    router.push("/dashboard");
  };

  const handleStartEventSetup = () => {
    if (createdBooking) {
      onOpenChange(false);
      router.push(`/dashboard/bookings/${createdBooking.id}`);
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

  const formatBookingDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    };
    const formatted = d.toLocaleDateString("en-US", options);
    // "Tuesday, May 9, 2025" -> "May 9, 2025 (Tuesday)"
    const parts = formatted.split(", ");
    if (parts.length === 3) {
      return `${parts[1]}, ${parts[2]} (${parts[0]})`;
    }
    return formatted;
  };

  // Dynamic width based on step
  const dialogClassName =
    step === "select-artist"
      ? "w-[calc(100vw-2rem)] max-w-6xl max-h-[calc(100vh-2rem)] overflow-hidden p-0"
      : step === "success"
        ? "max-w-2xl p-0"
        : "max-w-5xl max-h-[90vh] overflow-hidden p-0";

  return (
    <Dialog open={open} onOpenChange={step === "success" ? () => {} : onOpenChange}>
      <DialogContent aria-describedby={undefined} className={dialogClassName} showCloseButton={step !== "success"}>
        {/* ========== STEP 1: Select Artist ========== */}
        {step === "select-artist" && (
          <>
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle className="text-xl font-semibold">
                New Booking
              </DialogTitle>
            </DialogHeader>

            <div className="px-6 pb-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-medium text-foreground">
                  Select artist
                </h3>
                <div className="relative w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, genre or location"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="overflow-y-auto max-h-[60vh] pr-2">
                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card animate-pulse"
                      >
                        <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 w-24 bg-muted rounded" />
                          <div className="h-3 w-20 bg-muted rounded" />
                        </div>
                        <div className="h-8 w-16 bg-muted rounded shrink-0" />
                      </div>
                    ))}
                  </div>
                ) : filteredArtists.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-muted-foreground mb-4">
                      {searchQuery
                        ? "No artists found matching your search"
                        : "No artists available in your workspace"}
                    </p>
                    {!searchQuery && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          onOpenChange(false);
                          router.push("/dashboard/artists/new");
                        }}
                      >
                        Add artist
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredArtists.map((artist) => (
                      <div
                        key={artist.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-foreground/20 transition-colors"
                      >
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarImage
                            src={artist.profile_image_url || undefined}
                            alt={artist.stage_name}
                          />
                          <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                            {getInitials(artist.stage_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-foreground truncate">
                            {artist.stage_name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {artist.real_name || artist.name || "Name unknown"}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSelectArtist(artist)}
                          className="shrink-0"
                        >
                          Select
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ========== STEP 2: Booking Details ========== */}
        {step === "booking-details" && selectedArtist && (
          <>
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle className="text-xl font-semibold">
                New Booking
              </DialogTitle>
            </DialogHeader>

            <div className="px-6 pb-6">
              {/* Selected artist header */}
              <div className="flex items-center justify-between py-4 border-t border-b border-border mb-6">
                <div className="flex items-center gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarImage
                      src={selectedArtist.profile_image_url || undefined}
                      alt={selectedArtist.stage_name}
                    />
                    <AvatarFallback className="bg-muted text-muted-foreground">
                      {getInitials(selectedArtist.stage_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold text-lg text-foreground">
                      {selectedArtist.stage_name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedArtist.real_name || selectedArtist.name || "Name unknown"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-lg text-foreground">
                    {formatArtistBaseRate(selectedArtist.base_rate, selectedArtist.currency)}
                  </p>
                  <p className="text-sm text-muted-foreground">Base rate</p>
                </div>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-2 gap-8">
                {/* Left column */}
                <div className="space-y-6">
                  {/* Select date */}
                  <div>
                    <h4 className="text-base font-medium text-foreground mb-3">
                      Select date
                    </h4>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="pl-9"
                        placeholder="Pick a date"
                      />
                    </div>
                  </div>

                  {/* Performance time */}
                  <div>
                    <h4 className="text-base font-medium text-foreground mb-3">
                      Performance time
                    </h4>
                    <div className="border border-border rounded-lg p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm text-muted-foreground mb-2 block">
                            Start time
                          </label>
                          <div className="relative">
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="time"
                              value={startTime}
                              onChange={(e) => setStartTime(e.target.value)}
                              className="pl-9"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-sm text-muted-foreground mb-2 block">
                            Duration
                          </label>
                          <Input
                            type="time"
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                            placeholder="00:00"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right column - Notes */}
                <div>
                  <h4 className="text-base font-medium text-foreground mb-3">
                    Note
                  </h4>
                  <Textarea
                    placeholder="Type your message here."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-[180px] resize-y"
                  />
                </div>
              </div>

              {saveError && <p role="alert" className="mt-4 text-sm text-destructive">{saveError}</p>}
              {/* Save button */}
              <div className="flex justify-end mt-6">
                <Button
                  onClick={handleSaveBooking}
                  disabled={!date || !startTime || isSaving}
                  className="bg-foreground text-background hover:bg-foreground/90"
                >
                  {isSaving ? "Saving..." : "Save on calendar"}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ========== STEP 3: Success Confirmation ========== */}
        {step === "success" && createdBooking && selectedArtist && (
          <div className="px-8 py-10">
            <div className="flex justify-end -mt-4 -mr-2 mb-2">
              <button
                onClick={handleBackToDashboard}
                className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="border border-border rounded-lg p-8">
              {/* Title */}
              <h2 className="text-2xl font-semibold text-foreground text-center mb-8 text-balance">
                {"Booking successfully added to Artist\u2019s calendar!"}
              </h2>

              <div className="border-t border-border pt-6 pb-6">
                <div className="grid grid-cols-2 gap-8">
                  {/* Artist */}
                  <div>
                    <h4 className="text-base font-medium text-foreground mb-3">
                      Artist
                    </h4>
                    <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarImage
                          src={selectedArtist.profile_image_url || undefined}
                          alt={selectedArtist.stage_name}
                        />
                        <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                          {getInitials(selectedArtist.stage_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-foreground truncate">
                          {selectedArtist.stage_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {selectedArtist.real_name || selectedArtist.name || "Name unknown"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Date */}
                  <div>
                    <h4 className="text-base font-medium text-foreground mb-3">
                      Date
                    </h4>
                    <div className="bg-muted/50 rounded-lg p-3 flex items-center min-h-[58px]">
                      <p className="font-medium text-sm text-foreground">
                        {formatBookingDate(createdBooking.date)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-6">
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    onClick={handleBackToDashboard}
                  >
                    Back to Dashboard
                  </Button>
                  <Button
                    onClick={handleStartEventSetup}
                    className="bg-foreground text-background hover:bg-foreground/90"
                  >
                    Start event setup
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
