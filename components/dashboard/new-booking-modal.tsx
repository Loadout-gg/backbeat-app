"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Clock, Calendar as CalendarIcon } from "lucide-react";
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

type ModalStep = "select-artist" | "select-date" | "success";

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
    preselectedArtist ? "select-date" : "select-artist"
  );
  const [artists, setArtists] = useState<Artist[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(
    preselectedArtist || null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);

  // Form state
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:30");
  const [duration, setDuration] = useState("00:00");
  const [notes, setNotes] = useState("");

  // Load artists when modal opens
  useEffect(() => {
    if (open && !preselectedArtist) {
      setIsLoading(true);
      getArtists()
        .then(setArtists)
        .finally(() => setIsLoading(false));
    }
  }, [open, preselectedArtist]);

  // Reset state when modal closes or preselectedArtist changes
  useEffect(() => {
    if (open) {
      if (preselectedArtist) {
        setSelectedArtist(preselectedArtist);
        setStep("select-date");
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
    }
  }, [open, preselectedArtist]);

  const filteredArtists = artists.filter((artist) => {
    const query = searchQuery.toLowerCase();
    const nameMatch = artist.name?.toLowerCase().includes(query) || false;
    const surnameMatch = artist.surname?.toLowerCase().includes(query) || false;
    const stageNameMatch = artist.stage_name?.toLowerCase().includes(query) || false;
    const locationMatch = artist.location?.toLowerCase().includes(query) || false;
    const genresMatch = artist.genres?.some((g) => g.toLowerCase().includes(query)) || false;
    return nameMatch || surnameMatch || stageNameMatch || locationMatch || genresMatch;
  });

  const handleSelectArtist = (artist: Artist) => {
    setSelectedArtist(artist);
    setStep("select-date");
  };

  const handleSaveBooking = async () => {
    if (!selectedArtist || !date) return;

    setIsSaving(true);

    // Parse duration (HH:MM format) to minutes
    const [hours, minutes] = duration.split(":").map(Number);
    const durationMinutes = (hours || 0) * 60 + (minutes || 0);

    const result = await createBooking({
      artistId: selectedArtist.id,
      date,
      startTime,
      durationMinutes,
      notes: notes || undefined,
    });

    setIsSaving(false);

    if (result.success && result.booking) {
      setCreatedBooking(result.booking);
      setStep("success");
    }
  };

  const formatCurrency = (fee: number | null, currency: string | null) => {
    if (!fee) return "N/A";
    const currencySymbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
    return `${currencySymbol}${fee.toLocaleString()}`;
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
    const date = new Date(dateStr + "T00:00:00");
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const formatted = date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return `${formatted} (${dayName})`;
  };

  const handleBackToDashboard = () => {
    onOpenChange(false);
    router.push("/dashboard");
    router.refresh();
  };

  const handleStartEventSetup = () => {
    // TODO: Route to event setup page when implemented
    // For now, close modal and go to dashboard
    onOpenChange(false);
    router.push("/dashboard");
    router.refresh();
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen && createdBooking) {
      router.refresh();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-hidden p-0">
        {step !== "success" && (
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-xl font-semibold">
              New Booking
            </DialogTitle>
          </DialogHeader>
        )}

        {/* Step 1: Select Artist */}
        {step === "select-artist" && (
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card animate-pulse"
                    >
                      <div className="h-10 w-10 rounded-full bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-24 bg-muted rounded" />
                        <div className="h-3 w-20 bg-muted rounded" />
                      </div>
                      <div className="h-8 w-16 bg-muted rounded" />
                    </div>
                  ))}
                </div>
              ) : filteredArtists.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {searchQuery
                    ? "No artists found matching your search"
                    : "No artists available"}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {filteredArtists.map((artist) => {
                    const realName = artist.surname
                      ? `${artist.name || ""} ${artist.surname}`.trim()
                      : artist.name !== artist.stage_name
                        ? artist.name
                        : null;
                    return (
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
                            {realName || "Nome Cognome"}
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
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Select Date */}
        {step === "select-date" && selectedArtist && (
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
                    {selectedArtist.surname
                      ? `${selectedArtist.name || ""} ${selectedArtist.surname}`.trim()
                      : selectedArtist.name !== selectedArtist.stage_name
                        ? selectedArtist.name
                        : "Nome Cognome"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-lg text-foreground">
                  {formatCurrency(selectedArtist.fee, selectedArtist.currency)}
                </p>
                <p className="text-sm text-muted-foreground">Base rate</p>
              </div>
            </div>

            {/* Form fields */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left column */}
              <div className="space-y-6">
                {/* Select date */}
                <div>
                  <h4 className="text-base font-medium text-foreground mb-3">
                    Select date
                  </h4>
                  <div className="relative">
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
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
                          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
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
                  className="min-h-[180px] resize-none"
                />
              </div>
            </div>

            {/* Save button */}
            <div className="flex justify-end mt-6">
              <Button
                onClick={handleSaveBooking}
                disabled={!date || isSaving}
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {isSaving ? "Saving..." : "Save on calendar"}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Success Confirmation */}
        {step === "success" && selectedArtist && createdBooking && (
          <div className="px-6 py-12 flex flex-col items-center">
            <h2 className="text-2xl font-semibold text-center mb-8 text-balance">
              {"Booking successfully added to Artist's calendar!"}
            </h2>

            <div className="w-full max-w-3xl border-t border-border pt-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Artist Card */}
                <div>
                  <h4 className="text-base font-medium text-foreground mb-3">
                    Artist
                  </h4>
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                    <Avatar className="h-10 w-10">
                      <AvatarImage
                        src={selectedArtist.profile_image_url || undefined}
                        alt={selectedArtist.stage_name}
                      />
                      <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                        {getInitials(selectedArtist.stage_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm text-foreground">
                        {selectedArtist.stage_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedArtist.surname
                          ? `${selectedArtist.name || ""} ${selectedArtist.surname}`.trim()
                          : selectedArtist.name !== selectedArtist.stage_name
                            ? selectedArtist.name
                            : "Nome Cognome"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Date Card */}
                <div>
                  <h4 className="text-base font-medium text-foreground mb-3">
                    Date
                  </h4>
                  <div className="flex items-center p-4 rounded-lg bg-muted/50">
                    <p className="font-medium text-sm text-foreground">
                      {formatBookingDate(createdBooking.date)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border w-full max-w-3xl mt-8 pt-8 flex justify-center gap-4">
              <Button variant="outline" onClick={handleBackToDashboard}>
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
        )}
      </DialogContent>
    </Dialog>
  );
}
