import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  const clubs = await prisma.club.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      address: true,
      description: true,
      imageUrl: true,
      active: true,
      events: {
        where: { active: true },
        select: { id: true, name: true, slug: true, date: true, startTime: true, endTime: true, capacity: true, active: true },
        orderBy: { date: "asc" },
      },
      packages: {
        where: { active: true },
        select: { id: true, name: true, description: true, price: true, pricing: true, active: true },
        orderBy: { price: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  const response = NextResponse.json(clubs);
  response.headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
  return response;
}
