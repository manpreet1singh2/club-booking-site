"use client";
import { useEffect,useState } from "react";
import Link from "next/link";

export default function TicketDetail({params}:{params:Promise<{id:string}>}) {
  const [booking,setBooking]=useState<any>(null); const [error,setError]=useState("");
  useEffect(()=>{params.then(p=>fetch("/api/bookings/"+p.id)).then(r=>r.json()).then(d=>{if(d.error)setError(d.error);else setBooking(d)})},[params]);
  if(error)return <main className="pt-32 pb-20"><div className="container"><div className="card p-8">{error}</div></div></main>;
  if(!booking)return <main className="pt-32 pb-20"><div className="container"><div className="card p-8">Loading ticket…</div></div></main>;
  const verifyUrl=typeof window!=="undefined"?window.location.origin+"/verify/"+booking.ticketToken:"";
  return <main className="pt-32 pb-20"><div className="container max-w-3xl"><span className="eyebrow">Digital ticket</span><div className="card p-8 mt-6"><div className="flex flex-wrap justify-between gap-4"><div><div className="text-3xl font-black">{booking.club.name}</div><div className="muted mt-1">{booking.bookingCode}</div></div><span className="pill">{booking.status}</span></div><div className="grid sm:grid-cols-2 gap-5 mt-10 text-sm"><div><span className="muted">Guest</span><div className="font-bold mt-1">{booking.user.name} · {booking.guestCount}</div></div><div><span className="muted">Package</span><div className="font-bold mt-1">{booking.package.name}</div></div><div><span className="muted">Payment</span><div className="font-bold mt-1">{booking.paymentStatus}</div></div><div><span className="muted">Transport</span><div className="font-bold mt-1">{booking.transportType}</div></div></div><div className="mt-10 rounded-3xl border border-dashed border-white/15 p-8 text-center"><div className="text-sm font-semibold">Ticket verification URL</div><div className="mt-3 break-all text-xs text-zinc-400">{verifyUrl}</div><Link href={"/verify/"+booking.ticketToken} className="btn-primary inline-block mt-5">Verify ticket</Link></div></div></div></main>;
}
