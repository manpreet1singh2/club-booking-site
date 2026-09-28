"use client";
import { useEffect, useState } from "react";

export default function VerifyTicket({ params }: { params: Promise<{ token: string }> }) {
  const [token,setToken]=useState(""); const [data,setData]=useState<any>(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{params.then(p=>{setToken(p.token); return fetch("/api/tickets/"+p.token)}).then(r=>r.json()).then(setData).finally(()=>setLoading(false))},[params]);
  if(loading) return <main className="pt-32 pb-20"><div className="container"><div className="card p-8">Checking ticket…</div></div></main>;
  const valid=Boolean(data?.valid);
  return <main className="pt-32 pb-20"><div className="container max-w-2xl"><span className="eyebrow">Ticket verification</span><div className={"card p-8 mt-6 "+(valid?"":"border-red-400/30")}><div className="text-4xl font-black">{valid?"✓ Valid ticket":"Invalid ticket"}</div>{data?.ticket&&<div className="mt-8 space-y-3 text-sm"><div><b>Booking:</b> {data.ticket.bookingCode}</div><div><b>Guest:</b> {data.ticket.user.name} · {data.ticket.guestCount} guest(s)</div><div><b>Club:</b> {data.ticket.club.name}, {data.ticket.club.city}</div><div><b>Package:</b> {data.ticket.package.name}</div>{data.ticket.event&&<div><b>Event:</b> {data.ticket.event.name} · {new Date(data.ticket.event.date).toLocaleDateString()} · {data.ticket.event.startTime}</div>}</div>}{!data?.ticket&&<p className="muted mt-4">The ticket token could not be found.</p>}</div></div></main>;
}
