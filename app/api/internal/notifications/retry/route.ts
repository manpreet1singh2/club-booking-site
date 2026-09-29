import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { retryNotification } from "@/lib/notifications";

export async function POST(req: Request) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || req.headers.get("x-internal-job-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const jobs = await prisma.notificationLog.findMany({
    where: {
      channel: "WHATSAPP",
      status: "RETRY_PENDING",
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 25,
    select: { id: true },
  });

  const results = [];
  for (const job of jobs) {
    results.push({ id: job.id, ...(await retryNotification(job.id)) });
  }

  return NextResponse.json({ processed: results.length, results });
}
