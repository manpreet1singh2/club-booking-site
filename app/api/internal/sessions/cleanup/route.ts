import { NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const BATCH_SIZE = 500;

export async function POST(req: Request) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || req.headers.get("x-internal-job-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60_000);

  const deleted = await cleanupExpiredSessions(BATCH_SIZE);

  const staleLoginRows = await prisma.loginAttempt.findMany({
    where: { updatedAt: { lt: staleBefore } },
    select: { id: true },
    take: BATCH_SIZE,
  });
  const staleLoginAttempts = staleLoginRows.length
    ? await prisma.loginAttempt.deleteMany({ where: { id: { in: staleLoginRows.map(row => row.id) } } })
    : { count: 0 };

  const staleResetRows = await prisma.passwordResetAttempt.findMany({
    where: { updatedAt: { lt: staleBefore } },
    select: { id: true },
    take: BATCH_SIZE,
  });
  const stalePasswordResetAttempts = staleResetRows.length
    ? await prisma.passwordResetAttempt.deleteMany({ where: { id: { in: staleResetRows.map(row => row.id) } } })
    : { count: 0 };

  const expiredTokenRows = await prisma.passwordResetToken.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true },
    take: BATCH_SIZE,
  });
  const expiredPasswordResetTokens = expiredTokenRows.length
    ? await prisma.passwordResetToken.deleteMany({ where: { id: { in: expiredTokenRows.map(row => row.id) } } })
    : { count: 0 };

  const expiredBookingRows = await prisma.booking.findMany({
    where: { status: "PENDING_PAYMENT", paymentStatus: "PENDING", expiresAt: { lte: now } },
    select: { id: true },
    take: BATCH_SIZE,
  });
  const expired = expiredBookingRows.length
    ? await prisma.booking.updateMany({
        where: {
          id: { in: expiredBookingRows.map(row => row.id) },
          status: "PENDING_PAYMENT",
          paymentStatus: "PENDING",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      })
    : { count: 0 };

  return NextResponse.json({
    deleted,
    staleLoginAttempts: staleLoginAttempts.count,
    stalePasswordResetAttempts: stalePasswordResetAttempts.count,
    expiredPasswordResetTokens: expiredPasswordResetTokens.count,
    expiredBookings: expired.count,
  });
}
