import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { bookingSchema } from "@/lib/validation";
import { calculateBookingAmounts, createBookingCode, eventStartsAt, evaluatePromo, validateBookingRules, PAYMENT_HOLD_MINUTES } from "@/lib/booking";
import { notifyBookingCreated } from "@/lib/notifications";


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
      bookingType: true,
      guestCount: true,
      transportType: true,
      subtotalAmount: true,
      discountAmount: true,
      cancellationReason: true,
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
  const responseBookings = user.role === "CUSTOMER"
    ? bookings
    : bookings.map(({ ticketToken: _ticketToken, ...booking }) => booking);
  return NextResponse.json(responseBookings,{headers:{"Cache-Control":"private, no-store, max-age=0"}});
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
    select: { id:true, bookingCode:true, userId:true, clubId:true, eventId:true, packageId:true, guestCount:true, transportType:true, visitDate:true, pickupLocation:true, pickupTime:true, totalAmount:true, advanceAmount:true, remainingAmount:true, expiresAt:true, ticketToken:true, status:true, paymentStatus:true, createdAt:true, updatedAt:true, club:{select:{id:true,name:true,slug:true,city:true,address:true,active:true}}, package:{select:{id:true,name:true,description:true,price:true,pricing:true,active:true}}, event:{select:{id:true,name:true,slug:true,date:true,startTime:true,endTime:true,capacity:true,active:true}} },
  });
  if (!existing) return null;
  if (existing.userId !== userId) throw new Error("Idempotency key already belongs to another booking");
  return existing;
}

class BookingError extends Error {}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (user.role !== "CUSTOMER" && user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only customer accounts can book" }, { status: 403 });
    if (!user.phone) return NextResponse.json({ error: "Add your WhatsApp number in your profile before booking, so we can send your ticket." }, { status: 400 });
    const parsed = bookingSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid booking request" }, { status: 400 });
    const body = parsed.data;
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
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        booking = await prisma.$transaction(async tx => {
          const now = new Date();
          const pkg = await tx.package.findUnique({ where: { id: body.packageId } });
          if (!pkg || !pkg.active) throw new BookingError("Package unavailable");
          const club = await tx.club.findUnique({ where: { id: body.clubId } });
          if (!club || !club.active || pkg.clubId !== club.id) throw new BookingError("Club unavailable");
          const event = await tx.event.findFirst({ where: { id: body.eventId, clubId: club.id, active: true } });
          if (!event) throw new BookingError("Selected event is not available");
          const startsAt = eventStartsAt(event.date, event.startTime);
          if (startsAt.getTime() < now.getTime() - 2 * 3_600_000) throw new BookingError("This event has already started");

          const ruleError = validateBookingRules({ bookingType: body.bookingType, guestCount: body.guestCount, packageKind: pkg.kind, transportType: body.transportType });
          if (ruleError) throw new BookingError(ruleError);

          if (body.transportType !== "NONE") {
            const pickup = body.pickupTime!;
            if (pickup.getTime() < now.getTime() + 30 * 60_000) throw new BookingError("Pickup must be at least 30 minutes from now");
            if (pickup > startsAt) throw new BookingError("Pickup must be before the event starts");
            if (startsAt.getTime() - pickup.getTime() > 6 * 3_600_000) throw new BookingError("Pickup must be within 6 hours before the event");
          }

          if (event.capacity) {
            // Expired payment holds no longer reserve seats, even before the cleanup job marks them EXPIRED.
            const reserved = await tx.booking.aggregate({
              where: { eventId: event.id, OR: [{ status: "CONFIRMED" }, { status: "PENDING_PAYMENT", expiresAt: { gt: now } }] },
              _sum: { guestCount: true },
            });
            const left = event.capacity - (reserved._sum.guestCount ?? 0);
            if (body.guestCount > left) throw new BookingError(left > 0 ? `Only ${left} spot${left === 1 ? "" : "s"} left for this event` : "This event is sold out");
          }

          let discount = 0;
          let promoCodeId: string | undefined;
          const base = calculateBookingAmounts(Number(pkg.price), body.guestCount, pkg.pricing);
          if (body.promoCode) {
            const promo = await tx.promoCode.findUnique({ where: { code: body.promoCode } });
            if (!promo) throw new BookingError("Invalid promo code");
            const evaluated = evaluatePromo({ ...promo, value: Number(promo.value), minAmount: Number(promo.minAmount) }, base.subtotalAmount, club.id, now);
            if ("error" in evaluated) throw new BookingError(evaluated.error);
            // Guarded increment: concurrent bookings can't push usage past maxUses.
            const claimed = await tx.promoCode.updateMany({
              where: { id: promo.id, active: true, ...(promo.maxUses !== null ? { usedCount: { lt: promo.maxUses } } : {}) },
              data: { usedCount: { increment: 1 } },
            });
            if (claimed.count !== 1) throw new BookingError("This promo code has reached its usage limit");
            discount = evaluated.discount;
            promoCodeId = promo.id;
          }
          const amounts = calculateBookingAmounts(Number(pkg.price), body.guestCount, pkg.pricing, discount);
          if (amounts.advanceAmount < 1) throw new BookingError("Booking total is too low for online payment");

          return tx.booking.create({
            data: {
              bookingCode: createBookingCode(),
              idempotencyKey: idempotencyKey || undefined,
              userId: user.id,
              clubId: club.id,
              eventId: event.id,
              visitDate: event.date,
              packageId: pkg.id,
              bookingType: body.bookingType,
              guestCount: body.guestCount,
              transportType: body.transportType,
              pickupLocation: body.transportType === "NONE" ? null : body.pickupLocation,
              pickupLat: body.transportType === "NONE" ? null : body.pickupLat,
              pickupLng: body.transportType === "NONE" ? null : body.pickupLng,
              pickupTime: body.transportType === "NONE" ? null : body.pickupTime,
              promoCodeId,
              ...amounts,
              expiresAt: new Date(now.getTime() + PAYMENT_HOLD_MINUTES * 60_000),
            },
            include: { club: { select: { id: true, name: true, slug: true, city: true, address: true } }, package: true, event: true },
          });
        }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
        break;
      } catch (error) {
        if (prismaCode(error) === "P2002" && idempotencyKey) {
          const existing = await findIdempotentBooking(idempotencyKey, user.id);
          if (existing) { booking = existing; break; }
        }
        if (!isSerializationConflict(error) || attempt === 3) throw error;
      }
    }

    if (!booking) return NextResponse.json({ error: "Unable to reserve the booking. Please retry." }, { status: 409 });
    notifyBookingCreated(booking.id).catch(() => undefined);
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    if (error instanceof BookingError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (isSerializationConflict(error)) return NextResponse.json({ error: "Many people are booking this event right now. Please retry." }, { status: 409 });
    console.error("booking creation failed", error);
    return NextResponse.json({ error: "Unable to create booking" }, { status: 500 });
  }
}
