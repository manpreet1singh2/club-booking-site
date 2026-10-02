"use client";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function homeFor(role?: string) {
  if (role === "SUPER_ADMIN" || role === "CLUB_OWNER") return "/admin";
  if (role === "DRIVER") return "/driver";
  return "/dashboard";
}

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Unable to sign in");
      router.replace(safeNext(params.get("next")) || homeFor(d.user?.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
      setBusy(false);
    }
  }

  return (
    <main className="pt-32 pb-20">
      <div className="container max-w-md">
        <div className="text-center">
          <span className="eyebrow">Welcome back</span>
          <h1 className="text-4xl font-black mt-3">Sign in.</h1>
          <p className="muted mt-3">Access your bookings and tickets.</p>
        </div>
        <form onSubmit={submit} className="card p-7 mt-8 space-y-4">
          {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
          <label className="block text-sm">Email address
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" className="input mt-2" />
          </label>
          <label className="block text-sm">Password
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" required autoComplete="current-password" className="input mt-2" />
          </label>
          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-sm" style={{ color: "var(--accent)" }}>Forgot password?</Link>
          </div>
          <button disabled={busy} className="btn-primary w-full disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
          <p className="text-sm text-center muted">New here? <Link href="/register" className="text-white font-bold">Create account</Link></p>
        </form>
      </div>
    </main>
  );
}

export default function Login() {
  return <Suspense><LoginForm /></Suspense>;
}
