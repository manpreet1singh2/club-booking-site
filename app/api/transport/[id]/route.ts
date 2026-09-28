import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyTransportStatus } from "@/lib/notifications";

const transitions: Record<string, string[]> = {
  ASSIGNED: ["DRIVER_CONFIRMED", "CANCELLED"],
  DRIVER_CONFIRMED: ["ON_THE_WAY", "CANCELLED"],
  ON_THE_WAY: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["PICKED_UP", "CANCELLED"],
  PICKED_UP: ["COMPLETED"],
  PENDING: ["ASSIGNED", "CANCELLED"],
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const next = String(body.status || "");

  const ride = await prisma.transportBooking.findUnique({ where: { id }, include: { driver: true } });
  if (!ride) return NextResponse.json({ error: "Transport booking not found" }, { status: 404 });

  const privileged = user.role === "SUPER_ADMIN" || user.role === "CLUB_OWNER";
  const ownDriver = user.role === "DRIVER" && ride.driver?.userId === user.id;
  if (!privileged && !ownDriver) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!Object.prototype.hasOwnProperty.call(transitions, ride.status) || !transitions[ride.status].includes(next)) {
    return NextResponse.json({ error: "Invalid transport status transition" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async tx => {
    const result = await tx.transportBooking.update({ where: { id }, data: { status: next as never } });
    if (next === "COMPLETED" || next === "CANCELLED") {
      if (ride.driverId) await tx.driver.update({ where: { id: ride.driverId }, data: { available: true } });
    } else if (ride.driverId && next === "DRIVER_CONFIRMED") {
      await tx.driver.update({ where: { id: ride.driverId }, data: { available: false } });
    }
    return result;
  });

  notifyTransportStatus(updated.id).catch(() => undefined);
  return NextResponse.json(updated);
}
