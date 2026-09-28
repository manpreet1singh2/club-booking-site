import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "CLUB_OWNER")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const scope = user.role === "CLUB_OWNER" ? { club: { ownerId: user.id } } : {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [totalBookings, todayBookings, confirmedBookings, pendingPayments, revenue, advanceRevenue, transportPending, transportActive, clubs, users] = await Promise.all([
    prisma.booking.count({ where: scope }),
    prisma.booking.count({ where: { ...scope, createdAt: { gte: today, lt: tomorrow } } }),
    prisma.booking.count({ where: { ...scope, status: "CONFIRMED" } }),
    prisma.booking.count({ where: { ...scope, paymentStatus: "PENDING" } }),
    prisma.booking.aggregate({ where: { ...scope, paymentStatus: { in: ["PAID", "PARTIAL"] } }, _sum: { totalAmount: true } }),
    prisma.booking.aggregate({ where: { ...scope, paymentStatus: { in: ["PAID", "PARTIAL"] } }, _sum: { advanceAmount: true } }),
    prisma.transportBooking.count({ where: { booking: scope, status: { in: ["PENDING", "ASSIGNED"] } } }),
    prisma.transportBooking.count({ where: { booking: scope, status: { in: ["DRIVER_CONFIRMED", "ON_THE_WAY", "ARRIVED", "PICKED_UP"] } } }),
    user.role === "CLUB_OWNER" ? prisma.club.count({ where: { ownerId: user.id } }) : prisma.club.count(),
    prisma.user.count(),
  ]);

  return NextResponse.json({
    totalBookings,
    todayBookings,
    confirmedBookings,
    pendingPayments,
    revenue: Number(revenue._sum.totalAmount ?? 0),
    advanceRevenue: Number(advanceRevenue._sum.advanceAmount ?? 0),
    transportPending,
    transportActive,
    clubs,
    users,
  });
}
