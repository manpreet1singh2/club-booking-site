import { NextResponse } from "next/server";
import { isSameOrigin, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60_000;
function throttleKey(email: string, req: Request) {
  const forwarded = process.env.TRUST_PROXY === "true" ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : "";
  const client = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
  return crypto.createHash("sha256").update(email + "|" + client).digest("hex");
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

    const keyHash = throttleKey(email, req);
    const now = new Date();
    const attempt = await prisma.loginAttempt.findUnique({ where: { keyHash } });
    if (attempt?.blockedUntil && attempt.blockedUntil > now) return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const current = await prisma.loginAttempt.upsert({ where: { keyHash }, create: { keyHash, attempts: 1, windowStartedAt: now }, update: { attempts: { increment: 1 } } });
      const windowExpired = now.getTime() - current.windowStartedAt.getTime() >= WINDOW_MS;
      if (windowExpired) {
        const reset = await prisma.loginAttempt.updateMany({ where: { id: current.id, windowStartedAt: current.windowStartedAt }, data: { attempts: 1, windowStartedAt: now, blockedUntil: null } });
        if (reset.count === 0) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      } else if (current.attempts >= MAX_ATTEMPTS) {
        await prisma.loginAttempt.updateMany({ where: { id: current.id, attempts: { gte: MAX_ATTEMPTS }, blockedUntil: null }, data: { blockedUntil: new Date(Date.now() + BLOCK_MS) } });
      }
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await prisma.loginAttempt.deleteMany({ where: { keyHash } });
    const { token } = await createSession(user.id);

    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to sign in" }, { status: 400 });
  }
}
