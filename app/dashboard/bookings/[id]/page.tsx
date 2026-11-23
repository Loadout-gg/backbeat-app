import { notFound, unstable_rethrow } from "next/navigation";
import { getBooking, getBookings } from "@/lib/actions/bookings";
import { holdRank } from "@/lib/booking-display";
import { configuredCalendarDay } from "@/lib/calendar-day";
import { EventBookingClient } from "./event-booking-client";

interface EventBookingPageProps {
  params: Promise<{ id: string }>;
}

export default async function EventBookingPage({ params }: EventBookingPageProps) {
  const { id } = await params;
  const booking = await getBooking(id);

  if (!booking) {
    notFound();
  }

  // Keep other booking records server-side; counts let the notice follow draft date changes.
  let sameDayBookingCounts: Record<string, number> | null = null;
  let holdPosition: ReturnType<typeof holdRank> = null;
  try {
    const artistBookings = await getBookings({ artistId: booking.artist_id, failOnError: true });
    const counts = new Map<string, number>();
    for (const other of artistBookings) {
      if (
        !other.date ||
        other.artist_id !== booking.artist_id ||
        other.id === booking.id ||
        other.status === "cancelled"
      ) continue;
      counts.set(other.date, (counts.get(other.date) ?? 0) + 1);
    }
    sameDayBookingCounts = Object.fromEntries(counts);
    // Rank follows the saved booking's artist, date and status, not the draft date.
    holdPosition = holdRank(artistBookings, booking);
  } catch (error) {
    unstable_rethrow(error);
  }

  return <EventBookingClient booking={booking} sameDayBookingCounts={sameDayBookingCounts} holdPosition={holdPosition} today={configuredCalendarDay()} />;
}
