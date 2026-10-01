const RESEND_API_URL = "https://api.resend.com/emails";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required email configuration: ${name}`);
  return value;
}

export async function sendPasswordResetEmail(input: { to: string; token: string }) {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("EMAIL_FROM");
  const appUrl = requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(input.token)}`;

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Reset your password",
      text: [
        "We received a request to reset your password.",
        "",
        `Reset your password: ${resetUrl}`,
        "",
        "This link expires in 30 minutes. If you did not request this, you can ignore this email.",
      ].join("\n"),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Password reset email delivery failed");
  }
}
