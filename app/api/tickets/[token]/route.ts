import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return NextResponse.json({ valid: false, error: "Invalid ticket token" }, { status: 400 });
  }
  const viewer = await getCurrentUser();
  const booking = await prisma.booking.findUnique({
    where: { ticketToken: token },
    select: {
      bookingCode: true, clubId: true, status: true, paymentStatus: true, guestCount: true, transportType: true, visitDate: true, pickupLocation: true,
      club: { select: { name: true, city: true, address: true } },
      event: { select: { name: true, date: true, startTime: true, endTime: true } },
      package: { select: { name: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!booking) return NextResponse.json({ valid: false, error: "Ticket not found" }, { status: 404 });
  const valid = booking.status === "CONFIRMED" && ["PAID","PARTIAL"].includes(booking.paymentStatus);
  const staff = viewer?.role === "SUPER_ADMIN" || viewer?.role === "CLUB_OWNER";
  if (viewer?.role === "CLUB_OWNER") { const owned = await prisma.club.findFirst({ where: { id: booking.clubId, ownerId: viewer.id }, select: { id: true } }); if (!owned) return NextResponse.json({ valid: false, error: "Forbidden" }, { status: 403 }); }
  const ticket = staff || viewer?.id === (booking as typeof booking & { user: { id: string } }).user.id
    ? booking
    : {
        bookingCode: booking.bookingCode,
        clubId: booking.clubId,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        guestCount: booking.guestCount,
        transportType: booking.transportType,
        visitDate: booking.visitDate,
        club: booking.club,
        event: booking.event,
        package: booking.package,
      };
  return NextResponse.json({ valid, ticket, viewerRole: viewer?.role ?? null });
}
