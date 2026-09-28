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
  const status = searchParams.get("status");
  const paymentStatus = searchParams.get("paymentStatus");
  const q = searchParams.get("q");

  const isPrivileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  if (requestedUserId && requestedUserId !== user.id && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where: any = {
    ...(isPrivileged && requestedUserId ? { userId: requestedUserId } : !isPrivileged ? { userId: user.id } : {}),
    ...(clubId ? { clubId } : {}),
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(q ? { OR: [{ bookingCode: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }, { user: { phone: { contains: q } } }] } : {}),
  };
  if (user.role === "CLUB_OWNER") where.club = { ownerId: user.id };
  const bookings = await prisma.booking.findMany({ where,
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
    if (!club || !club.active || pkg.clubId !== club.id) return NextResponse.json({ error: "Club unavailable" }, { status: 400 });
    if (body.visitDate.getTime() < Date.now() - 60_000) return NextResponse.json({ error: "Visit date must be in the future" }, { status: 400 });
    let event = null;
    if (body.eventId) {
      event = await prisma.event.findFirst({ where: { id: body.eventId, clubId: club.id, active: true } });
      if (!event || event.date.toDateString() !== body.visitDate.toDateString()) return NextResponse.json({ error: "Selected event is not available on this date" }, { status: 400 });
      if (event.capacity) {
        const reserved = await prisma.booking.aggregate({ where: { eventId: event.id, status: { in: ["PENDING_PAYMENT","CONFIRMED"] } }, _sum: { guestCount: true } });
        if ((reserved._sum.guestCount ?? 0) + body.guestCount > event.capacity) return NextResponse.json({ error: "Event capacity is full for this group size" }, { status: 409 });
      }
    }
    if (body.transportType !== "NONE" && (!body.pickupLocation || !body.pickupTime)) return NextResponse.json({ error: "Pickup location and time are required for transport" }, { status: 400 });
    const amounts = calculateBookingAmounts(Number(pkg.price), body.guestCount, pkg.pricing);
    const booking = await prisma.booking.create({
      data: {
        bookingCode: createBookingCode(),
        userId: user.id,
        clubId: body.clubId,
        eventId: body.eventId,
        visitDate: body.visitDate,
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
