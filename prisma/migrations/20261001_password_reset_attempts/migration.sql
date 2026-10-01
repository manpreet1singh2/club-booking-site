CREATE TABLE "PasswordResetAttempt" (
  "id" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PasswordResetAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetAttempt_keyHash_key" ON "PasswordResetAttempt"("keyHash");
CREATE INDEX "PasswordResetAttempt_windowStartedAt_idx" ON "PasswordResetAttempt"("windowStartedAt");
