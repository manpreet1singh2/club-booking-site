import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { PACKAGE_KIND_LABELS, eventDay } from "@/lib/booking";

/**
 * WhatsApp Cloud API template messages (requirement 6.1).
 * Every message is idempotent (unique idempotencyKey) and logged in NotificationLog, which is also
 * the retry queue: failures move to RETRY_PENDING with exponential backoff and are re-sent by the jobs runner.
 * Template body parameters ({{1}}, {{2}}, ...) are listed in docs/WHATSAPP_TEMPLATES.md.
 */

type TemplateMessage = {
  to: string;
  template: string;
  parameters?: string[];
  userId?: string | null;
  idempotencyKey: string;
};

export type SendResult = { sent: boolean; duplicate?: boolean; skipped?: boolean; reason?: string };

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}

const tpl = (envName: string, fallback: string) => process.env[envName]?.trim() || fallback;
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const inr = (v: unknown) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const day = (d: Date) => new Date(eventDay(d) + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", dateStyle: "medium" });
// WhatsApp rejects empty params and params containing newlines/tabs or more than 4 consecutive spaces.
const clean = (v: unknown) => (String(v ?? "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-").slice(0, 900);

async function deliver(logId: string, message: { recipient: string; template: string; parameters: string[] }, attempt: number, maxAttempts: number): Promise<SendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
  if (!token || !phoneNumberId) {
    await prisma.notificationLog.update({ where: { id: logId }, data: { status: "SKIPPED_NOT_CONFIGURED", lastError: "WhatsApp provider is not configured", lockedAt: null } });
    return { sent: false, reason: "not_configured" };
  }

  let errorMessage = "WhatsApp request failed";
  let retryable = true;
  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.recipient,
        type: "template",
        template: {
          name: message.template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" },
          components: message.parameters.length ? [{ type: "body", parameters: message.parameters.map(text => ({ type: "text", text })) }] : undefined,
        },
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      await prisma.notificationLog.update({
        where: { id: logId },
        data: { status: "SENT", providerMessageId: data?.messages?.[0]?.id || null, sentAt: new Date(), lastError: null, nextAttemptAt: null, lockedAt: null },
      });
      return { sent: true };
    }
    errorMessage = String(data?.error?.message || `WhatsApp HTTP ${response.status}`);
    // 4xx other than rate limiting means a bad template/number: retrying will not help.
    retryable = response.status === 429 || response.status >= 500;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const canRetry = retryable && attempt < maxAttempts;
  await prisma.notificationLog.update({
    where: { id: logId },
    data: {
      status: canRetry ? "RETRY_PENDING" : "FAILED",
      attempt: canRetry ? attempt + 1 : attempt,
      lastError: errorMessage.slice(0, 500),
      nextAttemptAt: canRetry ? new Date(Date.now() + Math.min(60 * 60_000, 2 ** attempt * 60_000)) : null,
      lockedAt: null,
    },
  });
  return { sent: false, reason: errorMessage };
}

