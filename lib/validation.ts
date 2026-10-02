import { z } from "zod";

export const bookingSchema = z.object({
  clubId: z.string().min(1).max(100),
  eventId: z.string().min(1).max(100),
  packageId: z.string().min(1).max(100),
  bookingType: z.enum(["SINGLE", "COUPLE", "GROUP", "TABLE"]).default("GROUP"),
  guestCount: z.number().int().min(1).max(20),
  transportType: z.enum(["NONE", "CAB", "BIKE"]).default("NONE"),
  pickupLocation: z.string().trim().min(3).max(500).optional(),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
  pickupTime: z.coerce.date().optional(),
  promoCode: z.string().trim().toUpperCase().min(3).max(40).optional(),
}).superRefine((v, ctx) => {
  if (v.transportType !== "NONE" && !v.pickupLocation) ctx.addIssue({ code: "custom", path: ["pickupLocation"], message: "Pickup location is required for transport" });
  if (v.transportType !== "NONE" && !v.pickupTime) ctx.addIssue({ code: "custom", path: ["pickupTime"], message: "Pickup time is required for transport" });
  if ((v.pickupLat === undefined) !== (v.pickupLng === undefined)) ctx.addIssue({ code: "custom", path: ["pickupLat"], message: "Both latitude and longitude are required" });
});

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

export const driverClubAssignmentSchema = z.object({
  clubIds: z.array(z.string().min(1).max(100)).max(100).optional(),
});
