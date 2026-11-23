import { notFound, unstable_rethrow } from "next/navigation";
import { getBooking, getBookings, type Booking } from "@/lib/actions/bookings";
import { getBookingTravel } from "@/lib/actions/booking-travel";
import { getArtistTravelProfile } from "@/lib/actions/artist-travel-documents";
import { configuredCalendarDay } from "@/lib/calendar-day";
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

  // Same-day notice only: a failed read is reported as "could not be checked", never as "no other bookings".
  const [artistBookings, travel, travelProfile] = await Promise.all([
    readOrNull<Booking[]>(() => getBookings({ artistId: booking.artist_id, failOnError: true })),
    readOrNull(() => getBookingTravel(booking.id)),
    readOrNull(() => getArtistTravelProfile(booking.artist_id)),
  ]);
  const artistName = booking.artist.stage_name || booking.artist.name || "Unknown";

  return (
    <EventBookingClient
      booking={booking}
      artistBookings={artistBookings}
      today={configuredCalendarDay()}
      travelPanel={
        <BookingTravelPanel
          bookingId={booking.id}
          bookingDate={booking.date}
          artistId={booking.artist_id}
          artistName={artistName}
          legs={travel?.legs ?? null}
          travelProfile={travelProfile}
        />
      }
      accommodationPanel={<BookingStaysPanel bookingId={booking.id} stays={travel?.stays ?? null} />}
    />
  );
}
