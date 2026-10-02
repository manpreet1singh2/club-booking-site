import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = site.url.replace(/\/$/, "");
  const staticPages = ["", "/clubs", "/events", "/packages", "/about", "/faq", "/contact", "/terms", "/privacy"].map(p => ({ url: base + p, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 }));
  try {
    const clubs = await prisma.club.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } });
    return [...staticPages, ...clubs.map(c => ({ url: `${base}/clubs/${c.slug}`, lastModified: c.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 }))];
  } catch {
    return staticPages;
  }
}
