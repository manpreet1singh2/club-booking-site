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
