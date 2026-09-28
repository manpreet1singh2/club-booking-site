import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  const clubs = await prisma.club.findMany({ where: { active: true }, include: { events: { where: { active: true }, orderBy: { date: "asc" } }, packages: { where: { active: true }, orderBy: { price: "asc" } } }, orderBy: { name: "asc" } });
  return NextResponse.json(clubs);
}
