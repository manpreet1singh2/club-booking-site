import { NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/auth";

export async function POST(req: Request) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || req.headers.get("x-internal-job-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deleted = await cleanupExpiredSessions(500);
  return NextResponse.json({ deleted });
}