export async function sendWhatsApp(message: TemplateMessage): Promise<SendResult> {
  const recipient = normalizePhone(message.to);
  if (recipient.length < 10) return { sent: false, skipped: true, reason: "invalid_phone" };
  const parameters = (message.parameters ?? []).map(clean);

  let log;
  try {
    log = await prisma.notificationLog.create({
      data: {
        idempotencyKey: message.idempotencyKey,
        userId: message.userId || null,
        channel: "WHATSAPP",
        template: message.template,
        recipient,
        parameters,
        status: "PROCESSING",
        lockedAt: new Date(),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { sent: false, duplicate: true };
    throw error;
  }
  return deliver(log.id, { recipient, template: message.template, parameters }, log.attempt, log.maxAttempts);
}

/** Called by the jobs runner for a row it has already claimed (status PROCESSING). */
export async function retryNotification(notificationId: string): Promise<SendResult> {
  const log = await prisma.notificationLog.findUnique({ where: { id: notificationId } });
  if (!log || log.channel !== "WHATSAPP" || log.status !== "PROCESSING") return { sent: false, skipped: true };
  const parameters = Array.isArray(log.parameters) ? log.parameters.map(String) : [];
  return deliver(log.id, { recipient: log.recipient, template: log.template, parameters }, log.attempt, log.maxAttempts);
}

const bookingInclude = {
  user: true,
  club: { include: { owner: true } },
  package: true,
  event: true,
  transport: { include: { driver: { include: { user: true } } } },
} satisfies Prisma.BookingInclude;

async function loadBooking(bookingId: string) {
  return prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
}

function eventLabel(b: NonNullable<Awaited<ReturnType<typeof loadBooking>>>) {
  return b.event ? `${b.event.name}, ${day(b.event.date)} ${b.event.startTime}` : day(b.visitDate);
}

function transportLabel(b: NonNullable<Awaited<ReturnType<typeof loadBooking>>>) {
  if (b.transportType === "NONE" || !b.pickupTime) return "No pickup";
  return `${b.transportType === "CAB" ? "Cab" : "Bike"} pickup ${when(b.pickupTime)} from ${b.pickupLocation || "-"}`;
}

/** Sent when the booking is created and is waiting for the 15% advance. */
export async function notifyBookingCreated(bookingId: string) {
  const b = await loadBooking(bookingId);
  if (!b?.user.phone) return;
  await sendWhatsApp({
    to: b.user.phone,
    userId: b.user.id,
    template: tpl("WA_TEMPLATE_BOOKING_CREATED", "booking_created"),
    parameters: [b.user.name, b.bookingCode, b.club.name, inr(b.advanceAmount)],
    idempotencyKey: `booking-created:${b.id}:customer`,
  });
}

/** Requirement 6.1 ① customer confirmation + ② club owner alert, after the advance is captured. */
export async function notifyBookingConfirmed(bookingId: string) {
  const b = await loadBooking(bookingId);
  if (!b) return;
  const ticketUrl = `${appUrl()}/verify/${b.ticketToken}`;
  if (b.user.phone) await sendWhatsApp({
    to: b.user.phone,
    userId: b.user.id,
    template: tpl("WA_TEMPLATE_BOOKING_CONFIRMED", "booking_confirmed"),
    // {{1}} name {{2}} booking ID {{3}} club + address {{4}} event/date {{5}} package {{6}} advance paid {{7}} balance at club {{8}} pickup {{9}} ticket link
    parameters: [b.user.name, b.bookingCode, `${b.club.name}, ${b.club.address}`, eventLabel(b), `${b.package.name} x${b.guestCount}`, inr(b.advanceAmount), inr(b.remainingAmount), transportLabel(b), ticketUrl],
    idempotencyKey: `booking-confirmed:${b.id}:customer`,
  });
  if (b.club.owner?.phone) await sendWhatsApp({
    to: b.club.owner.phone,
    userId: b.club.owner.id,
    template: tpl("WA_TEMPLATE_OWNER_BOOKING", "club_new_booking"),
    // {{1}} booking ID {{2}} customer {{3}} phone {{4}} event/date {{5}} package & guests {{6}} transport {{7}} advance paid
    parameters: [b.bookingCode, b.user.name, b.user.phone || "-", eventLabel(b), `${b.package.name} (${PACKAGE_KIND_LABELS[b.package.kind]}) x${b.guestCount}`, transportLabel(b), inr(b.advanceAmount)],
    idempotencyKey: `booking-confirmed:${b.id}:owner`,
  });
}

export async function notifyBookingCancelled(bookingId: string, refundable: boolean) {
  const b = await loadBooking(bookingId);
  if (!b) return;
  const outcome = refundable ? `Your advance of ${inr(b.advanceAmount)} will be refunded` : "No refund applies";
  if (b.user.phone) await sendWhatsApp({
    to: b.user.phone,
    userId: b.user.id,
    template: tpl("WA_TEMPLATE_BOOKING_CANCELLED", "booking_cancelled"),
    parameters: [b.user.name, b.bookingCode, b.club.name, outcome],
    idempotencyKey: `booking-cancelled:${b.id}:customer`,
  });
  if (b.club.owner?.phone) await sendWhatsApp({
    to: b.club.owner.phone,
    userId: b.club.owner.id,
    template: tpl("WA_TEMPLATE_OWNER_CANCELLED", "club_booking_cancelled"),
    parameters: [b.bookingCode, b.user.name, eventLabel(b), refundable ? "Refund pending" : "No refund"],
    idempotencyKey: `booking-cancelled:${b.id}:owner`,
  });
}

function mapsLink(ride: { pickupLat: number | null; pickupLng: number | null; pickupLocation: string }) {
  const q = ride.pickupLat != null && ride.pickupLng != null ? `${ride.pickupLat},${ride.pickupLng}` : ride.pickupLocation;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Requirement 9.3: customer learns the driver; driver gets the pickup notification. */
export async function notifyTransportAssigned(transportId: string) {
  const ride = await prisma.transportBooking.findUnique({ where: { id: transportId }, include: { booking: { include: { user: true, club: true } }, driver: { include: { user: true } } } });
  if (!ride?.driver) return;
  const driverInfo = `${ride.driver.user.name}${ride.driver.vehicleNumber ? ` (${ride.driver.vehicleNumber})` : ""}${ride.driver.user.phone ? `, ${ride.driver.user.phone}` : ""}`;
  if (ride.booking.user.phone) await sendWhatsApp({
    to: ride.booking.user.phone,
    userId: ride.booking.user.id,
    template: tpl("WA_TEMPLATE_TRANSPORT_ASSIGNED", "transport_assigned"),
    parameters: [ride.booking.bookingCode, ride.type === "CAB" ? "Cab" : "Bike", ride.pickupLocation, when(ride.pickupTime), driverInfo],
    idempotencyKey: `transport-assigned:${ride.id}:customer:${ride.driverId}`,
  });
  if (ride.driver.user.phone) await sendWhatsApp({
    to: ride.driver.user.phone,
    userId: ride.driver.user.id,
    template: tpl("WA_TEMPLATE_DRIVER_RIDE", "driver_ride_assigned"),
    parameters: [ride.booking.bookingCode, `${ride.booking.user.name}${ride.booking.user.phone ? `, ${ride.booking.user.phone}` : ""}`, `${ride.pickupLocation} ${mapsLink(ride)}`, when(ride.pickupTime), ride.booking.club.name],
    idempotencyKey: `transport-assigned:${ride.id}:driver:${ride.driverId}`,
  });
}

export async function notifyTransportStatus(transportId: string) {
  const ride = await prisma.transportBooking.findUnique({ where: { id: transportId }, include: { booking: { include: { user: true } } } });
  if (!ride?.booking.user.phone) return;
  await sendWhatsApp({
    to: ride.booking.user.phone,
    userId: ride.booking.user.id,
    template: tpl("WA_TEMPLATE_TRANSPORT_STATUS", "transport_status"),
    parameters: [ride.booking.bookingCode, ride.status.replaceAll("_", " ").toLowerCase()],
    idempotencyKey: `transport-status:${ride.id}:${ride.status}:${ride.driverId ?? "none"}`,
  });
}

/** Requirement 9.3: reminder to the customer (and driver) before pickup time. */
export async function notifyPickupReminder(transportId: string) {
  const ride = await prisma.transportBooking.findUnique({ where: { id: transportId }, include: { booking: { include: { user: true, club: true } }, driver: { include: { user: true } } } });
  if (!ride) return;
  const driverInfo = ride.driver ? `${ride.driver.user.name}${ride.driver.vehicleNumber ? ` (${ride.driver.vehicleNumber})` : ""}${ride.driver.user.phone ? `, ${ride.driver.user.phone}` : ""}` : "being assigned";
  if (ride.booking.user.phone) await sendWhatsApp({
    to: ride.booking.user.phone,
    userId: ride.booking.user.id,
    template: tpl("WA_TEMPLATE_PICKUP_REMINDER", "pickup_reminder"),
    parameters: [ride.booking.user.name, when(ride.pickupTime), ride.pickupLocation, driverInfo, ride.booking.bookingCode],
    idempotencyKey: `pickup-reminder:${ride.id}:customer`,
  });
  if (ride.driver?.user.phone) await sendWhatsApp({
    to: ride.driver.user.phone,
    userId: ride.driver.user.id,
    template: tpl("WA_TEMPLATE_DRIVER_REMINDER", "driver_pickup_reminder"),
    parameters: [ride.booking.bookingCode, when(ride.pickupTime), `${ride.pickupLocation} ${mapsLink(ride)}`, `${ride.booking.user.name}${ride.booking.user.phone ? `, ${ride.booking.user.phone}` : ""}`],
    idempotencyKey: `pickup-reminder:${ride.id}:driver:${ride.driverId}`,
  });
}

/** Requirement 13: automated daily booking report to the owner. */
export async function notifyOwnerDailyReport(input: { clubId: string; day: string; ownerId: string; ownerPhone: string; clubName: string; bookings: number; guests: number; transport: number; advance: number }) {
  return sendWhatsApp({
    to: input.ownerPhone,
    userId: input.ownerId,
    template: tpl("WA_TEMPLATE_OWNER_DAILY_REPORT", "club_daily_report"),
    parameters: [input.clubName, input.day, String(input.bookings), String(input.guests), String(input.transport), inr(input.advance), `${appUrl()}/admin/reports`],
    idempotencyKey: `daily-report:${input.clubId}:${input.day}`,
  });
}
