import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** A driver can't take two pickups whose times are within this window of each other. */
export const RIDE_CONFLICT_WINDOW_MS = 2 * 60 * 60 * 1000;
const ACTIVE_RIDE_STATUSES = ["PENDING", "ASSIGNED", "DRIVER_CONFIRMED", "ON_THE_WAY", "ARRIVED", "PICKED_UP"] as const;

type Tx = Prisma.TransactionClient;

export class TransportError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function hasConflict(tx: Tx, driverId: string, pickupTime: Date, excludeRideId?: string) {
  const ride = await tx.transportBooking.findFirst({
    where: {
      driverId,
      id: excludeRideId ? { not: excludeRideId } : undefined,
      status: { in: [...ACTIVE_RIDE_STATUSES] },
      pickupTime: { gt: new Date(pickupTime.getTime() - RIDE_CONFLICT_WINDOW_MS), lt: new Date(pickupTime.getTime() + RIDE_CONFLICT_WINDOW_MS) },
    },
    select: { id: true },
  });
  return Boolean(ride);
}

/**
 * Pick the best on-duty driver: right vehicle type, assigned to the booking's club (falling back to
 * drivers with no club restriction), no overlapping ride, fewest upcoming rides.
 */
async function pickDriver(tx: Tx, booking: { clubId: string; transportType: "CAB" | "BIKE"; pickupTime: Date }, excludeRideId?: string) {
  const candidates = await tx.driver.findMany({
    where: {
      available: true,
      vehicleType: booking.transportType,
      user: { role: "DRIVER" },
      OR: [{ clubAssignments: { some: { clubId: booking.clubId } } }, { clubAssignments: { none: {} } }],
    },
    select: {
      id: true,
      clubAssignments: { where: { clubId: booking.clubId }, select: { clubId: true } },
      _count: { select: { assignments: { where: { status: { in: [...ACTIVE_RIDE_STATUSES] }, pickupTime: { gte: new Date() } } } } },
    },
  });
  candidates.sort((a, b) =>
    (b.clubAssignments.length - a.clubAssignments.length) || (a._count.assignments - b._count.assignments) || a.id.localeCompare(b.id));
  for (const c of candidates) {
    if (!(await hasConflict(tx, c.id, booking.pickupTime, excludeRideId))) return c.id;
  }
  return null;
}

export type AssignOptions = {
  /** Explicit driver chosen by an admin; null = unassign; undefined = pick automatically. */
  driverId?: string | null;
  /** When set, the driver must belong to one of this owner's clubs. */
  restrictToOwnerId?: string;
};

/**
 * Create (or re-assign) the ride for a confirmed booking with transport. Idempotent: calling it again for a
 * booking whose ride already has a driver keeps that driver unless a different one is requested.
 * Returns the ride id and whether a (new) driver was assigned, so the caller can notify after commit.
 */
export async function assignTransport(bookingId: string, opts: AssignOptions = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { club: { select: { ownerId: true } }, transport: true } });
        if (!booking) throw new TransportError("Booking not found", 404);
        if (opts.restrictToOwnerId && booking.club.ownerId !== opts.restrictToOwnerId) throw new TransportError("Forbidden", 403);
        if (booking.status !== "CONFIRMED" || !["PAID", "PARTIAL"].includes(booking.paymentStatus)) throw new TransportError("Booking must be confirmed and paid before transport assignment", 400);
        if (booking.transportType === "NONE" || !booking.pickupLocation || !booking.pickupTime) throw new TransportError("Booking has no transport request", 400);
        const existing = booking.transport;
        if (existing && ["COMPLETED", "CANCELLED"].includes(existing.status)) throw new TransportError("Transport ride is already closed", 400);
        if (existing && !["PENDING", "ASSIGNED"].includes(existing.status) && opts.driverId !== undefined && opts.driverId !== existing.driverId) {
          throw new TransportError("Driver can't be changed after the ride has started", 409);
        }

        let driverId: string | null;
        if (opts.driverId === undefined) {
          driverId = existing?.driverId ?? await pickDriver(tx, { clubId: booking.clubId, transportType: booking.transportType, pickupTime: booking.pickupTime }, existing?.id);
        } else {
          driverId = opts.driverId;
        }

        if (driverId && driverId !== existing?.driverId) {
          const driver = await tx.driver.findUnique({
            where: { id: driverId },
            select: { vehicleType: true, available: true, user: { select: { role: true } }, clubAssignments: { select: { clubId: true, club: { select: { ownerId: true } } } } },
          });
          if (!driver || driver.user.role !== "DRIVER") throw new TransportError("Driver not found", 404);
          if (driver.vehicleType !== booking.transportType) throw new TransportError("Driver's vehicle doesn't match the transport type", 400);
          if (!driver.available) throw new TransportError("Driver is off duty", 409);
          if (driver.clubAssignments.length && !driver.clubAssignments.some(a => a.clubId === booking.clubId)) throw new TransportError("Driver is not assigned to this club", 400);
          if (opts.restrictToOwnerId && driver.clubAssignments.length && !driver.clubAssignments.some(a => a.club.ownerId === opts.restrictToOwnerId)) throw new TransportError("Driver is not assigned to your club", 403);
          if (await hasConflict(tx, driverId, booking.pickupTime, existing?.id)) throw new TransportError("Driver already has a ride around this pickup time", 409);
        }

        const status = driverId ? (existing?.driverId === driverId && existing.status !== "PENDING" ? existing.status : "ASSIGNED") : "PENDING";
        const ride = await tx.transportBooking.upsert({
          where: { bookingId },
          create: { bookingId, driverId, type: booking.transportType, status, pickupLocation: booking.pickupLocation, pickupLat: booking.pickupLat, pickupLng: booking.pickupLng, pickupTime: booking.pickupTime, assignedAt: driverId ? new Date() : null },
          update: { driverId, status, ...(driverId !== existing?.driverId ? { assignedAt: driverId ? new Date() : null, reminderSentAt: null } : {}) },
          select: { id: true, driverId: true, status: true },
        });
        return { rideId: ride.id, driverId: ride.driverId, status: ride.status, newlyAssigned: Boolean(driverId && driverId !== existing?.driverId) };
      }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002") && attempt < 3) continue;
      throw error;
    }
  }
  throw new TransportError("Transport assignment kept conflicting. Please retry.", 409);
}
