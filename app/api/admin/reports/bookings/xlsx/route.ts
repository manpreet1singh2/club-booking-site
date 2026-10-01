import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function spreadsheetSafe(value: unknown) {
  const s = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "CLUB_OWNER")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get("limit") ?? "1000";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  const paymentStatuses = ["PENDING","PAID","FAILED","REFUNDED","PARTIAL"];
  const transportTypes = ["NONE","CAB","BIKE"];
  const paymentStatus = searchParams.get("paymentStatus");
  const transportType = searchParams.get("transportType");
  if (paymentStatus && !paymentStatuses.includes(paymentStatus)) return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
  if (transportType && !transportTypes.includes(transportType)) return NextResponse.json({ error: "Invalid transport type" }, { status: 400 });
  const where: Record<string, any> = {};
  const from = searchParams.get("from"), to = searchParams.get("to");
  if (from || to) {
    where.createdAt = {};
    if (from) { const start = new Date(from); if (Number.isNaN(start.getTime())) return NextResponse.json({ error: "Invalid from date" }, { status: 400 }); where.createdAt.gte = start; }
    if (to) { const end = new Date(to); if (Number.isNaN(end.getTime())) return NextResponse.json({ error: "Invalid to date" }, { status: 400 }); end.setHours(23,59,59,999); where.createdAt.lte = end; }
  }
  if (searchParams.get("clubId")) where.clubId = searchParams.get("clubId");
  if (searchParams.get("paymentStatus")) where.paymentStatus = searchParams.get("paymentStatus");
  if (searchParams.get("transportType")) where.transportType = searchParams.get("transportType");
  if (user.role === "CLUB_OWNER") where.club = { ownerId: user.id };

  const bookings = await prisma.booking.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, select: {
  bookingCode:true,user:{select:{name:true,phone:true,email:true}},club:{select:{name:true}},event:{select:{date:true,startTime:true}},package:{select:{name:true}},
  guestCount:true,transportType:true,pickupLocation:true,paymentStatus:true,status:true,totalAmount:true,advanceAmount:true,remainingAmount:true,createdAt:true,
  transport:{select:{pickupTime:true}}
} });
  const rows = bookings.map(b => ({
    "Booking ID": spreadsheetSafe(b.bookingCode), "Name": spreadsheetSafe(b.user.name), "Phone": spreadsheetSafe(b.user.phone), "Email": spreadsheetSafe(b.user.email),
    "Date": spreadsheetSafe(b.event?.date ? b.event.date.toISOString().slice(0,10) : b.createdAt.toISOString().slice(0,10)),
    "Time": spreadsheetSafe(b.event?.startTime), "Club": spreadsheetSafe(b.club.name), "Package": spreadsheetSafe(b.package.name), "Guests": b.guestCount,
    "Transport Type": spreadsheetSafe(b.transportType), "Pickup Location": spreadsheetSafe(b.pickupLocation), "Pickup Time": spreadsheetSafe(b.transport?.pickupTime?.toISOString()),
    "Payment Status": spreadsheetSafe(b.paymentStatus), "Booking Status": spreadsheetSafe(b.status), "Total Amount": Number(b.totalAmount),
    "Advance Amount": Number(b.advanceAmount), "Remaining Amount": Number(b.remainingAmount)
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Bookings");
  const buffer = XLSX.write(book, { type:"buffer", bookType:"xlsx" });
  return new NextResponse(buffer, { headers: {
    "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition":'attachment; filename="live-in-the-city-bookings.xlsx"',
    "Cache-Control":"no-store"
  }});
}
