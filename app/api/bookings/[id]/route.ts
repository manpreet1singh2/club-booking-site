import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const statuses = ["CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED", "REFUND_PENDING", "REFUNDED"] as const;
type Status = typeof statuses[number];

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, role: true } },
      club: { include: { owner: { select: { id: true } } } },
      event: true,
      package: true,
      payments: true,
      transport: { include: { driver: { include: { user: { select: { id: true, name: true, phone: true } } } } } },
    },
  });

  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const privileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  const driverOwnRide = user.role === "DRIVER" && booking.transport?.driver?.user.id === user.id;
  if (user.role === "CLUB_OWNER" && booking.club.ownerId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (booking.userId !== user.id && !privileged && !driverOwnRide) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(booking);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const booking = await prisma.booking.findUnique({ where: { id }, include: { transport: true } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const privileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  if (!privileged && booking.userId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (body.status && !statuses.includes(body.status as Status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Customers may only request cancellation. Operational status changes require staff.
  if (!privileged && body.status !== "CANCELLED") {
    return NextResponse.json({ error: "Only cancellation is available to customers" }, { status: 403 });
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: body.status ? { status: body.status as Status } : {},
  });
  return NextResponse.json(updated);
}
