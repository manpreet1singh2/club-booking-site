import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: Request) { const bookingId = new URL(req.url).searchParams.get("bookingId"); const payments = await prisma.payment.findMany({ where: bookingId ? { bookingId } : undefined, orderBy: { createdAt: "desc" } }); return NextResponse.json(payments); }
export async function POST(req: Request) {
  try {
    const { bookingId, amount, gateway, transactionId } = await req.json();
    if (!bookingId || !amount || !gateway || !transactionId) return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    const payment = await prisma.payment.create({ data: { bookingId, amount, gateway, transactionId, status: "PAID" } });
    const paid = Number(amount) >= Number(booking.advanceAmount);
    if (paid) await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: "PARTIAL", status: "CONFIRMED" } });
    return NextResponse.json(payment, { status: 201 });
  } catch { return NextResponse.json({ error: "Unable to record payment" }, { status: 400 }); }
}
