import { z } from "zod";

export const bookingSchema = z.object({
  userId: z.string().min(1),
  clubId: z.string().min(1),
  eventId: z.string().min(1),
  packageId: z.string().min(1),
  guestCount: z.number().int().min(1).max(100),
  visitDate: z.coerce.date(),
  transportType: z.enum(["NONE", "CAB", "BIKE"]).default("NONE"),
  pickupLocation: z.string().trim().max(500).optional(),
  pickupTime: z.coerce.date().optional(),
}).superRefine((v, ctx) => {
  if (v.transportType !== "NONE" && !v.pickupLocation) ctx.addIssue({ code: "custom", path: ["pickupLocation"], message: "Pickup location is required for transport" });
  if (v.transportType !== "NONE" && !v.pickupTime) ctx.addIssue({ code: "custom", path: ["pickupTime"], message: "Pickup time is required for transport" });
  if (v.pickupTime && v.pickupTime.getTime() < Date.now() - 60000) ctx.addIssue({ code: "custom", path: ["pickupTime"], message: "Pickup time must be in the future" });
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
