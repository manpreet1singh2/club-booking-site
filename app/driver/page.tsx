import Link from "next/link";

export default function DriverDashboard() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-lime-300">Driver Portal</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your assigned rides, in one place.</h1>
      <p className="mt-4 max-w-2xl text-zinc-400">Confirm a ride, update pickup progress, and close the trip when the customer is safely dropped off.</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/driver/rides" className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 hover:bg-white/[0.06]">
          <div className="text-xl font-semibold">My rides</div><div className="mt-2 text-sm text-zinc-400">View and update assigned transport bookings.</div>
        </Link>
      </div>
    </main>
  );
}
