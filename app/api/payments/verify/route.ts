import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyRazorpaySignature, fetchRazorpayPayment } from "@/lib/razorpay";
import { applyCapturedPayment } from "@/lib/payments";

const paymentVerificationSchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(100),
  razorpay_payment_id: z.string().trim().min(1).max(100),
  razorpay_signature: z.string().trim().min(1).max(500),
});

/** Browser callback after Razorpay checkout. The webhook applies the same logic, so whichever arrives first wins. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const parsed = paymentVerificationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Incomplete or invalid payment verification data" }, { status: 400 });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;

  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: orderId }, select: { id: true, amount: true, booking: { select: { id: true, userId: true } } } });
  if (!payment) return NextResponse.json({ error: "Payment order not found" }, { status: 404 });
  if (payment.booking.userId !== user.id && user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!verifyRazorpaySignature(orderId, paymentId, signature)) return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });

  try {
    // Signature proves authenticity; the API call proves the money was actually captured for the right amount.
    const gatewayPayment = await fetchRazorpayPayment(paymentId);
    if (gatewayPayment.id !== paymentId || gatewayPayment.order_id !== orderId || gatewayPayment.currency !== "INR" || gatewayPayment.amount !== Math.round(Number(payment.amount) * 100) || gatewayPayment.status !== "captured") {
      return NextResponse.json({ error: "Payment is not captured yet. Your booking will update automatically once the bank confirms." }, { status: 409 });
    }
    const result = await applyCapturedPayment({ paymentRowId: payment.id, gatewayPaymentId: paymentId, signature });
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: payment.booking.id }, select: { id: true, status: true, paymentStatus: true } });
    const body = result.outcome === "REFUND_REQUIRED"
      ? { ok: false, refundRequired: true, message: "Payment received, but this booking could not be confirmed. A refund has been queued.", booking }
      : { ok: true, alreadyProcessed: result.outcome === "ALREADY_PROCESSED", booking };
    return NextResponse.json(body, { status: result.outcome === "REFUND_REQUIRED" ? 409 : 200, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("payment verification failed", error);
    return NextResponse.json({ error: "Payment verification failed. If money was deducted, your booking will update automatically." }, { status: 502 });
  }
}
