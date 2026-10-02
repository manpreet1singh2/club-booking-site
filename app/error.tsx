"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="pt-40 pb-24"><div className="container max-w-xl text-center"><span className="eyebrow">Something went wrong</span><h1 className="text-4xl font-black mt-3">We hit a snag.</h1><p className="muted mt-4">Please try again. If it keeps happening, contact support.</p><button onClick={reset} className="btn-primary mt-8">Try again</button></div></main>;
}
