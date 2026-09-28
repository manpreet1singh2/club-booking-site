import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bookingSchema } from "@/lib/validation";
import { calculateBookingAmounts, createBookingCode } from "@/lib/booking";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url); const userId = searchParams.get("userId"); const clubId = searchParams.get("clubId");
  const bookings = await prisma.booking.findMany({ where: { ...(userId ? { userId } : {}), ...(clubId ? { clubId } : {}) }, include: { club: true, event: true, package: true, payments: true, transport: true }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(bookings);
}
export async function POST(req: NextRequest) {
  try {
    const body = bookingSchema.parse(await req.json());
    const pkg = await prisma.package.findUnique({ where: { id: body.packageId } });
    if (!pkg || !pkg.active) return NextResponse.json({ error: "Package unavailable" }, { status: 400 });
    const club = await prisma.club.findUnique({ where: { id: body.clubId } });
    if (!club || !club.active) return NextResponse.json({ error: "Club unavailable" }, { status: 400 });
    const amounts = calculateBookingAmounts(Number(pkg.price));
    const booking = await prisma.booking.create({ data: { bookingCode: createBookingCode(), userId: body.userId, clubId: body.clubId, eventId: body.eventId, packageId: body.packageId, guestCount: body.guestCount, transportType: body.transportType, pickupLocation: body.pickupLocation, pickupTime: body.pickupTime, totalAmount: amounts.totalAmount, advanceAmount: amounts.advanceAmount, remainingAmount: amounts.remainingAmount } });
    return NextResponse.json(booking, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid booking request" }, { status: 400 }); }
}
