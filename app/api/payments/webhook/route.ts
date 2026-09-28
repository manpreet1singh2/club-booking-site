import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { notifyBookingConfirmed } from "@/lib/notifications";

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";
  try {
    if (!signature || !verifyWebhookSignature(raw, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }

    const payload = JSON.parse(raw);
    const event = String(payload.event || "");
    const entity = payload.payload?.payment?.entity;
    if (!entity?.order_id || !entity?.id) if (booking && event === "payment.captured") notifyBookingConfirmed(booking.bookingId).catch(() => undefined);
    return NextResponse.json({ received: true });

    const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: String(entity.order_id) } });
    if (!payment) return NextResponse.json({ received: true });

    if (event === "payment.captured" || event === "order.paid") {
      await prisma.$transaction(async tx => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            gatewayPaymentId: String(entity.id),
          },
        });
        const aggregate = await tx.payment.aggregate({
          where: { bookingId: payment.bookingId, status: "PAID" },
          _sum: { amount: true },
        });
        const paid = Number(aggregate._sum.amount || 0);
        const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
        if (!booking) return;
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: paid >= Number(booking.totalAmount) ? "PAID" : "PARTIAL",
            status: paid >= Number(booking.advanceAmount) ? "CONFIRMED" : "PENDING_PAYMENT",
          },
        });
      });
    } else if (event === "payment.failed") {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", gatewayPaymentId: String(entity.id) } });
    }

    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 400 });
  }
}
