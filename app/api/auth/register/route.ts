import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(8).max(128),
});

function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined;
}

export async function POST(req: Request) {
  try {
    const parsed = registerSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Name, valid email and an 8–128 character password are required" },
        { status: 400 },
      );
    }

    const { name, email, phone, password } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        passwordHash: hashPassword(password),
        role: "CUSTOMER",
      },
    });

    return NextResponse.json(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      { status: 201 },
    );
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("Registration failed", error);
    return NextResponse.json({ error: "Unable to create account" }, { status: 400 });
  }
}
