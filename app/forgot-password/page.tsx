"use client";
import { FormEvent, useState } from "react";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/auth/request-password-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await r.json().catch(() => ({}));
      setMessage(d.message || "If an account exists for that email, recovery instructions have been requested.");
    } catch {
      setMessage("Unable to send the request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pt-32 pb-20">
      <div className="container max-w-md">
        <div className="text-center">
          <span className="eyebrow">Account recovery</span>
          <h1 className="text-4xl font-black mt-3">Reset your password.</h1>
          <p className="muted mt-3">Enter your account email to receive recovery instructions.</p>
        </div>
        <form onSubmit={submit} className="card p-7 mt-8 space-y-4">
          <label className="block text-sm">Email address
            <input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="input mt-2" />
          </label>
          <button disabled={busy} className="btn-primary w-full disabled:opacity-50">{busy ? "Sending…" : "Send reset link"}</button>
          {message && <p role="status" className="muted text-sm">{message}</p>}
        </form>
      </div>
    </main>
  );
}
