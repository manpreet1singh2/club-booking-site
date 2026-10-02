import Link from "next/link";
import { Mail, MapPin, Phone, Clock, MessageCircle } from "lucide-react";
import { site, waLink } from "@/lib/site";

const links = [
  ["Clubs", "/clubs"], ["Events", "/events"], ["Packages", "/packages"],
  ["Book a Night", "/book"], ["FAQ", "/faq"], ["Contact", "/contact"],
];
const legal = [["Terms of Service", "/terms"], ["Privacy Policy", "/privacy"]];

export function Footer() {
  const socials = Object.entries(site.social).filter(([, url]) => url);
  return (
    <footer className="border-t border-white/10 mt-10" aria-label="Site footer">
      <div className="container py-14 grid gap-10 md:grid-cols-4">
        <section aria-labelledby="f-about">
          <h2 id="f-about" className="font-black text-lg">LIVE<span style={{ color: "var(--accent)" }}>.</span>CITY</h2>
          <p className="muted text-sm mt-4 max-w-xs">{site.tagline} Choose your club, pay a 15% advance, and get a digital ticket with optional cab or bike pickup.</p>
        </section>
        <nav aria-labelledby="f-links">
          <h2 id="f-links" className="eyebrow">Links</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {links.map(([n, h]) => <li key={h}><Link href={h} className="muted hover:text-white">{n}</Link></li>)}
            {legal.map(([n, h]) => <li key={h}><Link href={h} className="muted hover:text-white">{n}</Link></li>)}
          </ul>
        </nav>
        <section aria-labelledby="f-contact">
          <h2 id="f-contact" className="eyebrow">Contact</h2>
          <ul className="mt-4 space-y-3 text-sm muted">
            {site.phone && <li className="flex gap-2"><Phone size={15} className="mt-0.5 shrink-0" aria-hidden /><a href={"tel:" + site.phone.replace(/\s/g, "")} className="hover:text-white">{site.phone}</a></li>}
            {site.whatsapp && <li className="flex gap-2"><MessageCircle size={15} className="mt-0.5 shrink-0" aria-hidden /><a href={waLink(site.whatsapp)} className="hover:text-white" target="_blank" rel="noopener noreferrer">WhatsApp us</a></li>}
            {site.email && <li className="flex gap-2"><Mail size={15} className="mt-0.5 shrink-0" aria-hidden /><a href={"mailto:" + site.email} className="hover:text-white break-all">{site.email}</a></li>}
            {site.address && <li className="flex gap-2"><MapPin size={15} className="mt-0.5 shrink-0" aria-hidden />{site.address}</li>}
            {site.hours && <li className="flex gap-2"><Clock size={15} className="mt-0.5 shrink-0" aria-hidden />{site.hours}</li>}
            {!site.phone && !site.whatsapp && !site.email && <li><Link href="/contact" className="hover:text-white">Send us a message</Link></li>}
          </ul>
        </section>
        <section aria-labelledby="f-social">
          <h2 id="f-social" className="eyebrow">Social</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {socials.length === 0 && <li className="muted">Follow us soon.</li>}
            {socials.map(([n, url]) => <li key={n}><a href={url} target="_blank" rel="noopener noreferrer me" className="muted hover:text-white">{n}</a></li>)}
          </ul>
        </section>
      </div>
      <div className="border-t border-white/10 py-6 text-center text-xs muted">© {new Date().getFullYear()} {site.name}. All rights reserved. Please drink responsibly. 18+ / 21+ as per local law.</div>
    </footer>
  );
}
