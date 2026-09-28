import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRazorpayOrder } from "@/lib/razorpay";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const { bookingId } = await req.json();
    const booking = await prisma.booking.findUnique({ where: { id: String(bookingId) } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (booking.userId !== user.id && user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (booking.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Booking is not awaiting payment" }, { status: 400 });

    const existing = await prisma.payment.findFirst({ where: { bookingId: booking.id, status: "PENDING", gatewayOrderId: { not: null } } });
    if (existing?.gatewayOrderId) return NextResponse.json({ orderId: existing.gatewayOrderId, amount: Number(booking.advanceAmount), currency: "INR", keyId: process.env.PAYMENT_KEY_ID });

    const expectedAdvance = Number(booking.advanceAmount);
    if (!Number.isFinite(expectedAdvance) || expectedAdvance <= 0) return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    const order = await createRazorpayOrder(expectedAdvance, booking.bookingCode);
    await prisma.payment.create({
      data: { bookingId: booking.id, amount: booking.advanceAmount, status: "PENDING", gateway: "razorpay", gatewayOrderId: order.id },
    });

    return NextResponse.json({ orderId: order.id, amount: Number(booking.advanceAmount), currency: "INR", keyId: process.env.PAYMENT_KEY_ID });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create payment order" }, { status: 400 });
  }
}
