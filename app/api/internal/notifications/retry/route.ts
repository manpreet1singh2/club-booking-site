import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { retryNotification } from "@/lib/notifications";

const LOCK_TTL_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || req.headers.get("x-internal-job-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const staleLock = new Date(now.getTime() - LOCK_TTL_MS);
  const jobs = await prisma.notificationLog.findMany({
    where: {
      channel: "WHATSAPP",
      status: "RETRY_PENDING",
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleLock } }],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 25,
    select: { id: true },
  });

  let claimed = 0;
  const results = [];
  for (const job of jobs) {
    const claim = await prisma.notificationLog.updateMany({
      where: {
        id: job.id,
        status: "RETRY_PENDING",
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleLock } }],
      },
      data: { lockedAt: now, status: "PROCESSING" },
    });
    if (claim.count !== 1) continue;

    claimed++;
    try {
      results.push({ id: job.id, ...(await retryNotification(job.id)) });
    } catch (error) {
      await prisma.notificationLog.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: {
          status: "RETRY_PENDING",
          lockedAt: null,
          nextAttemptAt: new Date(Date.now() + 60 * 1000),
          lastError: String(error instanceof Error ? error.message : error).slice(0, 500),
        },
      });
      results.push({ id: job.id, sent: false, error: "Retry failed" });
    }
  }

  return NextResponse.json({ selected: jobs.length, claimed, processed: results.length, results });
}
