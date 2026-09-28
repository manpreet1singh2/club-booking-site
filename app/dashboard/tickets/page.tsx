"use client";
import { useEffect,useState } from "react";
import Link from "next/link";

export default function Tickets(){
 const [bookings,setBookings]=useState<any[]>([]); const [error,setError]=useState("");
 useEffect(()=>{fetch("/api/bookings").then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d}).then(setBookings).catch(e=>setError(e.message))},[]);
 const confirmed=bookings.filter(b=>b.status==="CONFIRMED");
 return <main className="pt-32 pb-20"><div className="container"><span className="eyebrow">Customer portal</span><h1 className="text-5xl font-black mt-3">Digital tickets.</h1>{error&&<div className="card p-6 mt-8 text-red-300">{error}</div>}<div className="space-y-4 mt-10">{confirmed.length===0&&!error?<div className="card p-8"><p className="muted">No confirmed tickets yet.</p></div>:confirmed.map(b=><Link href={"/dashboard/tickets/"+b.id} key={b.id} className="card p-7 block"><div className="text-2xl font-black">{b.club.name}</div><div className="muted mt-2">{b.bookingCode} · {b.package.name} · {b.guestCount} guest(s)</div><span className="btn-primary inline-block mt-6">Open ticket</span></Link>)}</div></div></main>
}