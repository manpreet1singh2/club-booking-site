"use client";
import { useEffect, useState } from "react";

type Ride = { id:string; status:string; type:string; pickupLocation:string; pickupTime:string; booking:{bookingCode:string; user:{name:string;phone:string}; club:{name:string}} };

const nextStatus: Record<string,string> = { ASSIGNED:"DRIVER_CONFIRMED", DRIVER_CONFIRMED:"ON_THE_WAY", ON_THE_WAY:"ARRIVED", ARRIVED:"PICKED_UP", PICKED_UP:"COMPLETED" };

export default function DriverRides() {
  const [rides,setRides]=useState<Ride[]>([]);
  const [error,setError]=useState("");
  async function load(){ const r=await fetch("/api/transport"); const d=await r.json(); if(r.ok)setRides(d); else setError(d.error||"Unable to load rides"); }
  useEffect(()=>{load()},[]);
  async function advance(id:string,status:string){ const r=await fetch("/api/transport/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}); if(!r.ok){const d=await r.json();setError(d.error||"Update failed");return;} load(); }
  return <main className="mx-auto max-w-5xl px-6 py-12"><h1 className="text-3xl font-semibold">My rides</h1>{error&&<p className="mt-4 text-red-300">{error}</p>}<div className="mt-8 space-y-4">{rides.length===0?<div className="rounded-3xl border border-white/10 p-8 text-zinc-400">No assigned rides.</div>:rides.map(ride=><div key={ride.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="font-semibold">{ride.booking.bookingCode} · {ride.booking.club.name}</div><div className="mt-1 text-sm text-zinc-400">{ride.booking.user.name} · {ride.booking.user.phone||"No phone"}</div></div><span className="rounded-full bg-white/10 px-3 py-1 text-xs">{ride.status}</span></div><div className="mt-4 text-sm text-zinc-300">{ride.pickupLocation} · {new Date(ride.pickupTime).toLocaleString()}</div>{nextStatus[ride.status]&&<button onClick={()=>advance(ride.id,nextStatus[ride.status])} className="mt-5 rounded-full bg-lime-300 px-5 py-2 text-sm font-semibold text-black">Mark {nextStatus[ride.status].replaceAll("_"," ")}</button>}</div>)}</div></main>
}
