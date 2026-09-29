import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const viewer = await getCurrentUser();
  const booking = await prisma.booking.findUnique({
    where: { ticketToken: token },
    select: {
      bookingCode: true, status: true, paymentStatus: true, guestCount: true, transportType: true, visitDate: true, pickupLocation: true,
      club: { select: { name: true, city: true, address: true } },
      event: { select: { name: true, date: true, startTime: true, endTime: true } },
      package: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  if (!booking) return NextResponse.json({ valid: false, error: "Ticket not found" }, { status: 404 });
  const valid = booking.status === "CONFIRMED" && ["PAID","PARTIAL"].includes(booking.paymentStatus);
  const staff = viewer?.role === "SUPER_ADMIN" || viewer?.role === "CLUB_OWNER";
  if (viewer?.role === "CLUB_OWNER") { const owned = await prisma.club.findFirst({ where: { name: booking.club.name, ownerId: viewer.id }, select: { id: true } }); if (!owned) return NextResponse.json({ valid: false, error: "Forbidden", viewerRole: viewer.role }, { status: 403 }); }
  return NextResponse.json({ valid, ticket: booking, viewerRole: viewer?.role || null, staff });
}
