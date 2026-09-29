"use client";
import {useEffect,useState} from "react";

export default function Profile(){
  const [form,setForm]=useState({name:"",phone:"",email:""});
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  useEffect(()=>{
    fetch("/api/profile").then(r=>r.json()).then(d=>setForm({name:d.name||"",phone:d.phone||"",email:d.email||""})).catch(()=>setError("Unable to load profile"));
  },[]);

  async function save(e:React.FormEvent){
    e.preventDefault(); setMessage(""); setError("");
    const r=await fetch("/api/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
    const d=await r.json();
    if(!r.ok){setError(d.error||"Unable to save profile");return}
    setForm({...form,name:d.name,phone:d.phone||""}); setMessage("Profile updated.");
  }

  return <main className="pt-32 pb-20"><div className="container max-w-2xl"><span className="eyebrow">Customer portal</span><h1 className="text-5xl font-black mt-3">Profile.</h1><form onSubmit={save} className="card p-7 mt-10 space-y-4">{error&&<p className="text-red-300 text-sm">{error}</p>}{message&&<p className="text-lime-300 text-sm">{message}</p>}<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name" className="input w-full"/><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Mobile / WhatsApp" className="input w-full"/><input value={form.email} disabled placeholder="Email address" className="input w-full opacity-60"/><button className="btn-primary">Save changes</button></form></div></main>
}
