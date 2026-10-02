import { site } from "@/lib/site";

const FALLBACK = "https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=2000&q=80";

/** Hero background. Plays a muted looping video when NEXT_PUBLIC_HERO_VIDEO_URL is set; image otherwise. */
export function HeroMedia() {
  const poster = site.heroPoster || FALLBACK;
  return (
    <div className="absolute inset-0 opacity-40" aria-hidden="true">
      {site.heroVideo ? (
        <video className="w-full h-full object-cover" autoPlay muted loop playsInline preload="metadata" poster={poster}>
          <source src={site.heroVideo} type={site.heroVideo.endsWith(".webm") ? "video/webm" : "video/mp4"} />
        </video>
      ) : (
        <img src={poster} alt="" className="w-full h-full object-cover" fetchPriority="high" />
      )}
    </div>
  );
}
