import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "CLUB_OWNER")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const where: any = {};
  const from = searchParams.get("from"), to = searchParams.get("to");
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) { const end = new Date(to); end.setHours(23,59,59,999); where.createdAt.lte = end; }
  }
  if (searchParams.get("clubId")) where.clubId = searchParams.get("clubId");
  if (searchParams.get("paymentStatus")) where.paymentStatus = searchParams.get("paymentStatus");
  if (searchParams.get("transportType")) where.transportType = searchParams.get("transportType");
  if (user.role === "CLUB_OWNER") where.club = { ownerId: user.id };

  const bookings = await prisma.booking.findMany({ where, orderBy: { createdAt: "desc" }, include: { user:true, club:true, event:true, package:true, transport:true } });
  const rows = bookings.map(b => ({
    "Booking ID": b.bookingCode, "Name": b.user.name, "Phone": b.user.phone ?? "", "Email": b.user.email,
    "Date": b.event?.date ? b.event.date.toISOString().slice(0,10) : b.createdAt.toISOString().slice(0,10),
    "Time": b.event?.startTime ?? "", "Club": b.club.name, "Package": b.package.name, "Guests": b.guestCount,
    "Transport Type": b.transportType, "Pickup Location": b.pickupLocation ?? "", "Pickup Time": b.transport?.pickupTime?.toISOString() ?? "",
    "Payment Status": b.paymentStatus, "Booking Status": b.status, "Total Amount": Number(b.totalAmount),
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
