import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
const statuses = ["CONFIRMED","CANCELLED","COMPLETED","EXPIRED","REFUND_PENDING","REFUNDED"] as const;
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.booking.findUnique({ where: { id }, include: { user: true, club: true, event: true, package: true, payments: true, transport: { include: { driver: { include: { user: true } } } } } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  return NextResponse.json(booking);
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const body = await req.json();
  if (body.status && !statuses.includes(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const booking = await prisma.booking.update({ where: { id }, data: { ...(body.status ? { status: body.status } : {}) } });
  return NextResponse.json(booking);
}
