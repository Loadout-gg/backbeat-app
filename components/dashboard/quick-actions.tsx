"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { NewBookingModal } from "./new-booking-modal"

export function QuickActions({ onNewBooking }: { onNewBooking?: () => void }) {
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false)

  return (
    <>
      <section aria-label="Quick Actions" className="space-y-3">
        <h2 className="text-base font-semibold">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-2 rounded-xl bg-muted/60 p-3 sm:grid-cols-2 xl:grid-cols-1">
          <Button
            className="min-h-10 w-full justify-start gap-2"
            onClick={onNewBooking || (() => setIsBookingModalOpen(true))}
          >
            <Plus className="h-4 w-4" />
            New Booking
          </Button>
          <Button variant="outline" className="min-h-10 w-full justify-start gap-2" asChild>
            <Link href="/dashboard/artists/new">
              <Plus className="h-4 w-4" />
              Add artist
            </Link>
          </Button>
        </div>
      </section>

      {!onNewBooking && <NewBookingModal
        open={isBookingModalOpen}
        onOpenChange={setIsBookingModalOpen}
      />}
    </>
  )
}
