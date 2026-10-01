import { NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || req.headers.get("x-internal-job-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deleted = await cleanupExpiredSessions(500);
  const staleLoginAttempts = await prisma.loginAttempt.deleteMany({
    where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
  const stalePasswordResetAttempts = await prisma.passwordResetAttempt.deleteMany({
    where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
  const expiredPasswordResetTokens = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  const expired = await prisma.booking.updateMany({
    where: { status: "PENDING_PAYMENT", paymentStatus: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  return NextResponse.json({ deleted, staleLoginAttempts: staleLoginAttempts.count, stalePasswordResetAttempts: stalePasswordResetAttempts.count, expiredPasswordResetTokens: expiredPasswordResetTokens.count, expiredBookings: expired.count });
}
