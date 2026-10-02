import crypto from "crypto";

/** Requirement 8: 15% advance is compulsory before a booking is confirmed. */
export const ADVANCE_RATE = 0.15;
export const PAYMENT_HOLD_MINUTES = 15;
/** Clubs in this deployment run on IST. Event dates are stored as UTC midnight of the calendar day. */
export const CLUB_TZ_OFFSET_MINUTES = 330;

export type Pricing = "PER_PERSON" | "FLAT";
export type TransportType = "NONE" | "CAB" | "BIKE";
export type PackageKind = "ENTRY_ONLY" | "ENTRY_DRINKS" | "ENTRY_CAB" | "ENTRY_BIKE" | "FULL_COMBO";
export type BookingType = "SINGLE" | "COUPLE" | "GROUP" | "TABLE";

const round2 = (n: number) => Math.round(n * 100) / 100;

export const PACKAGE_KIND_LABELS: Record<PackageKind, string> = {
  ENTRY_ONLY: "Entry only",
  ENTRY_DRINKS: "Entry + Drinks",
  ENTRY_CAB: "Entry + Cab",
  ENTRY_BIKE: "Entry + Bike",
  FULL_COMBO: "Full Combo (Entry + Cab/Bike + Drinks)",
};

export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  SINGLE: "Single",
  COUPLE: "Couple",
  GROUP: "Group",
  TABLE: "Table booking",
};

/** Which transport options a package allows. Transport is part of the package price (requirement 9.1). */
export function allowedTransportForPackage(kind: PackageKind): TransportType[] {
  switch (kind) {
    case "ENTRY_CAB": return ["CAB"];
    case "ENTRY_BIKE": return ["BIKE"];
    case "FULL_COMBO": return ["CAB", "BIKE"];
    default: return ["NONE"];
  }
}

export function guestRangeForBookingType(type: BookingType): { min: number; max: number } {
  switch (type) {
    case "SINGLE": return { min: 1, max: 1 };
    case "COUPLE": return { min: 2, max: 2 };
    case "GROUP": return { min: 3, max: 20 };
    case "TABLE": return { min: 1, max: 20 };
  }
}

/** A bike carries one passenger; larger parties must take a cab. */
export const MAX_BIKE_PASSENGERS = 1;

export function validateBookingRules(input: {
  bookingType: BookingType;
  guestCount: number;
  packageKind: PackageKind;
  transportType: TransportType;
}): string | null {
  const range = guestRangeForBookingType(input.bookingType);
  if (!Number.isInteger(input.guestCount) || input.guestCount < range.min || input.guestCount > range.max) {
    return range.min === range.max
      ? `${BOOKING_TYPE_LABELS[input.bookingType]} booking is for exactly ${range.min} guest${range.min > 1 ? "s" : ""}`
      : `${BOOKING_TYPE_LABELS[input.bookingType]} booking needs ${range.min}–${range.max} guests`;
  }
  const allowed = allowedTransportForPackage(input.packageKind);
  if (!allowed.includes(input.transportType)) {
    return allowed[0] === "NONE"
      ? "This package does not include transport. Choose a Cab, Bike or Full Combo package for pickup."
      : `This package requires ${allowed.join(" or ").toLowerCase()} pickup`;
  }
  if (input.transportType === "BIKE" && input.guestCount > MAX_BIKE_PASSENGERS) {
    return "Bike pickup is for one guest only. Choose a cab for larger parties.";
  }
  return null;
}

export type PromoInput = {
  type: "PERCENT" | "FLAT";
  value: number;
  minAmount: number;
  active: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  clubId: string | null;
};

/** Returns the discount for a subtotal, or an error explaining why the code does not apply. */
export function evaluatePromo(promo: PromoInput, subtotal: number, clubId: string, now = new Date()): { discount: number } | { error: string } {
  if (!promo.active) return { error: "This promo code is not active" };
  if (promo.expiresAt && promo.expiresAt <= now) return { error: "This promo code has expired" };
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) return { error: "This promo code has reached its usage limit" };
  if (promo.clubId && promo.clubId !== clubId) return { error: "This promo code is not valid for this club" };
  if (subtotal < promo.minAmount) return { error: `Minimum booking of ₹${promo.minAmount} required for this code` };
  const raw = promo.type === "PERCENT" ? subtotal * Math.min(100, Math.max(0, promo.value)) / 100 : Math.max(0, promo.value);
  return { discount: round2(Math.min(raw, subtotal)) };
}

export function calculateBookingAmounts(price: number, guestCount = 1, pricing: Pricing = "PER_PERSON", discount = 0) {
  const unit = Math.max(0, Number(price) || 0);
  const guests = Math.max(1, Math.floor(guestCount));
  const subtotalAmount = round2(pricing === "PER_PERSON" ? unit * guests : unit);
  const discountAmount = round2(Math.min(Math.max(0, discount), subtotalAmount));
  const totalAmount = round2(subtotalAmount - discountAmount);
  // Razorpay rejects orders below ₹1, so a non-free booking needs at least ₹1 advance.
  const advanceAmount = totalAmount > 0 ? Math.min(totalAmount, Math.max(1, round2(totalAmount * ADVANCE_RATE))) : 0;
  return {
    subtotalAmount,
    discountAmount,
    totalAmount,
    advanceAmount,
    remainingAmount: round2(totalAmount - advanceAmount),
  };
}

export function createBookingCode(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  // Crypto-random suffix from an alphabet without look-alikes (0/O, 1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (const b of crypto.randomBytes(6)) suffix += alphabet[b % alphabet.length];
  return `LIC-${date}-${suffix}`;
}

/** Calendar day (YYYY-MM-DD) of a stored event date. Event dates are saved as UTC midnight of the day. */
export function eventDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Combine an event's calendar date with its "HH:MM" start time in the club's timezone. */
export function eventStartsAt(eventDate: Date, startTime: string, tzOffsetMinutes = CLUB_TZ_OFFSET_MINUTES): Date {
  const m = /^(\d{1,2}):(\d{2})/.exec(startTime || "");
  const minutesOfDay = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const utcMidnight = Date.parse(`${eventDay(eventDate)}T00:00:00.000Z`);
  return new Date(utcMidnight + (minutesOfDay - tzOffsetMinutes) * 60_000);
}

/**
 * Requirement 13 (cancellation rules): cancelling at least `cancellationHours` before the event
 * refunds the advance; later cancellations forfeit it.
 */
export function cancellationOutcome(input: { eventStart: Date; cancellationHours: number; paid: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  if (!input.paid) return { status: "CANCELLED" as const, refundable: false, reason: "Cancelled before payment" };
  const cutoff = new Date(input.eventStart.getTime() - input.cancellationHours * 3_600_000);
  if (now <= cutoff) return { status: "REFUND_PENDING" as const, refundable: true, reason: `Cancelled at least ${input.cancellationHours}h before the event; advance will be refunded` };
  return { status: "CANCELLED" as const, refundable: false, reason: `Cancelled within ${input.cancellationHours}h of the event; advance is non-refundable` };
}
