import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, hashPassword, hashPasswordResetToken } from "@/lib/auth";
import { z } from "zod";

const resetSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/i),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const parsed = resetSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid reset token or password" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const { token, password } = parsed.data;
    const tokenHash = hashPasswordResetToken(token);
    const now = new Date();

    const result = await prisma.$transaction(async tx => {
      const reset = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, expiresAt: true, usedAt: true },
      });

      if (!reset || reset.usedAt || reset.expiresAt <= now) {
        return null;
      }

      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return null;

      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash: hashPassword(password) },
      });

      await tx.session.deleteMany({ where: { userId: reset.userId } });
      await tx.passwordResetToken.deleteMany({
        where: { userId: reset.userId, id: { not: reset.id } },
      });

      return { userId: reset.userId };
    });

    if (!result) {
      return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ ok: true, message: "Password reset successfully. Please sign in again." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Password reset failed", error);
    return NextResponse.json({ error: "Unable to reset password" }, { status: 400 });
  }
}
