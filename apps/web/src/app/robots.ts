import type { MetadataRoute } from "next";

const siteOrigin =
  process.env.NEXT_PUBLIC_WEB_ORIGIN ||
  process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_MAINNET ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin,
  };
}
