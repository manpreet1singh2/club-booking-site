import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clubToday, reservedGuestsByEvent, spotsLeft } from "@/lib/availability";

export const dynamic = "force-dynamic";

export async function GET() {
  const clubs = await prisma.club.findMany({
    where: { active: true },
    select: {
      id: true, name: true, slug: true, city: true, address: true, description: true, imageUrl: true,
      latitude: true, longitude: true, cancellationHours: true,
      events: {
        where: { active: true, date: { gte: clubToday() } },
        select: { id: true, name: true, slug: true, date: true, startTime: true, endTime: true, capacity: true },
        orderBy: { date: "asc" },
        take: 30,
      },
      packages: {
        where: { active: true },
        select: { id: true, name: true, description: true, kind: true, price: true, pricing: true },
        orderBy: { price: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  const reserved = await reservedGuestsByEvent(clubs.flatMap(c => c.events.map(e => e.id)));
  const body = clubs.map(c => ({
    ...c,
    events: c.events.map(e => ({ ...e, spotsLeft: spotsLeft(e.capacity, reserved.get(e.id) ?? 0) })),
  }));
  // Short cache: spots-left must stay close to live.
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=15, s-maxage=15" } });
}
