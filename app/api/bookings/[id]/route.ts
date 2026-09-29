import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

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
  const booking = await prisma.booking.findUnique({ where: { id }, include: { transport: true, club: { select: { ownerId: true } } } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const privileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  if (user.role === "CLUB_OWNER" && booking.club.ownerId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!privileged && booking.userId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (body.status && !statuses.includes(body.status as Status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Customers may only request cancellation. Operational status changes require staff.
  if (!privileged && body.status !== "CANCELLED") {
    return NextResponse.json({ error: "Only cancellation is available to customers" }, { status: 403 });
  }

  if (user.role === "CUSTOMER" && booking.status === "COMPLETED") return NextResponse.json({ error: "Completed bookings cannot be cancelled" }, { status: 400 });
  if (user.role === "CUSTOMER" && body.status === "CANCELLED" && ["CANCELLED","REFUNDED"].includes(booking.status)) return NextResponse.json({ error: "Booking is already closed" }, { status: 400 });
  if (body.status === "CONFIRMED" && !["PAID","PARTIAL"].includes(booking.paymentStatus)) return NextResponse.json({ error: "Payment must be verified before confirmation" }, { status: 400 });
  if (body.status === "REFUND_PENDING" && !["PAID","PARTIAL"].includes(booking.paymentStatus)) return NextResponse.json({ error: "A paid booking is required before refund processing" }, { status: 400 });
  if (body.status === "CANCELLED" && ["PAID","PARTIAL"].includes(booking.paymentStatus) && booking.status !== "REFUND_PENDING") body.status = "REFUND_PENDING";
  if (body.status === "REFUNDED" && booking.status !== "REFUND_PENDING") return NextResponse.json({ error: "Booking must be refund-pending first" }, { status: 400 });
  if (user.role === "CLUB_OWNER" && body.status === "REFUNDED") return NextResponse.json({ error: "Only super admins can process refunds" }, { status: 403 });
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.booking.update({ where: { id }, data: body.status ? { status: body.status as Status } : {} });
    if (body.status === "REFUND_PENDING") await tx.booking.update({ where: { id }, data: { paymentStatus: "PARTIAL" } });
    if (body.status === "CANCELLED" && booking.transport?.driverId) await tx.driver.update({ where: { id: booking.transport.driverId }, data: { available: true } });
    if (body.status === "CANCELLED" && booking.transport) await tx.transportBooking.update({ where: { bookingId: id }, data: { status: "CANCELLED" } });
    if (body.status === "REFUNDED") await tx.booking.update({ where: { id }, data: { paymentStatus: "REFUNDED" } });
    return result;
  });
  await writeAuditLog({ userId: user.id, action: body.status ? "BOOKING_STATUS_CHANGED" : "BOOKING_UPDATED", entity: "Booking", entityId: id, metadata: body.status ? { from: booking.status, to: body.status } : undefined });
  return NextResponse.json(updated);
}
