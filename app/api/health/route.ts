import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
export async function GET(){
  try {
    await prisma.$queryRaw`SELECT 1`;
    const response = NextResponse.json({ ok: true, service: "live-in-the-city" });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    const response = NextResponse.json(
      { ok: false, service: "live-in-the-city" },
      { status: 503 },
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}