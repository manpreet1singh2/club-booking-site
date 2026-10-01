import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      userId: true,
      ticketToken: true,
      status: true,
      paymentStatus: true,
      club: { select: { ownerId: true } },
    },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const isOwner = user.role === "CLUB_OWNER" && booking.club.ownerId === user.id;
  const privileged = user.role === "SUPER_ADMIN" || isOwner;
  if (booking.userId !== user.id && !privileged) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (booking.status !== "CONFIRMED" || !["PAID", "PARTIAL"].includes(booking.paymentStatus)) {
    return NextResponse.json({ error: "Ticket is not valid for verification" }, { status: 409 });
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const png = await QRCode.toBuffer(origin.replace(/\/$/, "") + "/verify/" + booking.ticketToken, { type: "png", width: 480, margin: 2 });
  return new NextResponse(png as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}
