// Public business details. Set these in Vercel env vars; empty values are simply not rendered.
const env = (v?: string) => (v && v.trim() ? v.trim() : "");

export const site = {
  name: env(process.env.NEXT_PUBLIC_SITE_NAME) || "Live in the City",
  tagline: "Club nights, tables and rides home — in one booking.",
  url: env(process.env.NEXT_PUBLIC_APP_URL) || "http://localhost:3000",
  phone: env(process.env.NEXT_PUBLIC_CONTACT_PHONE),
  whatsapp: env(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP),
  email: env(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
  address: env(process.env.NEXT_PUBLIC_CONTACT_ADDRESS),
  hours: env(process.env.NEXT_PUBLIC_CONTACT_HOURS),
  heroVideo: env(process.env.NEXT_PUBLIC_HERO_VIDEO_URL),
  heroPoster: env(process.env.NEXT_PUBLIC_HERO_POSTER_URL),
  social: {
    Instagram: env(process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM),
    Facebook: env(process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK),
    X: env(process.env.NEXT_PUBLIC_SOCIAL_X),
    YouTube: env(process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE),
  } as Record<string, string>,
};

export const waLink = (digits: string) => "https://wa.me/" + digits.replace(/\D/g, "");
