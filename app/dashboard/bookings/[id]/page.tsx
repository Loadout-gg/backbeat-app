import { notFound } from "next/navigation";
import { getBooking } from "@/lib/actions/bookings";
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

  return <EventBookingClient booking={booking} />;
}
