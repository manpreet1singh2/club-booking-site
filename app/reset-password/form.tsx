"use client";

import { useState } from "react";

export function Form() {
  const token = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token") || ""
    : "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[0-9a-f]{64}$/i.test(token)) return setMessage("This reset link is invalid.");
    if (password !== confirm) return setMessage("Passwords do not match.");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      setMessage(data.message || data.error || "Unable to reset password.");
    } catch {
      setMessage("Unable to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="pt-32 pb-20">
      <div className="container max-w-md">
        <div className="text-center">
          <span className="eyebrow">Account recovery</span>
          <h1 className="text-4xl font-black mt-3">Choose a new password.</h1>
          <p className="muted mt-3">Use the secure recovery link from your email.</p>
        </div>
        <form onSubmit={submit} className="card p-7 mt-8 space-y-4">
          <input
            required
            minLength={8}
            maxLength={128}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="New password"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-4"
          />
          <input
            required
            minLength={8}
            maxLength={128}
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Confirm password"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-4"
          />
          <button disabled={loading || !token} className="btn-primary w-full disabled:opacity-50">
            {loading ? "Resetting..." : "Reset password"}
          </button>
          {message && <p className="muted text-sm">{message}</p>}
        </form>
      </div>
    </main>
  );
}
