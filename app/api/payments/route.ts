import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
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
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Payment confirmation is provider-controlled" }, { status: 403 });

  try {
    const body = await req.json();
    const booking = await prisma.booking.findUnique({ where: { id: String(body.bookingId) } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amount,
        status: "PAID",
        gateway: String(body.gateway || "manual"),
        transactionId: body.transactionId ? String(body.transactionId) : null,
      },
    });

    const paidTotal = Number((await prisma.payment.aggregate({
      where: { bookingId: booking.id, status: "PAID" },
      _sum: { amount: true },
    }))._sum.amount || 0);

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: paidTotal >= Number(booking.totalAmount) ? "PAID" : "PARTIAL",
        status: paidTotal >= Number(booking.advanceAmount) ? "CONFIRMED" : "PENDING_PAYMENT",
      },
    });

    return NextResponse.json(payment, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to record payment" }, { status: 400 });
  }
}
