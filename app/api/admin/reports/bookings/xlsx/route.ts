import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const paymentStatuses = ["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIAL"];
const transportTypes = ["NONE", "CAB", "BIKE"];

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "CLUB_OWNER")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? "1000");
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  const paymentStatus = searchParams.get("paymentStatus");
  const transportType = searchParams.get("transportType");
  if (paymentStatus && !paymentStatuses.includes(paymentStatus)) return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
  if (transportType && !transportTypes.includes(transportType)) return NextResponse.json({ error: "Invalid transport type" }, { status: 400 });

  const where: Record<string, any> = {};
  const from = searchParams.get("from"), to = searchParams.get("to");
  if (from || to) {
    where.createdAt = {};
    if (from) { const d = new Date(from); if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Invalid from date" }, { status: 400 }); where.createdAt.gte = d; }
    if (to) { const d = new Date(to); if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Invalid to date" }, { status: 400 }); d.setUTCHours(23, 59, 59, 999); where.createdAt.lte = d; }
  }
  if (searchParams.get("clubId")) where.clubId = searchParams.get("clubId");
  if (paymentStatus) where.paymentStatus = paymentStatus;
  if (transportType) where.transportType = transportType;
  if (user.role === "CLUB_OWNER") where.club = { ownerId: user.id };

  const bookings = await prisma.booking.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, include: { user: true, club: true, event: true, package: true, transport: { include: { driver: { include: { user: true } } } } } });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Live in the City";
  const ws = wb.addWorksheet("Bookings", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Booking ID", key: "code", width: 22 }, { header: "Name", key: "name", width: 22 }, { header: "Phone", key: "phone", width: 16 },
    { header: "Email", key: "email", width: 28 }, { header: "Date", key: "date", width: 12 }, { header: "Time", key: "time", width: 8 },
    { header: "Club", key: "club", width: 22 }, { header: "Package", key: "pkg", width: 20 }, { header: "Guests", key: "guests", width: 8 },
    { header: "Transport Type", key: "tt", width: 14 }, { header: "Pickup Location", key: "pl", width: 30 }, { header: "Pickup Time", key: "pt", width: 20 },
    { header: "Driver", key: "driver", width: 20 }, { header: "Vehicle", key: "vehicle", width: 14 },
    { header: "Payment Status", key: "ps", width: 14 }, { header: "Booking Status", key: "bs", width: 16 },
    { header: "Total", key: "total", width: 12 }, { header: "Advance", key: "adv", width: 12 }, { header: "Remaining", key: "rem", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const b of bookings) {
    ws.addRow({
      code: b.bookingCode, name: b.user.name, phone: b.user.phone ?? "", email: b.user.email,
      date: (b.event?.date ?? b.visitDate).toISOString().slice(0, 10), time: b.event?.startTime ?? "",
      club: b.club.name, pkg: b.package.name, guests: b.guestCount, tt: b.transportType, pl: b.pickupLocation ?? "",
      pt: b.pickupTime ? b.pickupTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "",
      driver: b.transport?.driver?.user.name ?? "", vehicle: b.transport?.driver?.vehicleNumber ?? "",
      ps: b.paymentStatus, bs: b.status, total: Number(b.totalAmount), adv: Number(b.advanceAmount), rem: Number(b.remainingAmount),
    });
  }
  for (const k of ["total", "adv", "rem"]) ws.getColumn(k).numFmt = "#,##0.00";

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="bookings.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
