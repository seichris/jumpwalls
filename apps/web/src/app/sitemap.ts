import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/site-origin";

const siteOrigin = getSiteOrigin();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteOrigin}/`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteOrigin}/request/new`,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];
}
