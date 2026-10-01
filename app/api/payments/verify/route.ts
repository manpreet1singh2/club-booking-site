import { NextResponse } from "next/server";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyRazorpaySignature, fetchRazorpayPayment } from "@/lib/razorpay";
import { notifyBookingConfirmed } from "@/lib/notifications";
import { z } from "zod";

const paymentVerificationSchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(100),
  razorpay_payment_id: z.string().trim().min(1).max(100),
  razorpay_signature: z.string().trim().min(1).max(500),
});

export async function POST(req: Request) {
    if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const parsed = paymentVerificationSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Incomplete or invalid payment verification data" }, { status: 400 });
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;

    const payment = await prisma.payment.findUnique({
      where: { gatewayOrderId: orderId },
      select: {
        id: true,
        bookingId: true,
        amount: true,
        status: true,
        gatewayPaymentId: true,
        booking: {
          select: {
            id: true,
            userId: true,
            totalAmount: true,
            advanceAmount: true,
            status: true,
            expiresAt: true,
          },
        },
      },
    });
    if (!payment) return NextResponse.json({ error: "Payment order not found" }, { status: 404 });
    if (payment.booking.userId !== user.id && user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (payment.status === "PAID") return NextResponse.json({ ok: true, alreadyProcessed: true });
    if (payment.booking.status !== "PENDING_PAYMENT" && payment.status !== "PAID") return NextResponse.json({ error: "Booking is no longer awaiting initial payment" }, { status: 400 });
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
    if (Number(payment.amount) !== Number(payment.booking.advanceAmount)) return NextResponse.json({ error: "Payment amount does not match the expected advance" }, { status: 400 });
    const gatewayPayment = await fetchRazorpayPayment(paymentId);
    if (gatewayPayment.id !== paymentId || gatewayPayment.order_id !== orderId || gatewayPayment.currency !== "INR" || gatewayPayment.amount !== Math.round(Number(payment.amount) * 100) || !["captured"].includes(gatewayPayment.status)) {
      return NextResponse.json({ error: "Gateway payment verification failed" }, { status: 400 });
    }

    const result = await prisma.$transaction(async tx => {
      const bookingState = await tx.booking.findUnique({ where: { id: payment.bookingId } });
      if (!bookingState || bookingState.status !== "PENDING_PAYMENT" || bookingState.expiresAt <= new Date()) throw new Error("BOOKING_PAYMENT_HOLD_EXPIRED");
      const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "FAILED", "PARTIAL"] }, gatewayPaymentId: null }, data: { status: "PAID", gatewayPaymentId: paymentId, gatewaySignature: signature } });
      if (claimed.count !== 1) {
        const current = await tx.payment.findUnique({ where: { id: payment.id } });
        if (current?.status === "PAID" && current.gatewayPaymentId === paymentId) return { updatedPayment: current, updatedBooking: payment.booking, alreadyProcessed: true };
        throw new Error("PAYMENT_STATE_CONFLICT");
      }
      const updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const aggregate = await tx.payment.aggregate({ where: { bookingId: payment.bookingId, status: "PAID" }, _sum: { amount: true } });
      const paid = Number(aggregate._sum.amount || 0);
      const updatedBooking = await tx.booking.update({
        where: { id: payment.bookingId },
        data: { paymentStatus: paid >= Number(payment.booking.totalAmount) ? "PAID" : "PARTIAL", status: paid >= Number(payment.booking.advanceAmount) ? "CONFIRMED" : "PENDING_PAYMENT" },
      });
      return { updatedPayment: await tx.payment.findUniqueOrThrow({ where: { id: payment.id } }), updatedBooking };
    });

    if (!result.alreadyProcessed && result.updatedBooking.status === "CONFIRMED") notifyBookingConfirmed(result.updatedBooking.id).catch(() => undefined);
    const response = NextResponse.json({
      ok: true,
      booking: {
        id: result.updatedBooking.id,
        status: result.updatedBooking.status,
        paymentStatus: result.updatedBooking.paymentStatus,
      },
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "PAYMENT_STATE_CONFLICT") return NextResponse.json({ error: "Payment was already processed or changed. Refresh the booking." }, { status: 409 });
    if (error instanceof Error && error.message === "BOOKING_PAYMENT_HOLD_EXPIRED") return NextResponse.json({ error: "Booking payment hold has expired. The payment will require reconciliation before the booking can be confirmed." }, { status: 409 });
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2034") return NextResponse.json({ error: "Payment verification conflicted with another transaction. Please retry." }, { status: 409 });
    return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
  }
}
