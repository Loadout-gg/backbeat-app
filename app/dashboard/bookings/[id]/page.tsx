import { notFound, unstable_rethrow } from "next/navigation";
import { getBooking, getBookings, type Booking } from "@/lib/actions/bookings";
import { getBookingEventLink, type BookingEventLink } from "@/lib/actions/booking-events";
import { listPromoters, type PromoterOption } from "@/lib/actions/events";
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

  // Same-day notice only: a failed read is reported as "could not be checked", never as "no other bookings".
  let artistBookings: Booking[] | null = null;
  try {
    artistBookings = await getBookings({ artistId: booking.artist_id, failOnError: true });
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

  return (
    <EventBookingClient
      booking={booking}
      artistBookings={artistBookings}
      today={configuredCalendarDay()}
      promoters={promoters}
      linkedEvent={linkedEvent}
    />
  );
}
