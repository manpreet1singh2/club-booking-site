import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, createPasswordResetToken, hashPasswordResetToken } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
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
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const generic = {
    ok: true,
    message: "If an account exists for that email, recovery instructions have been requested.",
  };

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json(generic,{headers:{"Cache-Control":"no-store"}});

    const email = parsed.data.email;
    const keyHash = requestKey(email, req);
    const now = new Date();

    const recent = await prisma.passwordResetAttempt.findUnique({ where: { keyHash } });
    const windowExpired = !recent || now.getTime() - recent.windowStartedAt.getTime() >= WINDOW_MS;
    if (recent && !windowExpired && recent.attempts >= MAX_REQUESTS) {
      return NextResponse.json(generic,{headers:{"Cache-Control":"no-store"}});
    }

    if (windowExpired) {
      await prisma.passwordResetAttempt.upsert({
        where: { keyHash },
        create: { keyHash, attempts: 1, windowStartedAt: now },
        update: { attempts: 1, windowStartedAt: now },
      });
    } else {
      const incremented = await prisma.passwordResetAttempt.updateMany({
        where: { id: recent.id, windowStartedAt: recent.windowStartedAt, attempts: { lt: MAX_REQUESTS } },
        data: { attempts: { increment: 1 } },
      });
      if (incremented.count !== 1) return NextResponse.json(generic,{headers:{"Cache-Control":"no-store"}});
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user) return NextResponse.json(generic,{headers:{"Cache-Control":"no-store"}});

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const token = createPasswordResetToken();
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashPasswordResetToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    try {
      await sendPasswordResetEmail({ to: user.email, token });
    } catch {
      await prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, tokenHash: hashPasswordResetToken(token) },
      }).catch(() => undefined);
      throw new Error("PASSWORD_RESET_DELIVERY_FAILED");
    }

    return NextResponse.json(generic,{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json(generic,{headers:{"Cache-Control":"no-store"}});
  }
}
