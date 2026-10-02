"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Bike, Car, Check, Users, User, Armchair } from "lucide-react";

declare global { interface Window { Razorpay?: any } }

type Ev = { id: string; name: string; date: string; startTime: string; endTime: string | null; active: boolean };
type Pkg = { id: string; name: string; description: string | null; price: string; pricing: "PER_PERSON" | "FLAT"; active: boolean };
type Club = { id: string; name: string; city: string; events: Ev[]; packages: Pkg[] };

const steps = ["Club & date", "Guests", "Package", "Transport", "Payment"];
const presets = [
  { label: "Single", count: 1, icon: User },
  { label: "Couple", count: 2, icon: Users },
  { label: "Group", count: 4, icon: Users },
  { label: "Table", count: 6, icon: Armchair },
];
const ADVANCE_RATE = 0.15;
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
const dayKey = (d: string) => new Date(d).toISOString().slice(0, 10);
const todayKey = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function BookFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState(0);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [clubId, setClubId] = useState("");
  const [eventId, setEventId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  const [transportType, setTransportType] = useState<"NONE" | "CAB" | "BIKE">("NONE");
  const [pickupLocation, setPickupLocation] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [booking, setBooking] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [razorpayReady, setRazorpayReady] = useState(false);

  useEffect(() => {
    fetch("/api/clubs").then(r => r.json()).then((list: Club[]) => {
      setClubs(list);
      const wantedClub = params.get("clubId");
      const wantedEvent = params.get("eventId");
      const club = list.find(c => c.id === wantedClub) || list.find(c => c.events.some(e => e.id === wantedEvent)) || list[0];
      if (club) {
        setClubId(club.id);
        const upcoming = club.events.filter(e => e.active && dayKey(e.date) >= todayKey());
        const ev = upcoming.find(e => e.id === wantedEvent) || upcoming[0];
        if (ev) setEventId(ev.id);
        if (club.packages[0]) setPackageId(club.packages[0].id);
      }
    }).catch(() => setError("Unable to load booking options. Please refresh.")).finally(() => setLoaded(true));
  }, [params]);

  const club = clubs.find(c => c.id === clubId);
  const events = useMemo(() => (club?.events || []).filter(e => e.active && dayKey(e.date) >= todayKey()), [club]);
  const packages = (club?.packages || []).filter(p => p.active);
  const pkg = packages.find(p => p.id === packageId);
  const event = events.find(e => e.id === eventId);
  const total = pkg ? (pkg.pricing === "FLAT" ? Number(pkg.price) : Number(pkg.price) * guestCount) : 0;
  const advance = Math.round(total * ADVANCE_RATE * 100) / 100;
  const visitDay = event ? dayKey(event.date) : "";

  function chooseClub(id: string) {
    setClubId(id);
    const c = clubs.find(x => x.id === id);
    const upcoming = (c?.events || []).filter(e => e.active && dayKey(e.date) >= todayKey());
    setEventId(upcoming[0]?.id || "");
    setPackageId(c?.packages.find(p => p.active)?.id || "");
  }

  async function createBooking() {
    if (!event || !pkg) return setError("Please select an event and a package.");
    if (transportType !== "NONE" && (!pickupLocation.trim() || !pickupTime)) return setError("Enter your pickup location and time.");
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          clubId, eventId, packageId, guestCount, visitDate: visitDay, transportType,
          pickupLocation: transportType === "NONE" ? undefined : pickupLocation.trim(),
          pickupTime: transportType === "NONE" ? undefined : new Date(`${visitDay}T${pickupTime}:00+05:30`).toISOString(),
        }),
      });
      if (r.status === 401) { router.push("/login?next=" + encodeURIComponent("/book?clubId=" + clubId + "&eventId=" + eventId)); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : "Unable to create booking");
      setBooking(d); setStep(4);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create booking"); }
    finally { setBusy(false); }
  }

  async function pay() {
    if (!booking) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/payments/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: booking.id }) });
      const o = await r.json();
      if (!r.ok) throw new Error(o.error);
      if (!window.Razorpay) throw new Error("Payment checkout is still loading. Please try again in a moment.");
      const rz = new window.Razorpay({
        key: o.keyId, amount: Math.round(o.amount * 100), currency: o.currency, name: "Live in the City",
        description: `${club?.name} · advance for ${booking.bookingCode}`, order_id: o.orderId,
        theme: { color: "#d7ff3f" },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (v: any) => {
          try {
            const vr = await fetch("/api/payments/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
            const d = await vr.json();
            if (!vr.ok) throw new Error(d.error);
            window.location.href = "/dashboard/tickets/" + booking.id;
          } catch (e) { setError(e instanceof Error ? e.message : "Payment verification failed. If you were charged, your booking will confirm automatically."); setBusy(false); }
        },
      });
      rz.on?.("payment.failed", () => { setError("Payment failed. Please try again."); setBusy(false); });
      rz.open();
    } catch (e) { setError(e instanceof Error ? e.message : "Payment failed"); setBusy(false); }
  }

  const sel = (on: boolean) => "card p-5 text-left " + (on ? "border-lime-300" : "");
  const field = "input mt-2";

  return (
    <main className="pt-32 pb-20">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onLoad={() => setRazorpayReady(true)} />
      <div className="container max-w-4xl">
        <Link href="/" className="muted text-sm flex items-center gap-2"><ArrowLeft size={15} aria-hidden /> Back home</Link>
        <div className="mt-8">
          <span className="eyebrow">Reservation</span>
          <h1 className="text-4xl md:text-6xl font-black mt-3">Build your night.</h1>
          <ol className="flex gap-2 mt-8" aria-label="Booking progress">
            {steps.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} className={"h-1 flex-1 rounded " + (i <= step ? "bg-lime-300" : "bg-zinc-800")}><span className="sr-only">{s}</span></li>)}
          </ol>
          <p className="muted text-sm mt-3">Step {step + 1} of {steps.length} · {steps[step]}</p>

          <div className="card mt-6 p-6 md:p-10">
            {error && <div role="alert" className="mb-5 text-red-300 text-sm">{error}</div>}
            {!loaded && <p className="muted">Loading…</p>}
            {loaded && clubs.length === 0 && <p className="muted">No clubs are open for booking yet.</p>}

            {loaded && clubs.length > 0 && step === 0 && <>
              <h2 className="text-2xl font-black">Where are you going?</h2>
              <div className="grid md:grid-cols-2 gap-4 mt-7">
                <label className="text-sm">Club
                  <select value={clubId} onChange={e => chooseClub(e.target.value)} className={field}>{clubs.map(c => <option key={c.id} value={c.id}>{c.name} — {c.city}</option>)}</select>
                </label>
                <label className="text-sm">Event & date
                  <select value={eventId} onChange={e => setEventId(e.target.value)} className={field}>
                    {events.length === 0 && <option value="">No upcoming events</option>}
                    {events.map(e => <option key={e.id} value={e.id}>{e.name} · {fmtDate(e.date)} · {e.startTime}</option>)}
                  </select>
                </label>
              </div>
              {event && <div className="mt-5 rounded-2xl border border-white/10 p-4 text-sm"><span className="muted">Date & time</span><div className="font-bold mt-1">{fmtDate(event.date)} · {event.startTime}{event.endTime ? `–${event.endTime}` : ""}</div></div>}
            </>}

            {step === 1 && <>
              <h2 className="text-2xl font-black">How many people?</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-7">
                {presets.map(({ label, count, icon: Icon }) => <button key={label} onClick={() => setGuestCount(count)} className={sel(guestCount === count)}><Icon size={20} aria-hidden /><b className="block mt-4">{label}</b><span className="muted text-xs">{count} guest{count > 1 ? "s" : ""}</span></button>)}
              </div>
              <label className="block text-sm mt-6 max-w-xs">Exact guest count
                <input type="number" min={1} max={100} value={guestCount} onChange={e => setGuestCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className={field} />
              </label>
            </>}

            {step === 2 && <>
              <h2 className="text-2xl font-black">Choose your package.</h2>
              <div className="grid gap-3 mt-7">
                {packages.length === 0 && <p className="muted">This club has no active packages.</p>}
                {packages.map(p => <button key={p.id} onClick={() => setPackageId(p.id)} className={sel(packageId === p.id) + " flex justify-between gap-4"}>
                  <span><b>{p.name}</b><span className="block muted text-sm mt-1">{p.description || "Premium nightlife access"}</span></span>
                  <b className="whitespace-nowrap">{inr(Number(p.price))}{p.pricing === "PER_PERSON" ? " / guest" : ""}</b>
                </button>)}
              </div>
            </>}

            {step === 3 && <>
              <h2 className="text-2xl font-black">Add transport.</h2>
              <div className="grid md:grid-cols-3 gap-3 mt-7">
                {([["NONE", "No pickup", Check], ["CAB", "Cab pickup", Car], ["BIKE", "Bike pickup", Bike]] as const).map(([x, y, Icon]) =>
                  <button key={x} onClick={() => setTransportType(x)} className={sel(transportType === x)}><Icon size={20} aria-hidden /><b className="block mt-5">{y}</b></button>)}
              </div>
              {transportType !== "NONE" && <div className="grid md:grid-cols-2 gap-4 mt-6">
                <label className="text-sm">Pickup location<input value={pickupLocation} onChange={e => setPickupLocation(e.target.value)} placeholder="Address or landmark" className={field} /></label>
                <label className="text-sm">Pickup time (IST)<input type="time" value={pickupTime} onChange={e => setPickupTime(e.target.value)} className={field} /></label>
              </div>}
            </>}

            {step === 4 && booking && <>
              <h2 className="text-2xl font-black">Confirm & pay.</h2>
              <div className="bg-zinc-900 rounded-2xl p-6 mt-6 space-y-3 text-sm">
                <div className="flex justify-between"><span className="muted">Booking</span><b>{booking.bookingCode}</b></div>
                <div className="flex justify-between"><span className="muted">{club?.name} · {pkg?.name}</span><b>{guestCount} guest{guestCount > 1 ? "s" : ""}</b></div>
                <div className="flex justify-between"><span className="muted">Booking total</span><b>{inr(total)}</b></div>
                <div className="flex justify-between"><span className="muted">15% advance due now</span><b className="text-lime-300">{inr(advance)}</b></div>
                <div className="flex justify-between"><span className="muted">Balance at the club</span><b>{inr(Math.round((total - advance) * 100) / 100)}</b></div>
              </div>
              <p className="muted text-xs mt-4">Your slot is held for 15 minutes. Ticket and confirmation arrive on WhatsApp after payment.</p>
            </>}

            <div className="flex justify-between mt-8">
              <button disabled={step === 0 || busy} onClick={() => { if (step === 4) setBooking(null); setStep(step - 1); }} className="btn-secondary disabled:opacity-30">Back</button>
              {step < 3 ? <button disabled={busy || (step === 0 && !eventId) || (step === 2 && !packageId)} onClick={() => setStep(step + 1)} className="btn-primary flex items-center gap-2 disabled:opacity-40">Continue <ArrowRight size={17} aria-hidden /></button>
                : step === 3 ? <button disabled={busy || !packageId || !eventId || (transportType !== "NONE" && (!pickupLocation.trim() || !pickupTime))} onClick={createBooking} className="btn-primary disabled:opacity-40">{busy ? "Reserving…" : "Review booking"}</button>
                : <button disabled={busy || !razorpayReady} onClick={pay} className="btn-primary flex items-center gap-2 disabled:opacity-40"><Check size={17} aria-hidden /> {busy ? "Processing…" : `Pay ${inr(advance)}`}</button>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Book() {
  return <Suspense fallback={<main className="pt-32 container"><div className="card p-8 muted">Loading…</div></main>}><BookFlow /></Suspense>;
}
