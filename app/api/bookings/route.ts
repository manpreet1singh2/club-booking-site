import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { bookingSchema } from "@/lib/validation";
import { calculateBookingAmounts, createBookingCode } from "@/lib/booking";
import { notifyBookingCreated } from "@/lib/notifications";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const requestedUserId = searchParams.get("userId");
  const clubId = searchParams.get("clubId");

  const isPrivileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  if (requestedUserId && requestedUserId !== user.id && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bookings = await prisma.booking.findMany({
    where: {
      ...(isPrivileged && requestedUserId ? { userId: requestedUserId } : !isPrivileged ? { userId: user.id } : {}),
      ...(clubId ? { clubId } : {}),
    },
    include: {
      club: true,
      event: true,
      package: true,
      payments: true,
      transport: { include: { driver: { include: { user: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(bookings);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = bookingSchema.omit({ userId: true }).parse(await req.json());
    const pkg = await prisma.package.findUnique({ where: { id: body.packageId } });
    if (!pkg || !pkg.active) return NextResponse.json({ error: "Package unavailable" }, { status: 400 });

    const club = await prisma.club.findUnique({ where: { id: body.clubId } });
    if (!club || !club.active) return NextResponse.json({ error: "Club unavailable" }, { status: 400 });

    const amounts = calculateBookingAmounts(Number(pkg.price));
    const booking = await prisma.booking.create({
      data: {
        bookingCode: createBookingCode(),
        userId: user.id,
        clubId: body.clubId,
        eventId: body.eventId,
        packageId: body.packageId,
        guestCount: body.guestCount,
        transportType: body.transportType,
        pickupLocation: body.pickupLocation,
        pickupTime: body.pickupTime,
        totalAmount: amounts.totalAmount,
        advanceAmount: amounts.advanceAmount,
        remainingAmount: amounts.remainingAmount,
      },
      include: { club: true, package: true, event: true },
    });
    notifyBookingCreated(booking.id).catch(() => undefined);
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid booking request" }, { status: 400 });
  }
}
