import crypto from "crypto";

const keyId = process.env.PAYMENT_KEY_ID;
const keySecret = process.env.PAYMENT_KEY_SECRET;

export function requireRazorpayConfig() {
  if (!keyId || !keySecret) throw new Error("Payment gateway is not configured");
  return { keyId, keySecret };
}

export async function createRazorpayOrder(amount: number, receipt: string) {
  const { keyId, keySecret } = requireRazorpayConfig();
  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: "INR", receipt }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to create payment order");
  return response.json() as Promise<{ id: string; amount: number; currency: string; status: string; receipt: string }>;
}

export async function fetchRazorpayPayment(paymentId: string) {
  const { keyId, keySecret } = requireRazorpayConfig();
  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
    headers: { Authorization: "Basic " + auth },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to verify payment with gateway");
  return response.json() as Promise<{ id: string; order_id: string; amount: number; currency: string; status: string }>;
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
  const { keySecret } = requireRazorpayConfig();
  const expected = crypto.createHmac("sha256", keySecret).update(orderId + "|" + paymentId).digest("hex");
  const actual = Buffer.from(signature); const expectedBuffer = Buffer.from(expected); return actual.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

export async function createRazorpayRefund(paymentId: string, amount: number, receipt: string) {
  const { keyId, keySecret } = requireRazorpayConfig();
  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId) + "/refund", { method: "POST", headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" }, body: JSON.stringify({ amount: Math.round(amount * 100), receipt }), cache: "no-store" });
  if (!response.ok) throw new Error("Unable to create payment refund");
  return response.json() as Promise<{ id: string; amount: number; status: string; payment_id: string }>;
}


export async function fetchRazorpayRefunds(paymentId: string) {
  const { keyId, keySecret } = requireRazorpayConfig();
  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId) + "/refunds", {
    headers: { Authorization: "Basic " + auth },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to fetch payment refunds");
  return response.json() as Promise<{ count: number; items: Array<{ id: string; amount: number; payment_id: string; receipt: string | null; status: string }> }>;
}

export function verifyWebhookSignature(body: string, signature: string) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) throw new Error("Payment webhook secret is not configured");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
