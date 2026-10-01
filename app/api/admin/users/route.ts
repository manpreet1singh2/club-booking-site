import { NextResponse } from "next/server";
import { getCurrentUser, isSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const u = await getCurrentUser();
  if (u?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true, _count: { select: { bookings: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(users, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(req: Request) {
  if(!isSameOrigin(req))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const u = await getCurrentUser();
  if (u?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  try {
    const b = await req.json();
    const id = String(b.id || "");
    const role = String(b.role || "");
    if (!id || !["CUSTOMER", "CLUB_OWNER", "SUPER_ADMIN", "DRIVER"].includes(role)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (id === u.id && role !== "SUPER_ADMIN") return NextResponse.json({ error: "You cannot remove your own super-admin access" }, { status: 400 });

    const target = await prisma.user.findUnique({
      where: { id },
      include: { driver: { include: { assignments: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true } } } } },
    });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN" && await prisma.user.count({ where: { role: "SUPER_ADMIN" } }) <= 1) {
      return NextResponse.json({ error: "At least one super admin must remain" }, { status: 400 });
    }

    if (role === "DRIVER" && target.role !== "DRIVER") {
      return NextResponse.json({ error: "Create a driver through the driver management endpoint so vehicle details and the Driver record are provisioned together." }, { status: 409 });
    }

    if (target.role === "DRIVER" && role !== "DRIVER") {
      if (target.driver?.assignments.length) {
        return NextResponse.json({ error: "Driver has active transport assignments. Complete or cancel them before changing this role." }, { status: 409 });
      }
      if (!target.driver) {
        return NextResponse.json({ error: "Driver account is inconsistent: Driver record is missing." }, { status: 409 });
      }
    }

    const updated = await prisma.$transaction(async tx => {
      if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
        const superAdmins = await tx.user.count({ where: { role: "SUPER_ADMIN" } });
        if (superAdmins <= 1) throw new Error("LAST_SUPER_ADMIN");
      }
      if (target.role === "DRIVER" && role !== "DRIVER") {
        await tx.driver.delete({ where: { userId: id } });
      }
      return tx.user.update({
        where: { id },
        data: { role: role as never },
        select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
      });
    }, { isolationLevel: "Serializable" });

    await writeAuditLog({ userId: u.id, action: "ROLE_CHANGED", entity: "User", entityId: id, metadata: { from: target.role, to: role } });
    return NextResponse.json(updated, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_SUPER_ADMIN") {
      return NextResponse.json({ error: "At least one super admin must remain" }, { status: 409 });
    }
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2034") {
      return NextResponse.json({ error: "Role change conflicted with another admin update. Please retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to update user role" }, { status: 400 });
  }
}
