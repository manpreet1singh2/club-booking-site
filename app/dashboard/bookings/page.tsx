"use client";
import Link from "next/link";
import { useEffect,useState } from "react";

export default function Bookings(){
 const [bookings,setBookings]=useState<any[]>([]); const [error,setError]=useState("");
 useEffect(()=>{fetch("/api/bookings").then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d}).then(setBookings).catch(e=>setError(e.message))},[]);
 return <main className="pt-32 pb-20"><div className="container"><span className="eyebrow">Customer portal</span><h1 className="text-5xl font-black mt-3">My bookings.</h1>{error&&<div className="card p-6 mt-8 text-red-300">{error}</div>}<div className="space-y-4 mt-10">{bookings.length===0&&!error?<div className="card p-8"><p className="muted">No bookings yet.</p><Link href="/book" className="btn-primary inline-block mt-6">Create a booking</Link></div>:bookings.map(b=><Link href={"/dashboard/tickets/"+b.id} key={b.id} className="card p-6 block hover:-translate-y-0.5"><div className="flex flex-wrap justify-between gap-4"><div><div className="text-xl font-black">{b.club.name}</div><div className="muted mt-1">{b.bookingCode} · {b.package.name}</div></div><span className="pill">{b.status}</span></div><div className="mt-5 text-sm text-zinc-300">{b.guestCount} guest(s) · {b.paymentStatus} · {b.transportType}</div></Link>)}</div></div></main>
}