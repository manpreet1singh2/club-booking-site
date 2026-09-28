import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const driverId = new URL(req.url).searchParams.get("driverId");
  const privileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";

  const transport = await prisma.transportBooking.findMany({
    where: privileged
      ? driverId ? { driverId } : {}
      : user.role === "DRIVER"
        ? { driver: { userId: user.id } }
        : { booking: { userId: user.id } },
    include: {
      booking: { include: { club: true, user: { select: { id: true, name: true, phone: true } } } },
      driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
    },
    orderBy: { pickupTime: "asc" },
  });
  return NextResponse.json(transport);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN" && user.role !== "CLUB_OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const bookingId = String(body.bookingId || "");
    const driverId = body.driverId ? String(body.driverId) : null;
    if (!bookingId) return NextResponse.json({ error: "bookingId is required" }, { status: 400 });

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.transportType === "NONE" || !booking.pickupLocation || !booking.pickupTime) {
      return NextResponse.json({ error: "Booking has no valid transport request" }, { status: 400 });
    }

    let selectedDriverId = driverId;
    if (selectedDriverId) {
      const driver = await prisma.driver.findUnique({ where: { id: selectedDriverId } });
      if (!driver || !driver.available || driver.vehicleType !== booking.transportType) {
        return NextResponse.json({ error: "Selected driver is unavailable for this transport type" }, { status: 400 });
      }
    } else {
      const available = await prisma.driver.findFirst({
        where: { available: true, vehicleType: booking.transportType },
        orderBy: { id: "asc" },
      });
      selectedDriverId = available?.id || null;
    }

    const transport = await prisma.transportBooking.upsert({
      where: { bookingId },
      create: {
        bookingId,
        driverId: selectedDriverId,
        type: booking.transportType,
        pickupLocation: booking.pickupLocation,
        pickupTime: booking.pickupTime,
        status: selectedDriverId ? "ASSIGNED" : "PENDING",
      },
      update: {
        driverId: selectedDriverId,
        status: selectedDriverId ? "ASSIGNED" : "PENDING",
        pickupLocation: booking.pickupLocation,
        pickupTime: booking.pickupTime,
      },
      include: { driver: { include: { user: { select: { id: true, name: true, phone: true } } } } },
    });

    return NextResponse.json(transport, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to assign transport" }, { status: 400 });
  }
}
