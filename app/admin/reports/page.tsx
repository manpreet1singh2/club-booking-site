"use client";
import { useEffect, useState } from "react";

type Stats = { totalBookings:number; todayBookings:number; confirmedBookings:number; pendingPayments:number; revenue:number; advanceRevenue:number; transportPending:number; transportActive:number; clubs:number; users:number };

export default function Reports(){
  const [stats,setStats]=useState<Stats|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{ fetch("/api/admin/stats").then(r=>r.ok?r.json():null).then(setStats).finally(()=>setLoading(false)); },[]);
  const download=(extra="")=>{ window.location.href="/api/admin/reports/bookings"+extra; };
  const money=(n:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
  return <main className="pt-32 pb-20"><div className="container">
    <span className="eyebrow">Analytics</span><h1 className="text-5xl font-black mt-3">Reports.</h1>
    <p className="muted mt-4">Operational performance, revenue visibility and Excel-compatible booking exports.</p>
    <div className="grid md:grid-cols-4 gap-4 mt-10">
      {[
        ["Total bookings",stats?.totalBookings ?? 0],["Today",stats?.todayBookings ?? 0],["Confirmed",stats?.confirmedBookings ?? 0],["Pending payment",stats?.pendingPayments ?? 0],
        ["Booking value",stats?money(stats.revenue):"—"],["Advance tracked",stats?money(stats.advanceRevenue):"—"],["Transport pending",stats?.transportPending ?? 0],["Transport active",stats?.transportActive ?? 0]
      ].map(([label,value])=><div className="card p-5" key={String(label)}><p className="muted text-sm">{label}</p><p className="text-2xl font-black mt-2">{loading?"…":value}</p></div>)}
    </div>
    <div className="grid md:grid-cols-3 gap-4 mt-10">
      <div className="card p-6"><h2 className="font-black text-xl">Bookings</h2><p className="muted mt-2 text-sm">All reservation records with customer, club, package, payment and transport details.</p><button onClick={()=>download()} className="btn-primary text-sm mt-6">Download Excel-compatible CSV</button></div>
      <div className="card p-6"><h2 className="font-black text-xl">Payments</h2><p className="muted mt-2 text-sm">Booking value and payment status are included in the booking export.</p><button onClick={()=>download("?paymentStatus=PAID")} className="btn-secondary text-sm mt-6">Export paid bookings</button></div>
      <div className="card p-6"><h2 className="font-black text-xl">Transport</h2><p className="muted mt-2 text-sm">Pickup location, transport type and booking payment status are included for operations.</p><button onClick={()=>download("?transportType=CAB")} className="btn-secondary text-sm mt-6">Export cab bookings</button></div>
    </div>
    <div className="card p-6 mt-4"><h2 className="font-black text-xl">Scope</h2><p className="muted text-sm mt-2">Super admins see the complete platform. Club owners only receive records belonging to their own clubs.</p></div>
  </div></main>
}
