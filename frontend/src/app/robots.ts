import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://hireops.symprio.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Don't crawl logged-in surfaces or candidate-facing interview links
        disallow: [
          "/dashboard",
          "/inbox",
          "/jobs",
          "/candidates",
          "/reports",
          "/settings",
          "/admin",
          "/interview/",
          "/accept-invite",
          "/verify-email",
          "/reset-password",
          "/api/",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
