"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function Register() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Unable to create account");
      const login = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email, password: form.password }) });
      if (!login.ok) { window.location.href = "/login"; return; }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/book";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
      setBusy(false);
    }
  }

  return (
    <main className="pt-32 pb-20">
      <div className="container max-w-md">
        <div className="text-center">
          <span className="eyebrow">Create account</span>
          <h1 className="text-4xl font-black mt-3">Your nights start here.</h1>
        </div>
        <form onSubmit={submit} className="card p-7 mt-8 space-y-4">
          <input required minLength={2} autoComplete="name" value={form.name} onChange={set("name")} placeholder="Full name" className="input" />
          <div>
            <input required type="tel" autoComplete="tel" inputMode="tel" pattern="[+0-9 ()-]{10,20}" value={form.phone} onChange={set("phone")} placeholder="WhatsApp number" className="input" />
            <p className="muted text-xs mt-1.5">Your ticket and pickup alerts are sent on WhatsApp.</p>
          </div>
          <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="Email address" className="input" />
          <input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} placeholder="Password (8+ characters)" className="input" />
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <button disabled={busy} className="btn-primary w-full disabled:opacity-50">{busy ? "Creating account…" : "Create account"}</button>
          <p className="muted text-sm text-center">Already have an account? <Link href="/login" className="text-white underline">Sign in</Link></p>
        </form>
      </div>
    </main>
  );
}
