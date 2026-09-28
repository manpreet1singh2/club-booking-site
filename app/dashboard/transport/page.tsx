"use client";
import { useEffect,useState } from "react";

export default function Transport(){
 const [rides,setRides]=useState<any[]>([]); const [error,setError]=useState("");
 useEffect(()=>{fetch("/api/transport").then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d}).then(setRides).catch(e=>setError(e.message))},[]);
 return <main className="pt-32 pb-20"><div className="container"><span className="eyebrow">Customer portal</span><h1 className="text-5xl font-black mt-3">Transport.</h1>{error&&<div className="card p-6 mt-8 text-red-300">{error}</div>}<div className="space-y-4 mt-10">{rides.length===0&&!error?<div className="card p-8"><p className="muted">No transport assigned yet.</p></div>:rides.map(r=><div className="card p-7" key={r.id}><div className="flex justify-between gap-4"><div className="text-xl font-black">{r.type}</div><span className="pill">{r.status}</span></div><div className="mt-5 text-sm text-zinc-300">{r.pickupLocation}</div><div className="muted mt-2">{new Date(r.pickupTime).toLocaleString()}</div>{r.driver&&<div className="mt-5 border-t border-white/10 pt-5 text-sm">Driver: <b>{r.driver.user.name}</b>{r.driver.user.phone&&<span className="muted"> · {r.driver.user.phone}</span>}<div className="muted mt-1">{r.driver.vehicleNumber||"Vehicle details pending"}</div></div>}</div>)}</div></div></main>
}