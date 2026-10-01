import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPasswordResetToken, hashPasswordResetToken } from "@/lib/auth";
import { z } from "zod";
import crypto from "crypto";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
});

const WINDOW_MS = 15 * 60_000;
const MAX_REQUESTS = 3;

function requestKey(email: string, req: Request) {
  const forwarded = process.env.TRUST_PROXY === "true"
    ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    : "";
  const client = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
  return crypto.createHash("sha256").update("password-reset|" + email + "|" + client).digest("hex");
}

export async function POST(req: Request) {
  const generic = {
    ok: true,
    message: "If an account exists for that email, recovery instructions have been requested.",
  };

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json(generic);

    const email = parsed.data.email;
    const keyHash = requestKey(email, req);
    const now = new Date();

    const recent = await prisma.loginAttempt.findUnique({ where: { keyHash } });
    if (recent && now.getTime() - recent.windowStartedAt.getTime() < WINDOW_MS && recent.attempts >= MAX_REQUESTS) {
      return NextResponse.json(generic);
    }

    await prisma.loginAttempt.upsert({
      where: { keyHash },
      create: { keyHash, attempts: 1, windowStartedAt: now },
      update: {
        attempts: now.getTime() - recent?.windowStartedAt.getTime()! >= WINDOW_MS ? 1 : { increment: 1 },
        windowStartedAt: now.getTime() - recent?.windowStartedAt.getTime()! >= WINDOW_MS ? now : undefined,
        blockedUntil: null,
      },
    });

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user) return NextResponse.json(generic);

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const token = createPasswordResetToken();
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashPasswordResetToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    // Deliver the token through the configured email provider here. Never log the raw token.
    // The endpoint intentionally returns the same generic response regardless of account existence.

    return NextResponse.json(generic);
  } catch (error) {
    console.error("Password reset request failed", error);
    return NextResponse.json(generic);
  }
}
