import Link from "next/link";
export default function NotFound() {
  return <main className="pt-40 pb-24"><div className="container max-w-xl text-center"><span className="eyebrow">404</span><h1 className="text-5xl font-black mt-3">Page not found.</h1><p className="muted mt-4">The page you’re looking for doesn’t exist or has moved.</p><Link href="/" className="btn-primary inline-block mt-8">Back home</Link></div></main>;
}
