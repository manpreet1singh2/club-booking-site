import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchRazorpayRefunds } from "@/lib/razorpay";
import { writeAuditLog } from "@/lib/audit";
import { z } from "zod";

const requestSchema = z.object({ paymentId: z.string().trim().min(1).max(100) });

export async function POST(req: Request) {
  const u = await getCurrentUser();
  if (!u || u.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "paymentId is required and must be valid" }, { status: 400 });

    const payment = await prisma.payment.findUnique({ where: { id: parsed.data.paymentId } });
    if (!payment || !payment.gatewayPaymentId) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    if (!payment.refundStartedAt) return NextResponse.json({ error: "Payment has no pending refund claim" }, { status: 400 });

    const refunds = await fetchRazorpayRefunds(payment.gatewayPaymentId);
    const receipt = payment.refundReceipt || "refund:" + payment.id;
    const matched = refunds.items.find(item => item.receipt === receipt);
    if (!matched) return NextResponse.json({ reconciled: false, message: "No matching gateway refund found. Do not retry automatically." });
    const expectedAmountPaise = Math.round(Number(payment.amount) * 100);
    if (!Number.isSafeInteger(expectedAmountPaise) || matched.amount !== expectedAmountPaise || matched.payment_id !== payment.gatewayPaymentId) {
      return NextResponse.json({ reconciled: false, message: "Gateway refund details do not match the local payment. Manual reconciliation required." }, { status: 409 });
    }
    if (matched.status !== "processed") {
      return NextResponse.json({ reconciled: false, message: "Gateway refund exists but is not processed yet. Do not retry automatically." }, { status: 409 });
    }

    const saved = await prisma.payment.updateMany({
      where: { id: payment.id, status: "PAID", refundId: null, refundStartedAt: { not: null } },
      data: {
        refundId: matched.id,
        refundReceipt: matched.receipt || receipt,
        refundedAmount: Number(matched.amount) / 100,
        refundStartedAt: null,
        status: "REFUNDED",
      },
    });
    if (saved.count !== 1) return NextResponse.json({ reconciled: true, duplicate: true });

    const remaining = await prisma.payment.count({ where: { bookingId: payment.bookingId, status: "PAID", gatewayPaymentId: { not: null } } });
    if (remaining === 0) {
      await prisma.booking.updateMany({
        where: { id: payment.bookingId, status: "REFUND_PENDING" },
        data: { status: "REFUNDED", paymentStatus: "REFUNDED" },
      });
    }

    await writeAuditLog({
      userId: u.id,
      action: "PAYMENT_REFUND_RECONCILED",
      entity: "Payment",
      entityId: payment.id,
      metadata: { bookingId: payment.bookingId, refundId: matched.id, amount: Number(matched.amount) / 100, receipt },
    });

    return NextResponse.json({ reconciled: true, refundId: matched.id, amount: Number(matched.amount) / 100 });
  } catch (error) {
    console.error("Refund reconciliation failed", error);
    return NextResponse.json({ error: "Refund reconciliation failed. Verify the gateway status and retry." }, { status: 502 });
  }
}
