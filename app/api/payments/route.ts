import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const bookingId = new URL(req.url).searchParams.get("bookingId");
  if (!bookingId) return NextResponse.json({ error: "bookingId is required" }, { status: 400 });

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const privileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  if (booking.userId !== user.id && !privileged) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payments = await prisma.payment.findMany({ where: { bookingId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(payments);
}

// This endpoint records provider-confirmed payments only.
// Client-side callers cannot mark a payment as PAID.
export async function POST(req: NextRequest) {
  if(!isSameOrigin(req))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Payment confirmation is provider-controlled" }, { status: 403 });

  try {
    const body = await req.json();
    const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
    const gateway = typeof body.gateway === "string" ? body.gateway.trim().slice(0, 50) : "manual";
    const transactionId = typeof body.transactionId === "string" ? body.transactionId.trim().slice(0, 100) : null;
    const amount = Number(body.amount);
    const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || "";

    if (!bookingId || bookingId.length > 100) {
      return NextResponse.json({ error: "Invalid booking ID" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    }
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: "A valid x-idempotency-key is required" }, { status: 400 });
    }

    const result = await prisma.$transaction(async tx => {
      const replay = await tx.payment.findUnique({
        where: { orderCreationKey: `manual:${bookingId}:${idempotencyKey}` },
      });
      if (replay) {\n        const sameRequest = Number(replay.amount) === amount && replay.gateway === (gateway || "manual") && replay.transactionId === transactionId;\n        if (!sameRequest) return { error: "Idempotency key was already used for a different payment", status: 409 };\n        return { payment: replay };\n      }

      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { payments: { where: { status: "PAID" }, select: { amount: true } } },
      });
      if (!booking) return { error: "Booking not found", status: 404 };

      const expectedRemaining = Math.max(
        0,
        Number(booking.totalAmount) - booking.payments.reduce((sum, p) => sum + Number(p.amount), 0),
      );
      if (amount > expectedRemaining) {
        return { error: "Payment exceeds the booking's outstanding balance", status: 400 };
      }

      const payment = await tx.payment.create({
        data: {
          bookingId: booking.id,
          amount,
          status: "PAID",
          orderCreationKey: `manual:${booking.id}:${idempotencyKey}`,
          gateway: gateway || "manual",
          transactionId,
        },
      });

      const paidTotal = Number(
        (await tx.payment.aggregate({
          where: { bookingId: booking.id, status: "PAID" },
          _sum: { amount: true },
        }))._sum.amount || 0,
      );

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: paidTotal >= Number(booking.totalAmount) ? "PAID" : "PARTIAL",
          status: paidTotal >= Number(booking.advanceAmount) ? "CONFIRMED" : "PENDING_PAYMENT",
        },
      });

      return { payment };
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.payment, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to record payment" }, { status: 400 });
  }
}
