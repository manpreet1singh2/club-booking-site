import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ADVANCE_RATE } from "@/lib/booking";

export const dynamic = "force-dynamic";

const flag = (v?: string) => Boolean(v && v.length > 0);

export default async function Settings() {
  const u = await getCurrentUser();
  if (!u || u.role !== "SUPER_ADMIN") redirect("/admin");
  const checks: [string, boolean, string][] = [
    ["Payment gateway (Razorpay keys)", flag(process.env.PAYMENT_KEY_ID) && flag(process.env.PAYMENT_KEY_SECRET), "PAYMENT_KEY_ID, PAYMENT_KEY_SECRET"],
    ["Payment webhook secret", flag(process.env.PAYMENT_WEBHOOK_SECRET), "PAYMENT_WEBHOOK_SECRET"],
    ["WhatsApp Cloud API", flag(process.env.WHATSAPP_ACCESS_TOKEN) && flag(process.env.WHATSAPP_PHONE_NUMBER_ID), "WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID"],
    ["Scheduled jobs secret", flag(process.env.INTERNAL_JOB_SECRET), "INTERNAL_JOB_SECRET"],
    ["Google Maps key", flag(process.env.GOOGLE_MAPS_API_KEY), "GOOGLE_MAPS_API_KEY"],
    ["Proxy trust (rate-limit IPs)", process.env.TRUST_PROXY === "true", "TRUST_PROXY=true on Vercel"],
  ];
  return (
    <main className="pt-32 pb-20"><div className="container max-w-3xl">
      <span className="eyebrow">System</span><h1 className="text-5xl font-black mt-3">Settings.</h1>
      <div className="card p-7 mt-10 space-y-3">
        <p className="muted text-sm">Booking advance</p><p className="text-2xl font-black">{Math.round(ADVANCE_RATE * 100)}%</p>
        <p className="muted text-xs">Fixed by business rule. Change in lib/booking.ts.</p>
      </div>
      <div className="card p-7 mt-4"><h2 className="font-black text-xl">Integration status</h2>
        <ul className="mt-5 space-y-3">{checks.map(([label, ok, env]) => <li key={label} className="flex items-start justify-between gap-4 text-sm"><span>{label}<span className="block muted text-xs">{env}</span></span><span className={"pill " + (ok ? "text-lime-300" : "text-red-300")}>{ok ? "Configured" : "Missing"}</span></li>)}</ul>
      </div>
    </div></main>
  );
}
