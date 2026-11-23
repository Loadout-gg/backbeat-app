import { notFound, unstable_rethrow } from "next/navigation";
import { getBooking, getBookings, type Booking } from "@/lib/actions/bookings";
import { getBookingPayments } from "@/lib/actions/booking-payments";
import type { BookingPayment } from "@/lib/booking-finance";
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

  // A failed payments read is reported in the Financial tab, never shown as "no payments".
  let payments: BookingPayment[] | null = null;
  try {
    payments = await getBookingPayments(booking.id);
  } catch (error) {
    unstable_rethrow(error);
  }

  return <EventBookingClient booking={booking} artistBookings={artistBookings} today={configuredCalendarDay()} payments={payments} />;
}
