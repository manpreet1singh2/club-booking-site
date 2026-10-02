import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { clubToday, reservedGuestsByEvent, spotsLeft } from "@/lib/availability";

export const dynamic = "force-dynamic";

export default async function EventDetail({ params }: { params: Promise<{ clubSlug: string; eventSlug: string }> }) {
  const { clubSlug, eventSlug } = await params;
  const today = clubToday();
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, club: { slug: clubSlug }, active: true, date: { gte: today } },
    select: {
      id: true,
      clubId: true,
      name: true,
      date: true,
      startTime: true,
      endTime: true,
      capacity: true,
      club: { select: { id: true, name: true, city: true } },
    },
  });
  if (!event) return notFound();
  const reserved = (await reservedGuestsByEvent([event.id])).get(event.id) ?? 0;
  const remaining = spotsLeft(event.capacity, reserved);

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