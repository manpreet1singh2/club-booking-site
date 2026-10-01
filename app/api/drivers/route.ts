import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword, isSameOrigin } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN" && user.role !== "CLUB_OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const drivers = await prisma.driver.findMany({
    where: user.role === "CLUB_OWNER"
      ? { assignments: { some: { booking: { club: { ownerId: user.id } } } } }
      : undefined,
    include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return NextResponse.json(drivers);
}

export async function POST(req: NextRequest) {
  if(!isSameOrigin(req))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const vehicleType = body.vehicleType === "BIKE" ? "BIKE" : "CAB";
    if (!name || !email || password.length < 8) return NextResponse.json({ error: "Name, valid email and an 8+ character password are required" }, { status: 400 });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });

    const driver = await prisma.user.create({
      data: {
        name, email, phone: body.phone ? String(body.phone) : null,
        passwordHash: hashPassword(password),
        role: "DRIVER",
        driver: { create: { vehicleType, vehicleNumber: body.vehicleNumber ? String(body.vehicleNumber) : null } },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        driver: {
          select: {
            id: true,
            vehicleType: true,
            vehicleNumber: true,
            available: true,
          },
        },
      },
    });
    return NextResponse.json(driver, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create driver" }, { status: 400 });
  }
}
