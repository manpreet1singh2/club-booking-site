import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { notifyBookingConfirmed } from "@/lib/notifications";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const body = await req.json();
    const orderId = String(body.razorpay_order_id || "");
    const paymentId = String(body.razorpay_payment_id || "");
    const signature = String(body.razorpay_signature || "");
    if (!orderId || !paymentId || !signature) return NextResponse.json({ error: "Incomplete payment verification" }, { status: 400 });

    const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: orderId }, include: { booking: true } });
    if (!payment) return NextResponse.json({ error: "Payment order not found" }, { status: 404 });
    if (payment.booking.userId !== user.id && user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (payment.status === "PAID") return NextResponse.json({ ok: true, alreadyProcessed: true });
    if (payment.booking.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Booking is no longer awaiting initial payment" }, { status: 400 });
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
    if (Number(payment.amount) !== Number(payment.booking.advanceAmount)) return NextResponse.json({ error: "Payment amount does not match the expected advance" }, { status: 400 });

    const result = await prisma.$transaction(async tx => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { status: "PAID", gatewayPaymentId: paymentId, gatewaySignature: signature },
      });
      const aggregate = await tx.payment.aggregate({ where: { bookingId: payment.bookingId, status: "PAID" }, _sum: { amount: true } });
      const paid = Number(aggregate._sum.amount || 0);
      const updatedBooking = await tx.booking.update({
        where: { id: payment.bookingId },
        data: { paymentStatus: paid >= Number(payment.booking.totalAmount) ? "PAID" : "PARTIAL", status: paid >= Number(payment.booking.advanceAmount) ? "CONFIRMED" : "PENDING_PAYMENT" },
      });
      return { updatedPayment, updatedBooking };
    });

    if (result.updatedBooking.status === "CONFIRMED") notifyBookingConfirmed(result.updatedBooking.id).catch(() => undefined);
    return NextResponse.json({ ok: true, booking: result.updatedBooking });
  } catch {
    return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
  }
}
