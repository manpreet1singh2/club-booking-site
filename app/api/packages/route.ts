import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  const packages = await prisma.package.findMany({ where: { active: true }, include: { club: true }, orderBy: { price: "asc" } });
  return NextResponse.json(packages);
}
