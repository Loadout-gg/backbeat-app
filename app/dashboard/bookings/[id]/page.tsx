import { notFound, unstable_rethrow } from "next/navigation";
import { getBooking, getBookings } from "@/lib/actions/bookings";
import { getBookingEventLink, type BookingEventLink } from "@/lib/actions/booking-events";
import { listPromoters, type PromoterOption } from "@/lib/actions/events";
import { getBookingPayments } from "@/lib/actions/booking-payments";
import { holdRank } from "@/lib/booking-display";
import type { BookingPayment } from "@/lib/booking-finance";
import { configuredCalendarDay } from "@/lib/calendar-day";
import { createClient } from "@/lib/supabase/server";
import { getBookingTravel } from "@/lib/actions/booking-travel";
import { getArtistTravelProfile } from "@/lib/actions/artist-travel-documents";
import { BookingTravelPanel } from "@/components/dashboard/booking-travel/booking-travel-panel";
import { BookingStaysPanel } from "@/components/dashboard/booking-travel/booking-stays-panel";
import { EventBookingClient } from "./event-booking-client";

interface EventBookingPageProps {
  params: Promise<{ id: string }>;
}

/** A failed optional read becomes null, rendered as an explicit unavailable state. */
async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
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

  // Promoter options and the linked event: a failed read is shown as such in its own
  // control, never as "no promoters" or "no event".
  let promoters: PromoterOption[] | null = null;
  try {
    promoters = await listPromoters();
  } catch (error) {
    unstable_rethrow(error);
  }
  let linkedEvent: BookingEventLink | null | "unavailable" = "unavailable";
  try {
    linkedEvent = await getBookingEventLink(booking.id);
  } catch (error) {
    unstable_rethrow(error);
  }

  // A failed payments read is reported in the Financial tab, never shown as "no payments".
  let payments: BookingPayment[] | null = null;
  try {
    payments = await getBookingPayments(booking.id);
  } catch (error) {
    unstable_rethrow(error);
  }

  // Only the verified request user can own a browser payment draft. A failed lookup
  // leaves recovery off; it never supplies ownership from the browser or booking row.
  let draftOwnerId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user) draftOwnerId = user.id;
  } catch (error) {
    unstable_rethrow(error);
  }

  // Sensitive travel reads: a failed read renders "could not be loaded", never an empty list.
  const [travel, travelProfile] = await Promise.all([
    readOrNull(() => getBookingTravel(booking.id)),
    readOrNull(() => getArtistTravelProfile(booking.artist_id)),
  ]);
  const artistName = booking.artist.stage_name || booking.artist.name || "Unknown";

  return (
    <EventBookingClient
      booking={booking}
      draftOwnerId={draftOwnerId}
      sameDayBookingCounts={sameDayBookingCounts}
      holdPosition={holdPosition}
      today={configuredCalendarDay()}
      payments={payments}
      promoters={promoters}
      linkedEvent={linkedEvent}
      travelPanel={
        <BookingTravelPanel
          bookingId={booking.id}
          bookingDate={booking.date}
          artistId={booking.artist_id}
          artistName={artistName}
          legs={travel?.legs ?? null}
          travelProfile={travelProfile}
          transportToCity={travel ? travel.transportToCity : undefined}
          today={configuredCalendarDay()}
        />
      }
      accommodationPanel={<BookingStaysPanel bookingId={booking.id} stays={travel?.stays ?? null} />}
    />
  );
}
