"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy");
    const r = await fetch("/api/auth/request-password-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    if (r && (r.ok || r.status === 202)) { setState("sent"); return; }
    const d = await r?.json().catch(() => ({}));
    setMessage(d?.error || "Something went wrong. Please try again.");
    setState("error");
  }

  return (
    <main className="pt-32 pb-20">
      <div className="container max-w-md">
        <div className="text-center">
          <span className="eyebrow">Account recovery</span>
          <h1 className="text-4xl font-black mt-3">Reset your password.</h1>
        </div>
        {state === "sent" ? (
          <div className="card p-7 mt-8 text-center">
            <p>If an account exists for <b>{email}</b>, a reset link is on its way. It expires in 30 minutes.</p>
            <Link href="/login" className="btn-secondary inline-block mt-6">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-7 mt-8 space-y-4">
            <input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" className="input" />
            {state === "error" && <p role="alert" className="text-sm text-red-400">{message}</p>}
            <button disabled={state === "busy"} className="btn-primary w-full disabled:opacity-50">{state === "busy" ? "Sending…" : "Send reset link"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
