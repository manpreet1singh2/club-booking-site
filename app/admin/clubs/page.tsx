"use client";
import {useEffect,useState} from "react";
type Club={id:string;name:string;slug:string;city:string;address:string;active:boolean;_count:{bookings:number;events:number;packages:number}};
export default function ClubsAdmin(){
 const [rows,setRows]=useState<Club[]>([]); const [form,setForm]=useState({name:"",slug:"",city:"",address:""});
 const load=()=>fetch("/api/admin/clubs").then(r=>r.ok?r.json():[]).then(setRows); useEffect(load,[]);
 async function add(){if(!form.name||!form.slug||!form.city||!form.address)return;await fetch("/api/admin/clubs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});setForm({name:"",slug:"",city:"",address:""});load();}
 async function toggle(c:Club){await fetch("/api/admin/clubs/"+c.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...c,active:!c.active})});load();}
 return <main className="pt-32 pb-20"><div className="container"><span className="eyebrow">Operations</span><h1 className="text-5xl font-black mt-3">Clubs.</h1>
 <div className="card p-6 mt-10"><div className="grid md:grid-cols-4 gap-3">{Object.entries(form).map(([k,v])=><input key={k} className="input" placeholder={k} value={v} onChange={e=>setForm({...form,[k]:e.target.value})}/>)}</div><button className="btn-primary mt-4" onClick={add}>Add club</button></div>
 <div className="grid md:grid-cols-2 gap-4 mt-6">{rows.map(c=><div className="card p-6" key={c.id}><div className="flex justify-between"><h2 className="font-black text-xl">{c.name}</h2><span>{c.active?"Active":"Inactive"}</span></div><p className="muted mt-2">{c.city} · {c.address}</p><p className="muted text-sm mt-3">{c._count.bookings} bookings · {c._count.events} events · {c._count.packages} packages</p><button className="btn-secondary text-sm mt-5" onClick={()=>toggle(c)}>{c.active?"Deactivate":"Activate"}</button></div>)}</div>
 </div></main>
}