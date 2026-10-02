import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { driverUpdateSchema } from "@/lib/validation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (u?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = (await params).id;
  try {
    const parsed = driverUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid driver update" }, { status: 400 });
    const body = parsed.data;
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
    const updated = await prisma.driver.update({ where: { id }, data });

    await writeAuditLog({
      userId: u.id,
      action: "DRIVER_UPDATED",
      entity: "Driver",
      entityId: id,
      metadata: { vehicleType: updated.vehicleType, available: updated.available },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Unable to update driver" }, { status: 400 });
  }
}
