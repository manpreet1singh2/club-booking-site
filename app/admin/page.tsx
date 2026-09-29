"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
const cards=[["/admin/bookings","Bookings","Manage reservations, status and payments"],["/admin/clubs","Clubs","Manage clubs and availability"],["/admin/events","Events","Create and manage upcoming events"],["/admin/packages","Packages","Control pricing and experiences"],["/admin/transport","Transport","Drivers, vehicles and assignments"],["/admin/reports","Reports","Export bookings and performance data"],["/admin/users","Users","Customers, owners and drivers"],["/admin/settings","Settings","System and operational settings"]];
type Stats={totalBookings:number;todayBookings:number;confirmedBookings:number;pendingPayments:number;revenue:number;transportPending:number;transportActive:number;clubs:number;users:number};
export default function Admin(){
 const [stats,setStats]=useState<Stats|null>(null); const [role,setRole]=useState("");
 useEffect(()=>{fetch("/api/auth/me").then(r=>r.ok?r.json():null).then(u=>setRole(u?.role||""));fetch("/api/admin/stats").then(r=>r.ok?r.json():null).then(setStats)},[]);
 const money=(n:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
 return <main className="pt-32 pb-20"><div className="container">
  <span className="eyebrow">Operations</span><h1 className="text-5xl md:text-7xl font-black mt-3">Control center.</h1><p className="muted mt-4">Manage the complete Live in the City operation.</p>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-10">{[
   ["Today",stats?.todayBookings??0],["Confirmed",stats?.confirmedBookings??0],["Pending payment",stats?.pendingPayments??0],["Booking value",stats?money(stats.revenue):"—"]
  ].map(([l,v])=><div className="card p-5" key={String(l)}><p className="muted text-sm">{l}</p><p className="text-2xl font-black mt-2">{v}</p></div>)}</div>
  <div className="grid md:grid-cols-4 gap-4 mt-6">{cards.filter(([h])=>role==="CLUB_OWNER"?["/admin/bookings","/admin/events","/admin/packages","/admin/transport","/admin/reports"].includes(h):true).map(([h,t,d])=><Link href={h} key={h} className="card p-6 hover:-translate-y-1"><h2 className="font-black text-xl">{t}</h2><p className="muted text-sm mt-2">{d}</p><span className="block mt-7 text-sm font-bold" style={{color:"var(--accent)"}}>Open →</span></Link>)}</div>
 </div></main>
}