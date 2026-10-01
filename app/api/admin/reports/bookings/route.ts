import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function spreadsheetSafe(value: unknown) {
  const s = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function csvCell(value: unknown) {
  const s = spreadsheetSafe(value);
  return '"' + s.replaceAll('"', '""') + '"';
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "CLUB_OWNER")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const clubId = searchParams.get("clubId");
  const paymentStatus = searchParams.get("paymentStatus");
  const transportType = searchParams.get("transportType");
  const rawLimit = searchParams.get("limit") ?? "1000";
  const parsedLimit = Number(rawLimit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 5000) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }
  const limit = parsedLimit;

  const paymentStatuses = ["PENDING","PAID","FAILED","REFUNDED","PARTIAL"];
  const transportTypes = ["NONE","CAB","BIKE"];
  if (paymentStatus && !paymentStatuses.includes(paymentStatus)) {
    return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
  }
  if (transportType && !transportTypes.includes(transportType)) {
    return NextResponse.json({ error: "Invalid transport type" }, { status: 400 });
  }

  const where: Record<string, any> = {};
  if (from || to) {
    where.createdAt = {};
    if (from) {
      const start = new Date(from);
      if (Number.isNaN(start.getTime())) return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
      where.createdAt.gte = start;
    }
    if (to) {
      const end = new Date(to);
      if (Number.isNaN(end.getTime())) return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }
  if (clubId) where.clubId = clubId;
  if (paymentStatus) where.paymentStatus = paymentStatus;
  if (transportType) where.transportType = transportType;

  if (user.role === "CLUB_OWNER") {
    where.club = { ownerId: user.id };
  }

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      bookingCode:true,user:{select:{name:true,phone:true,email:true}},event:{select:{date:true,startTime:true}},club:{select:{name:true}},package:{select:{name:true}},
      guestCount:true,transportType:true,pickupLocation:true,paymentStatus:true,status:true,totalAmount:true,advanceAmount:true,remainingAmount:true,createdAt:true
    },
    take: limit,
  });

  const header = ["Booking ID","Name","Phone","Email","Date","Time","Club","Package","Guests","Transport Type","Pickup Location","Payment Status","Booking Status","Total Amount","Advance Amount","Remaining Amount"];
  const rows = bookings.map((b) => [
    b.bookingCode,
    b.user.name,
    b.user.phone,
    b.user.email,
    b.event?.date?.toISOString().slice(0,10) ?? b.createdAt.toISOString().slice(0,10),
    b.event?.startTime ?? "",
    b.club.name,
    b.package.name,
    b.guestCount,
    b.transportType,
    b.pickupLocation,
    b.paymentStatus,
    b.status,
    b.totalAmount.toString(),
    b.advanceAmount.toString(),
    b.remainingAmount.toString(),
  ]);

  const csv = [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="live-in-the-city-bookings.csv"',
      "Cache-Control": "no-store",
    },
  });
}
