import { notFound, unstable_rethrow } from "next/navigation";
import { getBooking, getBookings, type Booking } from "@/lib/actions/bookings";
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

  return <EventBookingClient booking={booking} artistBookings={artistBookings} today={configuredCalendarDay()} />;
}
