CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Production-safe schema hardening.
-- This migration intentionally does not rewrite booking/event data.
-- If duplicate (clubId, slug) pairs already exist, resolve them before applying.
CREATE UNIQUE INDEX "Event_clubId_slug_key" ON "Event"("clubId", "slug");
CREATE INDEX "Event_clubId_date_active_idx" ON "Event"("clubId", "date", "active");
CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking"("userId", "createdAt");
CREATE INDEX "Booking_clubId_visitDate_idx" ON "Booking"("clubId", "visitDate");
CREATE INDEX "Booking_eventId_status_idx" ON "Booking"("eventId", "status");
CREATE INDEX "Booking_status_paymentStatus_idx" ON "Booking"("status", "paymentStatus");
CREATE INDEX "Payment_bookingId_status_idx" ON "Payment"("bookingId", "status");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
CREATE INDEX "TransportBooking_driverId_status_idx" ON "TransportBooking"("driverId", "status");
CREATE INDEX "TransportBooking_status_pickupTime_idx" ON "TransportBooking"("status", "pickupTime");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');
CREATE TABLE "PaymentWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB,
  "error" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");
CREATE INDEX "PaymentWebhookEvent_eventId_idx" ON "PaymentWebhookEvent"("eventId");
CREATE INDEX "PaymentWebhookEvent_status_receivedAt_idx" ON "PaymentWebhookEvent"("status", "receivedAt");
CREATE INDEX "PaymentWebhookEvent_event_receivedAt_idx" ON "PaymentWebhookEvent"("event", "receivedAt");

ALTER TABLE "NotificationLog"
  ADD COLUMN "idempotencyKey" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "NotificationLog_idempotencyKey_key" ON "NotificationLog"("idempotencyKey");
CREATE INDEX "NotificationLog_status_nextAttemptAt_idx" ON "NotificationLog"("status", "nextAttemptAt");
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

ALTER TABLE "NotificationLog" ADD COLUMN "recipient" TEXT NOT NULL DEFAULT '';
ALTER TABLE "NotificationLog" ADD COLUMN "parameters" JSONB;

ALTER TABLE "Payment" ADD COLUMN "orderCreationKey" TEXT;
CREATE UNIQUE INDEX "Payment_orderCreationKey_key" ON "Payment"("orderCreationKey");

ALTER TABLE "Payment" ADD COLUMN "refundReceipt" TEXT;
CREATE UNIQUE INDEX "Payment_refundReceipt_key" ON "Payment"("refundReceipt");

ALTER TABLE "NotificationLog" ADD COLUMN "lockedAt" TIMESTAMP(3);
CREATE INDEX "NotificationLog_lockedAt_idx" ON "NotificationLog"("lockedAt");

ALTER TABLE "Booking" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");

ALTER TABLE "Booking" ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '15 minutes';
CREATE INDEX "Booking_status_expiresAt_idx" ON "Booking"("status", "expiresAt");

CREATE TABLE "LoginAttempt" ("id" TEXT NOT NULL, "keyHash" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0, "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "blockedUntil" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "LoginAttempt_keyHash_key" ON "LoginAttempt"("keyHash");
CREATE INDEX "LoginAttempt_blockedUntil_idx" ON "LoginAttempt"("blockedUntil");

ALTER TABLE "Payment" ADD COLUMN "refundStartedAt" TIMESTAMP(3);

CREATE INDEX "Payment_status_refundStartedAt_idx" ON "Payment"("status", "refundStartedAt");
