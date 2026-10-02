"use client";
import { FormEvent, useState } from "react";
import { site, waLink } from "@/lib/site";

export default function Contact() {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setState("busy");
    setError("");
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Unable to send message");
      form.reset();
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message");
      setState("idle");
    }
  }

  return (
    <main className="pt-32 pb-20">
      <div className="container max-w-5xl">
        <span className="eyebrow">Contact</span>
        <h1 className="text-5xl md:text-7xl font-black mt-3">Talk to us.</h1>
        <div className="grid md:grid-cols-2 gap-6 mt-12">
          <div className="card p-7">
            <h2 className="text-2xl font-black">Need help with a booking?</h2>
            <p className="muted mt-3">Send your details and our team can help with bookings, transport or event questions.</p>
            <ul className="mt-8 space-y-3 text-sm text-zinc-300">
              {site.whatsapp && <li>WhatsApp: <a className="underline" href={waLink(site.whatsapp)} target="_blank" rel="noopener noreferrer">{site.whatsapp}</a></li>}
              {site.phone && <li>Phone: <a className="underline" href={"tel:" + site.phone.replace(/\s/g, "")}>{site.phone}</a></li>}
              {site.email && <li>Email: <a className="underline" href={"mailto:" + site.email}>{site.email}</a></li>}
              {site.address && <li>Address: {site.address}</li>}
              {site.hours && <li>Hours: {site.hours}</li>}
            </ul>
          </div>
          <form onSubmit={submit} className="card p-7 space-y-4">
            {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
            {state === "sent" && <p role="status" className="text-lime-300 text-sm">Thanks — we’ve received your message and will reply soon.</p>}
            <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            <label className="block text-sm">Your name<input name="name" required minLength={2} autoComplete="name" className="input mt-2" /></label>
            <label className="block text-sm">Phone number<input name="phone" required type="tel" autoComplete="tel" className="input mt-2" /></label>
            <label className="block text-sm">Email address<input name="email" required type="email" autoComplete="email" className="input mt-2" /></label>
            <label className="block text-sm">How can we help?<textarea name="message" required minLength={5} rows={5} className="input mt-2" /></label>
            <button disabled={state === "busy"} className="btn-primary w-full disabled:opacity-50">{state === "busy" ? "Sending…" : "Send message"}</button>
          </form>
        </div>
      </div>
    </main>
  );
}
