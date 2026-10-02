import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { applyCapturedPayment, applyFailedPayment, PaymentStateError } from "@/lib/payments";
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
    const auditPayload = {
      eventId,
      event,
      paymentId: typeof payload.payload?.payment?.entity?.id === "string" ? payload.payload.payment.entity.id : null,
      orderId: typeof payload.payload?.payment?.entity?.order_id === "string" ? payload.payload.payment.entity.order_id : null,
      amount: typeof payload.payload?.payment?.entity?.amount === "number" ? payload.payload.payment.entity.amount : null,
      currency: typeof payload.payload?.payment?.entity?.currency === "string" ? payload.payload.payment.entity.currency : null,
    };
    const eventResult = webhookEventSchema.safeParse(event);
    if (!eventResult.success) {
      await prisma.paymentWebhookEvent.upsert({
        where: { provider_eventId: { provider: "razorpay", eventId } },
        create: { provider: "razorpay", eventId, event, payload: auditPayload, status: "PROCESSED", processedAt: new Date() },
        update: { status: "PROCESSED", processingStartedAt: null, processedAt: new Date(), error: null },
      });
      return NextResponse.json({ received: true, ignored: true });
    }
    const entityResult = webhookEntitySchema.safeParse(payload.payload?.payment?.entity);
    if (!entityResult.success) {
      await prisma.paymentWebhookEvent.upsert({
        where: { provider_eventId: { provider: "razorpay", eventId } },
        create: { provider: "razorpay", eventId, event, payload: auditPayload, status: "FAILED", error: "Invalid webhook payment entity" },
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
          await prisma.paymentWebhookEvent.create({ data: { provider: "razorpay", eventId, event, payload: auditPayload, status: "PROCESSING", processingStartedAt: new Date() } });
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
      try {
        await applyCapturedPayment({ paymentRowId: payment.id, gatewayPaymentId: entity.id, webhookEventId: eventId });
      } catch (error) {
        if (error instanceof PaymentStateError) {
          await prisma.paymentWebhookEvent.updateMany({ where: { provider: "razorpay", eventId }, data: { status: "FAILED", processingStartedAt: null, error: error.message } });
          return NextResponse.json({ received: true, reconciliationRequired: true });
        }
        await prisma.paymentWebhookEvent.updateMany({ where: { provider: "razorpay", eventId }, data: { status: "FAILED", processingStartedAt: null, error: "Transient processing error" } });
        // Non-2xx makes Razorpay retry the webhook later.
        return NextResponse.json({ received: true, retry: true }, { status: 503 });
      }
    } else if (event === "payment.failed") {
      await applyFailedPayment(payment.id, entity.id);
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
