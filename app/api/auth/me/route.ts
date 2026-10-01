import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return response({ user: null }, 401);
  return response({
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
  });
}
