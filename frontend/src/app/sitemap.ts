import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://hireops.symprio.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = [
    { path: "/", priority: 1.0, changeFreq: "weekly" as const },
    { path: "/pricing", priority: 0.9, changeFreq: "monthly" as const },
    { path: "/login", priority: 0.4, changeFreq: "yearly" as const },
    { path: "/signup", priority: 0.9, changeFreq: "yearly" as const },
    { path: "/legal/privacy", priority: 0.3, changeFreq: "yearly" as const },
    { path: "/legal/terms", priority: 0.3, changeFreq: "yearly" as const },
    { path: "/legal/cookies", priority: 0.3, changeFreq: "yearly" as const },
  ];
  return pages.map((p) => ({
    url: `${BASE}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFreq,
    priority: p.priority,
  }));
}
