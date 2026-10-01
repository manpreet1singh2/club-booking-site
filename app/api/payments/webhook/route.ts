import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { notifyBookingConfirmed } from "@/lib/notifications";
import { z } from "zod";

const webhookEventSchema = z.enum(["payment.captured", "order.paid", "payment.failed"]);
const webhookEventIdSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);

const WEBHOOK_PROCESSING_STALE_MS = 5 * 60 * 1000;

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
        where: { provider_eventId: { provider: "razorpay", eventId } },
        create: { provider: "razorpay", eventId, event, payload, status: "PROCESSED", processedAt: new Date() },
        update: { status: "PROCESSED", processingStartedAt: null, processedAt: new Date(), error: null },
      });
      return NextResponse.json({ received: true, ignored: true });
    }
    const entityResult = webhookEntitySchema.safeParse(payload.payload?.payment?.entity);
    if (!entityResult.success) {
      await prisma.paymentWebhookEvent.upsert({
        where: { provider_eventId: { provider: "razorpay", eventId } },
        create: { provider: "razorpay", eventId, event, payload, status: "FAILED", error: "Invalid webhook payment entity" },
        update: { status: "FAILED", processingStartedAt: null, error: "Invalid webhook payment entity" },
      });
      return NextResponse.json({ received: true, retry: true }, { status: 409 });
    }
    const entity = entityResult.data;
    {
      const existingEvent = await prisma.paymentWebhookEvent.findUnique({
        where: { provider_eventId: { provider: "razorpay", eventId } },
      });
      if (existingEvent?.status === "PROCESSED") return NextResponse.json({ received: true, duplicate: true });
      if (existingEvent?.status === "PROCESSING") {
        const staleBefore = new Date(Date.now() - WEBHOOK_PROCESSING_STALE_MS);
        if (!existingEvent.processingStartedAt || existingEvent.processingStartedAt > staleBefore) {
          return NextResponse.json({ received: true, retry: true }, { status: 409 });
        }
        const reclaimed = await prisma.paymentWebhookEvent.updateMany({
          where: {
            provider: "razorpay",
            eventId,
            status: "PROCESSING",
            processingStartedAt: { lte: staleBefore },
          },
          data: { processingStartedAt: new Date(), error: null },
        });
        if (reclaimed.count !== 1) {
          return NextResponse.json({ received: true, retry: true }, { status: 409 });
        }
      }
      if (!existingEvent) {
        try {
          await prisma.paymentWebhookEvent.create({ data: { provider: "razorpay", eventId, event, payload, status: "PROCESSING", processingStartedAt: new Date() } });
        } catch (error) {
          if (prismaCode(error) !== "P2002") throw error;
          const racedEvent = await prisma.paymentWebhookEvent.findUnique({
            where: { provider_eventId: { provider: "razorpay", eventId } },
          });
          if (racedEvent?.status === "PROCESSED") return NextResponse.json({ received: true, duplicate: true });
          if (racedEvent?.status === "PROCESSING") {
            const staleBefore = new Date(Date.now() - WEBHOOK_PROCESSING_STALE_MS);
            if (!racedEvent.processingStartedAt || racedEvent.processingStartedAt > staleBefore) {
              return NextResponse.json({ received: true, retry: true }, { status: 409 });
            }
            const reclaimed = await prisma.paymentWebhookEvent.updateMany({
              where: {
                provider: "razorpay",
                eventId,
                status: "PROCESSING",
                processingStartedAt: { lte: staleBefore },
              },
              data: { processingStartedAt: new Date(), error: null },
            });
            if (reclaimed.count !== 1) {
              return NextResponse.json({ received: true, retry: true }, { status: 409 });
            }
          }
          throw error;
        }
      } else {
        const claimed = await prisma.paymentWebhookEvent.updateMany({
          where: { provider: "razorpay", eventId, status: { in: ["RECEIVED", "FAILED"] } },
          data: { status: "PROCESSING", processingStartedAt: new Date(), error: null },
        });
        if (claimed.count !== 1) return NextResponse.json({ received: true, retry: true }, { status: 409 });
      }
    }

    const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: entity.order_id } });
    if (!payment) {
      await prisma.paymentWebhookEvent.updateMany({ where: { provider: "razorpay", eventId }, data: { status: "FAILED", processingStartedAt: null, error: "Payment order not found" } });
      return NextResponse.json({ received: true, retry: true }, { status: 409 });
    }
    const amountPaise = entity.amount;
    if (!Number.isSafeInteger(amountPaise) || amountPaise !== Math.round(Number(payment.amount) * 100) || entity.currency !== "INR") {
      await prisma.paymentWebhookEvent.updateMany({ where: { provider: "razorpay", eventId }, data: { status: "FAILED", processingStartedAt: null, error: "Webhook payment amount or currency mismatch" } });
      return NextResponse.json({ error: "Webhook payment amount or currency mismatch" }, { status: 400 });
    }

    if (event === "payment.captured" || event === "order.paid") {
      if (payment.status === "PAID" && payment.gatewayPaymentId === entity.id) {
        await prisma.paymentWebhookEvent.updateMany({ where: { provider: "razorpay", eventId }, data: { status: "PROCESSED", processingStartedAt: null, processedAt: new Date(), error: null } });
        return NextResponse.json({ received: true, duplicate: true });
      }
      let confirmed = false;
      try {
        await prisma.$transaction(async tx => {
          const current = await tx.payment.findUnique({ where: { id: payment.id } });
          if (!current || current.status === "PAID" || current.status === "REFUNDED") return;
          if (current.gatewayPaymentId && current.gatewayPaymentId !== String(entity.id)) {
            throw new Error("Payment is already linked to a different gateway payment");
          }
          const booking = await tx.booking.findUnique({ where: { id: current.bookingId } });
          if (!booking) throw new Error("BOOKING_NOT_FOUND");
          if (booking.status !== "PENDING_PAYMENT" || booking.expiresAt <= new Date()) throw new Error("BOOKING_PAYMENT_HOLD_EXPIRED");
          const claimed = await tx.payment.updateMany({ where: { id: current.id, status: { in: ["PENDING", "FAILED", "PARTIAL"] }, gatewayPaymentId: current.gatewayPaymentId || null }, data: { status: "PAID", gatewayPaymentId: String(entity.id), webhookEventId: eventId || null, gateway: "razorpay" } });
          if (claimed.count !== 1) return;
          const aggregate = await tx.payment.aggregate({ where: { bookingId: current.bookingId, status: "PAID" }, _sum: { amount: true } });
          const paid = Number(aggregate._sum.amount || 0);
          confirmed = paid >= Number(booking.advanceAmount);
          await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus: paid >= Number(booking.totalAmount) ? "PAID" : "PARTIAL", status: confirmed ? "CONFIRMED" : "PENDING_PAYMENT" } });
        });
      } catch (error) {
        if (eventId && error instanceof Error && error.message.toLowerCase().includes("unique")) {
          await prisma.paymentWebhookEvent.updateMany({ where: { provider: "razorpay", eventId }, data: { status: "FAILED", processingStartedAt: null, error: "Webhook finalization conflict" } });
          return NextResponse.json({ received: true, retry: true }, { status: 409 });
        }
        if (prismaCode(error) === "P2034") return NextResponse.json({ received: true, retry: true }, { status: 409 });
        if (error instanceof Error && error.message === "BOOKING_PAYMENT_HOLD_EXPIRED") return NextResponse.json({ received: true, retry: false, reconciliationRequired: true }, { status: 409 });
        if (error instanceof Error && error.message === "BOOKING_NOT_FOUND") return NextResponse.json({ received: true, retry: false, reconciliationRequired: true }, { status: 409 });
        throw error;
      }
      if (eventId) await prisma.paymentWebhookEvent.update({ where: { eventId }, data: { status: "PROCESSED", processingStartedAt: null, processedAt: new Date(), error: null } });
      if (confirmed) notifyBookingConfirmed(payment.bookingId).catch(() => undefined);
    } else if (event === "payment.failed") {
      try {
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
      } catch (error) {
        if (prismaCode(error) === "P2034") {
          return NextResponse.json({ received: true, retry: true }, { status: 409 });
        }
        throw error;
      }
    }
    if (eventId) {
      await prisma.paymentWebhookEvent.update({
        where: { provider_eventId: { provider: "razorpay", eventId } },
        data: { status: "PROCESSED", processingStartedAt: null, processedAt: new Date(), error: null },
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook processing failed";
    try {
      const payload = JSON.parse(raw);
      const eventId = String(payload.id || "");
      if (eventId) await prisma.paymentWebhookEvent.updateMany({ where: { provider: "razorpay", eventId }, data: { status: "FAILED", processingStartedAt: null, error: message } });
    } catch {}
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 400 });
  }
}
