import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { notifyBookingConfirmed } from "@/lib/notifications";
import { z } from "zod";

const webhookEventSchema = z.enum(["payment.captured", "order.paid", "payment.failed"]);
const webhookEventIdSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);

const webhookEntitySchema = z.object({
  id: z.string().trim().min(1).max(100),
  order_id: z.string().trim().min(1).max(100),
  amount: z.number().int().nonnegative(),
  currency: z.string().trim().length(3),
});

function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined;
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
  const signature = req.headers.get("x-razorpay-signature") || "";
  try {
    if (!signature || !verifyWebhookSignature(raw, signature)) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    const payload = JSON.parse(raw);
    const event = String(payload.event || "").trim();
    const eventId = String(payload.id || "").trim();
    if (!event || event.length > 100 || !webhookEventIdSchema.safeParse(eventId).success) return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    const eventResult = webhookEventSchema.safeParse(event);
    if (!eventResult.success) {
      await prisma.paymentWebhookEvent.upsert({
        where: { eventId },
        create: { provider: "razorpay", eventId, event, payload, status: "PROCESSED", processedAt: new Date() },
        update: { status: "PROCESSED", processedAt: new Date(), error: null },
      });
      return NextResponse.json({ received: true, ignored: true });
    }
    const entityResult = webhookEntitySchema.safeParse(payload.payload?.payment?.entity);
    if (!entityResult.success) return NextResponse.json({ received: true });
    const entity = entityResult.data;
    {
      const existingEvent = await prisma.paymentWebhookEvent.findUnique({ where: { eventId } });
      if (existingEvent?.status === "PROCESSED") return NextResponse.json({ received: true, duplicate: true });
      if (!existingEvent) {
        await prisma.paymentWebhookEvent.create({ data: { provider: "razorpay", eventId, event, payload } }).catch(error => {
          if (!(error instanceof Error && error.message.toLowerCase().includes("unique"))) throw error;
        });
      }
    }

    const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: entity.order_id } });
    if (!payment) return NextResponse.json({ received: true });
    const amountPaise = entity.amount;
    if (!Number.isSafeInteger(amountPaise) || amountPaise !== Math.round(Number(payment.amount) * 100) || entity.currency !== "INR") {
      return NextResponse.json({ error: "Webhook payment amount or currency mismatch" }, { status: 400 });
    }

    if (event === "payment.captured" || event === "order.paid") {
      if (payment.status === "PAID" && payment.gatewayPaymentId === entity.id) return NextResponse.json({ received: true, duplicate: true });
      let confirmed = false;
      try {
        await prisma.$transaction(async tx => {
          const current = await tx.payment.findUnique({ where: { id: payment.id } });
          if (!current || current.status === "PAID" || current.status === "REFUNDED") return;
          if (current.gatewayPaymentId && current.gatewayPaymentId !== String(entity.id)) {
            throw new Error("Payment is already linked to a different gateway payment");
          }
          const booking = await tx.booking.findUnique({ where: { id: current.bookingId } });
          if (!booking) return;
          if (booking.status !== "PENDING_PAYMENT" || booking.expiresAt <= new Date()) throw new Error("BOOKING_PAYMENT_HOLD_EXPIRED");
          const claimed = await tx.payment.updateMany({ where: { id: current.id, status: { in: ["PENDING", "FAILED", "PARTIAL"] }, gatewayPaymentId: current.gatewayPaymentId || null }, data: { status: "PAID", gatewayPaymentId: String(entity.id), webhookEventId: eventId || null, gateway: "razorpay" } });
          if (claimed.count !== 1) return;
          const aggregate = await tx.payment.aggregate({ where: { bookingId: current.bookingId, status: "PAID" }, _sum: { amount: true } });
          const paid = Number(aggregate._sum.amount || 0);
          confirmed = paid >= Number(booking.advanceAmount);
          await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus: paid >= Number(booking.totalAmount) ? "PAID" : "PARTIAL", status: confirmed ? "CONFIRMED" : "PENDING_PAYMENT" } });
        });
      } catch (error) {
        if (eventId && error instanceof Error && error.message.toLowerCase().includes("unique")) return NextResponse.json({ received: true, duplicate: true });
        if (prismaCode(error) === "P2034") return NextResponse.json({ received: true, retry: true }, { status: 409 });
        if (error instanceof Error && error.message === "BOOKING_PAYMENT_HOLD_EXPIRED") return NextResponse.json({ received: true, retry: false, reconciliationRequired: true }, { status: 409 });
        throw error;
      }
      if (eventId) await prisma.paymentWebhookEvent.update({ where: { eventId }, data: { status: "PROCESSED", processedAt: new Date(), error: null } });
      if (confirmed) notifyBookingConfirmed(payment.bookingId).catch(() => undefined);
    } else if (event === "payment.failed") {
      await prisma.$transaction(async tx => {
        const current = await tx.payment.findUnique({ where: { id: payment.id } });
        if (!current || current.status === "PAID" || current.status === "REFUNDED") return;
        if (current.gatewayPaymentId && current.gatewayPaymentId !== String(entity.id)) return;
        const claimed = await tx.payment.updateMany({
          where: { id: current.id, status: { in: ["PENDING", "FAILED", "PARTIAL"] }, gatewayPaymentId: current.gatewayPaymentId || null },
          data: { status: "FAILED", gatewayPaymentId: String(entity.id), webhookEventId: eventId || null, gateway: "razorpay" },
        });
        if (claimed.count !== 1) return;
      });
    }
    if (eventId) {
      await prisma.paymentWebhookEvent.update({
        where: { eventId },
        data: { status: "PROCESSED", processedAt: new Date(), error: null },
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook processing failed";
    try {
      const payload = JSON.parse(raw);
      const eventId = String(payload.id || "");
      if (eventId) await prisma.paymentWebhookEvent.updateMany({ where: { eventId }, data: { status: "FAILED", error: message } });
    } catch {}
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 400 });
  }
}
