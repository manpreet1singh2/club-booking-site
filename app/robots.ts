import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/dashboard", "/driver", "/api", "/verify", "/reset-password"] }],
    sitemap: site.url.replace(/\/$/, "") + "/sitemap.xml",
  };
}
