import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { bookingSchema } from "@/lib/validation";
import { calculateBookingAmounts, createBookingCode } from "@/lib/booking";
import { notifyBookingCreated } from "@/lib/notifications";

const PAYMENT_HOLD_MINUTES = 15;

const bookingStatuses = ["PENDING_PAYMENT","CONFIRMED","CANCELLED","COMPLETED","EXPIRED","REFUND_PENDING","REFUNDED"] as const;
const paymentStatuses = ["PENDING","PAID","FAILED","REFUNDED","PARTIAL"] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const requestedUserId = searchParams.get("userId");
  const clubId = searchParams.get("clubId");
  const status = searchParams.get("status");
  const paymentStatus = searchParams.get("paymentStatus");
  const q = searchParams.get("q");

  if (status && !bookingStatuses.includes(status as typeof bookingStatuses[number])) {
    return NextResponse.json({ error: "Invalid booking status filter" }, { status: 400 });
  }
  if (paymentStatus && !paymentStatuses.includes(paymentStatus as typeof paymentStatuses[number])) {
    return NextResponse.json({ error: "Invalid payment status filter" }, { status: 400 });
  }

  if (user.role === "DRIVER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const isPrivileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  if (requestedUserId && requestedUserId !== user.id && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where: Record<string, unknown> = {
    ...(isPrivileged && requestedUserId ? { userId: requestedUserId } : !isPrivileged ? { userId: user.id } : {}),
    ...(clubId ? { clubId } : {}),
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(q ? { OR: [{ bookingCode: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }, { user: { phone: { contains: q } } }] } : {}),
  };
  if (user.role === "CLUB_OWNER") where.club = { ownerId: user.id };
  const bookings = await prisma.booking.findMany({
    where,
    select: {
      id: true,
      bookingCode: true,
      userId: true,
      clubId: true,
      eventId: true,
      packageId: true,
      guestCount: true,
      transportType: true,
      visitDate: true,
      pickupLocation: true,
      pickupTime: true,
      totalAmount: true,
      advanceAmount: true,
      remainingAmount: true,
      expiresAt: true,
      ticketToken: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      updatedAt: true,
      club: {
        select: {
          id: true,
          name: true,
          slug: true,
          city: true,
          address: true,
          description: true,
          imageUrl: true,
          active: true,
        },
      },
      event: {
        select: {
          id: true,
          clubId: true,
          name: true,
          slug: true,
          date: true,
          startTime: true,
          endTime: true,
          capacity: true,
          active: true,
        },
      },
      package: {
        select: {
          id: true,
          clubId: true,
          name: true,
          description: true,
          price: true,
          pricing: true,
          active: true,
        },
      },
      payments: {
        select: {
          id: true,
          amount: true,
          status: true,
          gateway: true,
          transactionId: true,
          createdAt: true,
          refundedAmount: true,
          refundStartedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      transport: {
        select: {
          id: true,
          bookingId: true,
          driverId: true,
          type: true,
          status: true,
          pickupLocation: true,
          pickupTime: true,
          driver: {
            select: {
              id: true,
              vehicleType: true,
              vehicleNumber: true,
              available: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  role: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(bookings);
}

function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined;
}

function isSerializationConflict(error: unknown) {
  return prismaCode(error) === "P2034";
}

async function findIdempotentBooking(key: string, userId: string) {
  const existing = await prisma.booking.findUnique({
    where: { idempotencyKey: key },
    include: { club: true, package: true, event: true },
  });
  if (!existing) return null;
  if (existing.userId !== userId) throw new Error("Idempotency key already belongs to another booking");
  return existing;
}

export async function POST(req: NextRequest) { 
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = bookingSchema.omit({ userId: true }).parse(await req.json());
    const idempotencyKey = req.headers.get("x-idempotency-key")?.trim();
    if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 200)) return NextResponse.json({ error: "Invalid idempotency key" }, { status: 400 });
    if (idempotencyKey) {
      try {
        const existing = await findIdempotentBooking(idempotencyKey, user.id);
        if (existing) return NextResponse.json(existing, { status: 200 });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Idempotency conflict" }, { status: 409 });
      }
    }

    let booking;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        booking = await prisma.$transaction(async tx => {
          const pkg = await tx.package.findUnique({ where: { id: body.packageId } });
          if (!pkg || !pkg.active) throw new Error("Package unavailable");
          const club = await tx.club.findUnique({ where: { id: body.clubId } });
          if (!club || !club.active || pkg.clubId !== club.id) throw new Error("Club unavailable");
          if (body.visitDate.getTime() < Date.now() - 60_000) throw new Error("Visit date must be in the future");

          const event = await tx.event.findFirst({ where: { id: body.eventId, clubId: club.id, active: true } });
          if (!event || event.date.toDateString() !== body.visitDate.toDateString()) {
            throw new Error("Selected event is not available on this date");
          }

          if (event.capacity) {
            const reserved = await tx.booking.aggregate({
              where: { eventId: event.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } },
              _sum: { guestCount: true },
            });
            if ((reserved._sum.guestCount ?? 0) + body.guestCount > event.capacity) {
              throw new Error("Event capacity is full for this group size");
            }
          }

          if (body.transportType !== "NONE" && (!body.pickupLocation || !body.pickupTime)) {
            throw new Error("Pickup location and time are required for transport");
          }

          const amounts = calculateBookingAmounts(Number(pkg.price), body.guestCount, pkg.pricing);
          return tx.booking.create({
            data: {
              bookingCode: createBookingCode(),
              idempotencyKey: idempotencyKey || undefined,
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
              expiresAt: new Date(Date.now() + PAYMENT_HOLD_MINUTES * 60_000),
            },
            include: { club: true, package: true, event: true },
          });
        }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
        break;
      } catch (error) {
        if (prismaCode(error) === "P2002" && idempotencyKey) {
          const existing = await findIdempotentBooking(idempotencyKey, user.id);
          if (existing) {
            booking = existing;
            break;
          }
        }
        if (!isSerializationConflict(error) || attempt === 2) throw error;
      }
    }

    if (!booking) return NextResponse.json({ error: "Unable to reserve the booking. Please retry." }, { status: 409 });
    notifyBookingCreated(booking.id).catch(() => undefined);
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    if (isSerializationConflict(error)) {
      return NextResponse.json({ error: "Booking conflicted with another reservation attempt. Please retry." }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid booking request" }, { status: 400 });
  }
}
