"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function Register() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Unable to create account");
      const login = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email, password: form.password }) });
      if (!login.ok) { router.replace("/login"); return; }
      router.replace("/dashboard");
      router.refresh();
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
          {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
          <label className="block text-sm">Full name
            <input required minLength={2} maxLength={100} autoComplete="name" value={form.name} onChange={set("name")} className="input mt-2" />
          </label>
          <label className="block text-sm">WhatsApp / mobile number
            <input required type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={set("phone")} className="input mt-2" />
          </label>
          <label className="block text-sm">Email address
            <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} className="input mt-2" />
          </label>
          <label className="block text-sm">Password (min 8 characters)
            <input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} className="input mt-2" />
          </label>
          <button disabled={busy} className="btn-primary w-full disabled:opacity-50">{busy ? "Creating account…" : "Create account"}</button>
          <p className="text-sm text-center muted">Already registered? <Link href="/login" className="text-white font-bold">Sign in</Link></p>
        </form>
      </div>
    </main>
  );
}
