import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyBookingConfirmed, notifyTransportAssigned } from "@/lib/notifications";
import { assignTransport } from "@/lib/transport";
import { writeAuditLog } from "@/lib/audit";

export type CaptureResult =
  | { outcome: "CONFIRMED"; bookingId: string }
  | { outcome: "ALREADY_PROCESSED"; bookingId: string }
  /** Money was captured but the seat could not be honoured (hold expired and event full, or booking cancelled). */
  | { outcome: "REFUND_REQUIRED"; bookingId: string; reason: string };

export class PaymentStateError extends Error {}

/**
 * Apply a gateway-captured advance payment to its booking. Safe to call from both the browser verify
 * callback and the webhook, in any order, any number of times.
 *
 * Late captures (customer paid after the 15-minute hold expired) are still honoured when the event has
 * room; otherwise the booking moves to REFUND_PENDING so money is never silently kept without a seat.
 */
export async function applyCapturedPayment(input: { paymentRowId: string; gatewayPaymentId: string; signature?: string; webhookEventId?: string }): Promise<CaptureResult> {
  let result: CaptureResult | undefined;
  for (let attempt = 1; attempt <= 3 && !result; attempt++) {
    try {
      result = await prisma.$transaction(async tx => {
        const payment = await tx.payment.findUnique({ where: { id: input.paymentRowId }, include: { booking: { include: { event: true } } } });
        if (!payment) throw new PaymentStateError("Payment not found");
        const booking = payment.booking;
        if (payment.status === "PAID" || payment.status === "REFUNDED") {
          if (payment.gatewayPaymentId === input.gatewayPaymentId) return { outcome: "ALREADY_PROCESSED", bookingId: booking.id } as const;
          // A second successful payment on the same order: keep the first, flag the duplicate for refund.
          await tx.auditLog.create({ data: { action: "DUPLICATE_CAPTURE", entity: "Payment", entityId: payment.id, metadata: { gatewayPaymentId: input.gatewayPaymentId } } });
          return { outcome: "REFUND_REQUIRED", bookingId: booking.id, reason: "Duplicate payment on an already-paid order" } as const;
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "PAID", gatewayPaymentId: input.gatewayPaymentId, gatewaySignature: input.signature ?? payment.gatewaySignature, webhookEventId: input.webhookEventId ?? payment.webhookEventId, gateway: "razorpay", transactionId: input.gatewayPaymentId },
        });

        const paid = Number((await tx.payment.aggregate({ where: { bookingId: booking.id, status: "PAID" }, _sum: { amount: true } }))._sum.amount ?? 0);
        const paymentStatus = paid >= Number(booking.totalAmount) ? "PAID" : "PARTIAL";

        const awaiting = booking.status === "PENDING_PAYMENT" || booking.status === "EXPIRED";
        if (!awaiting) {
          await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus, status: booking.status === "CANCELLED" ? "REFUND_PENDING" : booking.status } });
          return { outcome: "REFUND_REQUIRED", bookingId: booking.id, reason: `Payment captured for a ${booking.status.toLowerCase()} booking` } as const;
        }

        const holdExpired = booking.status === "EXPIRED" || booking.expiresAt <= new Date();
        if (holdExpired && booking.event?.capacity) {
          const reserved = await tx.booking.aggregate({
            where: { eventId: booking.event.id, id: { not: booking.id }, OR: [{ status: "CONFIRMED" }, { status: "PENDING_PAYMENT", expiresAt: { gt: new Date() } }] },
            _sum: { guestCount: true },
          });
          if ((reserved._sum.guestCount ?? 0) + booking.guestCount > booking.event.capacity) {
            await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus, status: "REFUND_PENDING", cancellationReason: "Paid after hold expired and the event was full" } });
            return { outcome: "REFUND_REQUIRED", bookingId: booking.id, reason: "Paid after the hold expired and the event is now full" } as const;
          }
        }

        if (paid < Number(booking.advanceAmount)) throw new PaymentStateError("Captured amount is below the required advance");
        await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus, status: "CONFIRMED" } });
        return { outcome: "CONFIRMED", bookingId: booking.id } as const;
      }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002") && attempt < 3) continue;
      throw error;
    }
  }
  if (!result) throw new PaymentStateError("Payment could not be applied");

  if (result.outcome === "CONFIRMED") await runPostConfirmation(result.bookingId);
  if (result.outcome === "REFUND_REQUIRED") await writeAuditLog({ action: "PAYMENT_NEEDS_REFUND", entity: "Booking", entityId: result.bookingId, metadata: { reason: result.reason, gatewayPaymentId: input.gatewayPaymentId } });
  return result;
}

/** Side effects after a booking becomes CONFIRMED. Never throws: the payment is already committed. */
export async function runPostConfirmation(bookingId: string) {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { transportType: true } });
    if (booking && booking.transportType !== "NONE") {
      const ride = await assignTransport(bookingId);
      if (ride.newlyAssigned) await notifyTransportAssigned(ride.rideId).catch(e => console.error("transport notify failed", e));
    }
  } catch (error) {
    // Ride stays PENDING (or isn't created); the jobs runner retries assignment and admins see it on the transport board.
    console.error("auto transport assignment failed", bookingId, error);
  }
  await notifyBookingConfirmed(bookingId).catch(e => console.error("confirmation notify failed", e));
}

/** A failed attempt doesn't burn the order: Razorpay lets the customer retry on the same order id. */
export async function applyFailedPayment(paymentRowId: string, gatewayPaymentId: string) {
  await prisma.payment.updateMany({ where: { id: paymentRowId, status: "PENDING" }, data: { status: "FAILED", transactionId: gatewayPaymentId } });
}
