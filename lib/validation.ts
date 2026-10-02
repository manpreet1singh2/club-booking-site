import { z } from "zod";

const bookingBase = z.object({
  userId: z.string().min(1),
  clubId: z.string().min(1),
  eventId: z.string().min(1),
  packageId: z.string().min(1),
  guestCount: z.number().int().min(1).max(100),
  visitDate: z.coerce.date(),
  transportType: z.enum(["NONE", "CAB", "BIKE"]).default("NONE"),
  pickupLocation: z.string().trim().max(500).optional(),
  pickupTime: z.coerce.date().optional(),
});

type BookingShape = z.infer<typeof bookingBase>;

function refineBooking(v: Omit<BookingShape, "userId"> & { userId?: string }, ctx: z.RefinementCtx) {
  if (v.transportType !== "NONE" && !v.pickupLocation) ctx.addIssue({ code: "custom", path: ["pickupLocation"], message: "Pickup location is required for transport" });
  if (v.transportType !== "NONE" && !v.pickupTime) ctx.addIssue({ code: "custom", path: ["pickupTime"], message: "Pickup time is required for transport" });
  if (v.pickupTime && v.pickupTime.getTime() < Date.now() - 60000) ctx.addIssue({ code: "custom", path: ["pickupTime"], message: "Pickup time must be in the future" });
}

export const bookingSchema = bookingBase.superRefine(refineBooking);
/** API input: the user id always comes from the session, never the request body. */
export const bookingInputSchema = bookingBase.omit({ userId: true }).superRefine(refineBooking);

export const bookingStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED", "REFUND_PENDING", "REFUNDED"]),
});

export const transportStatusSchema = z.object({
  status: z.enum(["ASSIGNED", "DRIVER_CONFIRMED", "ON_THE_WAY", "ARRIVED", "PICKED_UP", "COMPLETED", "CANCELLED"]),
});

export const driverUpdateSchema = z.object({
  vehicleType: z.enum(["CAB", "BIKE"]).optional(),
  vehicleNumber: z.string().trim().max(40).nullable().optional(),
  available: z.boolean().optional(),
});

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
});


export const transportCreateSchema = z.object({
  bookingId: z.string().min(1).max(100),
  driverId: z.string().min(1).max(100).nullable().optional(),
});
