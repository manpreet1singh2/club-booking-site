import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(5).max(2000),
  website: z.string().max(0).optional(), // honeypot
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please complete all fields with valid details." }, { status: 400 });
  const { website: _hp, ...data } = parsed.data;
  await writeAuditLog({ action: "CONTACT_MESSAGE", entity: "ContactMessage", metadata: data });
  return NextResponse.json({ ok: true });
}
