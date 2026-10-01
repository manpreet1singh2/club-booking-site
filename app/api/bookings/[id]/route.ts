import { NextResponse } from "next/server";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

const statuses = ["CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED", "REFUND_PENDING", "REFUNDED"] as const;
type Status = typeof statuses[number];

function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined;
}

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

  if (driverOwnRide) {
    return NextResponse.json({
      id: booking.id,
      bookingCode: booking.bookingCode,
      status: booking.status,
      visitDate: booking.visitDate,
      guestCount: booking.guestCount,
      club: booking.club,
      event: booking.event,
      package: booking.package,
      transport: booking.transport,
    });
  }

  return NextResponse.json(booking);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const requestedStatus = body.status as Status | undefined;
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

  const allowedTransitions: Record<string, string[]> = {
    PENDING_PAYMENT: ["CONFIRMED", "CANCELLED", "EXPIRED"],
    CONFIRMED: ["COMPLETED", "CANCELLED", "REFUND_PENDING"],
    COMPLETED: [],
    CANCELLED: [],
    EXPIRED: [],
    REFUND_PENDING: ["REFUNDED"],
    REFUNDED: [],
  };
  const effectiveStatus: Status = requestedStatus === "CANCELLED" && ["PAID", "PARTIAL"].includes(booking.paymentStatus) ? "REFUND_PENDING" : requestedStatus as Status;

  if (!allowedTransitions[booking.status]?.includes(effectiveStatus)) {
    return NextResponse.json({ error: `Invalid booking status transition from ${booking.status} to ${requestedStatus}` }, { status: 409 });
  }

  if (user.role === "CUSTOMER" && booking.status === "COMPLETED") return NextResponse.json({ error: "Completed bookings cannot be cancelled" }, { status: 400 });
  if (user.role === "CUSTOMER" && body.status === "CANCELLED" && ["CANCELLED","REFUNDED"].includes(booking.status)) return NextResponse.json({ error: "Booking is already closed" }, { status: 400 });
  if (body.status === "CONFIRMED" && !["PAID","PARTIAL"].includes(booking.paymentStatus)) return NextResponse.json({ error: "Payment must be verified before confirmation" }, { status: 400 });
  if (body.status === "CONFIRMED" && booking.status === "PENDING_PAYMENT" && booking.expiresAt <= new Date()) return NextResponse.json({ error: "Booking payment hold has expired" }, { status: 409 });
  if (effectiveStatus === "REFUND_PENDING" && !["PAID","PARTIAL"].includes(booking.paymentStatus)) return NextResponse.json({ error: "A paid booking is required before refund processing" }, { status: 400 });

  if (effectiveStatus === "REFUNDED" && booking.status !== "REFUND_PENDING") return NextResponse.json({ error: "Booking must be refund-pending first" }, { status: 400 });
  if (user.role === "CLUB_OWNER" && effectiveStatus === "REFUNDED") return NextResponse.json({ error: "Only super admins can process refunds" }, { status: 403 });
  let updated;
  try {
    updated = await prisma.$transaction(async tx => {
      const result = await tx.booking.updateMany({
        where: { id, status: booking.status, ...(effectiveStatus === "CONFIRMED" && booking.status === "PENDING_PAYMENT" ? { expiresAt: { gt: new Date() } } : {}) },
        data: { status: effectiveStatus },
      });
      if (result.count !== 1) throw new Error("BOOKING_STATE_CONFLICT");

      if (effectiveStatus === "REFUND_PENDING") {
        await tx.booking.update({ where: { id }, data: { paymentStatus: "PARTIAL" } });
      }
      if (effectiveStatus === "CANCELLED" && booking.transport?.driverId) {
        await tx.driver.update({ where: { id: booking.transport.driverId }, data: { available: true } });
      }
      if (effectiveStatus === "CANCELLED" && booking.transport) {
        await tx.transportBooking.update({ where: { bookingId: id }, data: { status: "CANCELLED" } });
      }
      if (effectiveStatus === "REFUNDED") {
        await tx.booking.update({ where: { id }, data: { paymentStatus: "REFUNDED" } });
      }
      return tx.booking.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof Error && error.message === "BOOKING_STATE_CONFLICT") {
      return NextResponse.json({ error: "Booking was changed by another request. Refresh and retry." }, { status: 409 });
    }
    if (prismaCode(error) === "P2034") {
      return NextResponse.json({ error: "Booking update conflicted with another transaction. Refresh and retry." }, { status: 409 });
    }
    throw error;
  }
  await writeAuditLog({ userId: user.id, action: body.status ? "BOOKING_STATUS_CHANGED" : "BOOKING_UPDATED", entity: "Booking", entityId: id, metadata: body.status ? { from: booking.status, to: effectiveStatus } : undefined });
  return NextResponse.json(updated);
}
