import { z } from "zod";
export const bookingSchema=z.object({userId:z.string().min(1),clubId:z.string().min(1),eventId:z.string().optional(),packageId:z.string().min(1),guestCount:z.number().int().min(1).max(100),visitDate:z.coerce.date(),transportType:z.enum(["NONE","CAB","BIKE"]).default("NONE"),pickupLocation:z.string().max(500).optional(),pickupTime:z.coerce.date().optional()});
