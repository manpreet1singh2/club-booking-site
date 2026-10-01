import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  const packages = await prisma.package.findMany({
    where: { active: true, club: { active: true } },
    select: {
      id: true,
      clubId: true,
      name: true,
      description: true,
      price: true,
      pricing: true,
      active: true,
      club: { select: { id: true, name: true, slug: true, city: true } },
    },
    orderBy: { price: "asc" },
  });
  const response = NextResponse.json(packages);
  response.headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
  return response;
}
