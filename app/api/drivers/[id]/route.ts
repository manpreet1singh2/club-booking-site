import { NextResponse } from "next/server";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { driverClubAssignmentSchema, driverUpdateSchema } from "@/lib/validation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if(!isSameOrigin(req))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const u = await getCurrentUser();
  if (u?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = (await params).id;
  try {
    const rawBody = await req.json();
    const parsed = driverUpdateSchema.safeParse(rawBody);
    const assignmentParsed = driverClubAssignmentSchema.safeParse(rawBody);
    if (!parsed.success || !assignmentParsed.success) return NextResponse.json({ error: "Invalid driver update" }, { status: 400 });
    if (!parsed.success) return NextResponse.json({ error: "Invalid driver update" }, { status: 400 });
    const body = parsed.data;
    const clubIds = assignmentParsed.data.clubIds === undefined ? undefined : [...new Set(assignmentParsed.data.clubIds)];
    const existing = await prisma.driver.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, role: true } },
        assignments: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    if (existing.user.role !== "DRIVER") return NextResponse.json({ error: "Driver account is inconsistent with its user role" }, { status: 409 });
    if (body.available === true && existing.assignments.length) return NextResponse.json({ error: "Driver has an active transport assignment" }, { status: 409 });

    const data = {
      vehicleType: body.vehicleType || existing.vehicleType,
      vehicleNumber: body.vehicleNumber ? String(body.vehicleNumber).trim() : null,
      ...(body.available !== undefined ? { available: Boolean(body.available) } : {}),
    };
    const updated = await prisma.$transaction(async tx => {
      if (clubIds === undefined) return tx.driver.update({ where: { id }, data, select: { id: true, userId: true, vehicleType: true, vehicleNumber: true, available: true, clubAssignments: { select: { clubId: true } } } });
      const clubs = await tx.club.findMany({ where: { id: { in: clubIds } }, select: { id: true } });
      if (clubs.length !== clubIds.length) throw new Error("One or more clubs were not found");
      const activeAssignments = await tx.transportBooking.count({
        where: {
          driverId: id,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          booking: { clubId: { notIn: clubIds } },
        },
      });
      if (activeAssignments) throw new Error("Driver has active rides outside the requested club assignments");
      await tx.driverClub.deleteMany({ where: { driverId: id } });
      if (clubIds.length) await tx.driverClub.createMany({ data: clubIds.map(clubId => ({ driverId: id, clubId })), skipDuplicates: true });
      return tx.driver.findUniqueOrThrow({
        where: { id },
        select: { id: true, userId: true, vehicleType: true, vehicleNumber: true, available: true, clubAssignments: { select: { clubId: true } } },
      });
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });

    await writeAuditLog({
      userId: u.id,
      action: "DRIVER_UPDATED",
      entity: "Driver",
      entityId: id,
      metadata: { vehicleType: updated.vehicleType, available: updated.available, clubIds: updated.clubAssignments.map(a => a.clubId) },
    });
    return NextResponse.json(updated, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Unable to update driver" }, { status: 400 });
  }
}
