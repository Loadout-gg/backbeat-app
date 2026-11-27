"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { NewBookingModal } from "./new-booking-modal"

export function QuickActions({ onNewBooking, hasArtists = true }: { onNewBooking?: () => void; hasArtists?: boolean }) {
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false)
  const newBooking = (
    <Button
      variant={hasArtists ? "default" : "outline"}
      className="min-h-10 w-full justify-start gap-2"
      onClick={onNewBooking || (() => setIsBookingModalOpen(true))}
    >
      <Plus className="h-4 w-4" />
      New booking
    </Button>
  )
  // With an empty roster a booking has no artist to pick: adding one comes first.
  const addArtist = (
    <Button variant={hasArtists ? "outline" : "default"} className="min-h-10 w-full justify-start gap-2" asChild>
      <Link href="/dashboard/artists/new">
        <Plus className="h-4 w-4" />
        {hasArtists ? "Add artist" : "Add first artist"}
      </Link>
    </Button>
  )

  return (
    <>
      <section aria-label="Quick actions" className="space-y-3">
        <h2 className="text-base font-semibold">Quick actions</h2>
        <div className="grid grid-cols-1 gap-2 rounded-xl bg-muted/60 p-3 sm:grid-cols-2 xl:grid-cols-1">
          {hasArtists ? <>{newBooking}{addArtist}</> : <>{addArtist}{newBooking}</>}
        </div>
      </section>

      {!onNewBooking && <NewBookingModal
        open={isBookingModalOpen}
        onOpenChange={setIsBookingModalOpen}
      />}
    </>
  )
}
