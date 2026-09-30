import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRazorpayRefund } from "@/lib/razorpay";
import { writeAuditLog } from "@/lib/audit";

export async function POST(req: Request) {
  const u = await getCurrentUser();
  if (!u || u.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { bookingId } = await req.json();
    if (!bookingId) return NextResponse.json({ error: "bookingId is required" }, { status: 400 });

    const booking = await prisma.booking.findUnique({ where: { id: String(bookingId) }, include: { payments: true } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (booking.status !== "REFUND_PENDING" && booking.status !== "REFUNDED") {
      return NextResponse.json({ error: "Booking must be refund-pending or already refunded" }, { status: 400 });
    }

    const captured = booking.payments.filter(p => p.status === "PAID" && p.gatewayPaymentId);
    const results: Array<{ paymentId: string; refundId: string; amount: number }> = [];

    for (const payment of captured) {
      const receipt = "refund:" + payment.id;
      if (payment.refundId) continue;
      const amount = Number(payment.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const claim = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PAID", refundId: null, refundStartedAt: null },
        data: { refundStartedAt: new Date() },
      });
      if (claim.count !== 1) {
        const current = await prisma.payment.findUnique({ where: { id: payment.id } });
        if (current?.refundId) continue;
        return NextResponse.json({ error: "Refund is already being processed for this payment" }, { status: 409 });
      }

      let refund;
      try {
        refund = await createRazorpayRefund(payment.gatewayPaymentId!, amount, receipt);
      } catch (error) {
        const existing = await prisma.payment.findUnique({ where: { refundReceipt: receipt } });
        if (existing?.refundId) {
          refund = { id: existing.refundId, amount: Number(existing.refundedAmount), status: "processed", payment_id: payment.gatewayPaymentId! };
        } else {
          throw error;
        }
      }

      const saved = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PAID", refundId: null, refundStartedAt: { not: null } },
        data: { refundId: refund.id, refundReceipt: receipt, refundedAmount: amount, refundStartedAt: null, status: "REFUNDED" },
      });

      if (saved.count === 1) {
        results.push({ paymentId: payment.id, refundId: refund.id, amount });
        await writeAuditLog({
          userId: u.id,
          action: "PAYMENT_REFUNDED",
          entity: "Payment",
          entityId: payment.id,
          metadata: { bookingId: booking.id, refundId: refund.id, amount, receipt },
        });
      }
    }

    const remaining = await prisma.payment.count({ where: { bookingId: booking.id, status: "PAID", gatewayPaymentId: { not: null } } });
    if (remaining === 0 && booking.status !== "REFUNDED") {
      await prisma.booking.updateMany({
        where: { id: booking.id, status: "REFUND_PENDING" },
        data: { status: "REFUNDED", paymentStatus: "REFUNDED" },
      });
    }

    return NextResponse.json({
      ok: true,
      refunds: results,
      totalRefunded: results.reduce((n, r) => n + r.amount, 0),
      completed: remaining === 0,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Refund failed" }, { status: 400 });
  }
}
