import { prisma } from "@/lib/prisma";
import { CLUB_TZ_OFFSET_MINUTES } from "@/lib/booking";

/** UTC-midnight date of "today" in the club timezone; events are stored as UTC midnight of their day. */
export function clubToday(now = new Date()) {
  const local = new Date(now.getTime() + CLUB_TZ_OFFSET_MINUTES * 60_000);
  return new Date(local.toISOString().slice(0, 10) + "T00:00:00.000Z");
}

/** Requirement 13 "live booking count": seats held by confirmed bookings and unexpired payment holds. */
export async function reservedGuestsByEvent(eventIds: string[]) {
  if (!eventIds.length) return new Map<string, number>();
  const rows = await prisma.booking.groupBy({
    by: ["eventId"],
    where: { eventId: { in: eventIds }, OR: [{ status: "CONFIRMED" }, { status: "PENDING_PAYMENT", expiresAt: { gt: new Date() } }] },
    _sum: { guestCount: true },
  });
  return new Map(rows.map(r => [r.eventId as string, r._sum.guestCount ?? 0]));
}

export function spotsLeft(capacity: number | null, reserved: number) {
  return capacity == null ? null : Math.max(0, capacity - reserved);
}
