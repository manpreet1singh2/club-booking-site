import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function EventDetail({ params }: { params: Promise<{ clubSlug: string; eventSlug: string }> }) {
  const { clubSlug, eventSlug } = await params;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, club: { slug: clubSlug }, active: true, date: { gte: today } },
    include: { club: true, bookings: { where: { status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } }, select: { guestCount: true } } },
  });
  if (!event) return notFound();
  const reserved = event.bookings.reduce((n, b) => n + b.guestCount, 0);
  const remaining = event.capacity ? Math.max(0, event.capacity - reserved) : null;

  return <main className="pt-32 pb-20"><div className="container max-w-4xl">
    <span className="eyebrow">{event.club.name} · {event.club.city}</span>
    <h1 className="text-5xl md:text-7xl font-black mt-3">{event.name}.</h1>
    <div className="card p-7 mt-8">
      <p className="text-lg">{new Date(event.date).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
      <p className="muted mt-2">{event.startTime}{event.endTime ? " – " + event.endTime : ""}</p>
      {remaining !== null && <p className="muted mt-4">{remaining} guest spots remaining</p>}
      <Link href={"/book?clubId="+encodeURIComponent(event.clubId)+"&eventId="+encodeURIComponent(event.id)} className="btn-primary inline-block mt-7">Book this event</Link>
    </div>
  </div></main>;
}