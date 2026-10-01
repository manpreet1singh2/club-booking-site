import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRazorpayOrder } from "@/lib/razorpay";
import { z } from "zod";

const paymentOrderSchema = z.object({ bookingId: z.string().trim().min(1).max(100) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const parsed = paymentOrderSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "bookingId is required and must be valid" }, { status: 400 });
    const { bookingId } = parsed.data;
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (booking.userId !== user.id && user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (booking.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Booking is not awaiting payment" }, { status: 400 });
    if (booking.expiresAt <= new Date()) {
      await prisma.booking.updateMany({ where: { id: booking.id, status: "PENDING_PAYMENT", paymentStatus: "PENDING", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
      return NextResponse.json({ error: "Booking payment hold has expired. Please create a new booking." }, { status: 409 });
    }
    if (!["PENDING","PARTIAL"].includes(booking.paymentStatus)) return NextResponse.json({ error: "Booking payment state does not allow an advance order" }, { status: 400 });

    const existing = await prisma.payment.findUnique({ where: { orderCreationKey: "booking:" + booking.id + ":advance" } });
    if (existing?.status === "PAID" || existing?.status === "REFUNDED") return NextResponse.json({ error: "Advance payment has already been processed" }, { status: 409 });
    if (existing?.gatewayOrderId && existing.status === "PENDING") return NextResponse.json({ orderId: existing.gatewayOrderId, amount: Number(booking.advanceAmount), currency: "INR", keyId: process.env.PAYMENT_KEY_ID });
    if (existing && existing.status === "PENDING") return NextResponse.json({ error: "Payment order is already being created. Please retry shortly." }, { status: 409 });

    const expectedAdvance = Number(booking.advanceAmount);
    if (!Number.isFinite(expectedAdvance) || expectedAdvance <= 0) return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });

    const orderCreationKey = "booking:" + booking.id + ":advance";
    let reservation;
    try {
      if (!reservation) reservation = await prisma.payment.create({ data: { bookingId: booking.id, amount: booking.advanceAmount, status: "PENDING", gateway: "razorpay", orderCreationKey } });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
        const raced = await prisma.payment.findUnique({ where: { orderCreationKey } });
        if (raced?.gatewayOrderId) return NextResponse.json({ orderId: raced.gatewayOrderId, amount: Number(booking.advanceAmount), currency: "INR", keyId: process.env.PAYMENT_KEY_ID });
        return NextResponse.json({ error: "Payment order is already being created. Please retry shortly." }, { status: 409 });
      }
      throw error;
    }

    try {
      const order = await createRazorpayOrder(expectedAdvance, booking.bookingCode);
      await prisma.payment.update({ where: { id: reservation.id }, data: { gatewayOrderId: order.id } });
      return NextResponse.json({ orderId: order.id, amount: expectedAdvance, currency: "INR", keyId: process.env.PAYMENT_KEY_ID });
    } catch (error) {
      await prisma.payment.updateMany({ where: { id: reservation.id, status: "PENDING", gatewayOrderId: null }, data: { status: "FAILED" } });
      throw error;
    }
  } catch (error) {
    console.error("Payment order creation failed", error);
    return NextResponse.json({ error: "Unable to create payment order. Please retry." }, { status: 502 });
  }
}