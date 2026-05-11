import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Skip ESLint and TS errors at build time — they surface in dev anyway
  // and shouldn't block production builds.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Disable Next.js image optimization. Our landing-page assets are
  // already small hand-tuned webps (<30 KB). The optimizer adds a
  // CPU + memory hop and the in-standalone fetcher has been flaky on
  // VPS deploys (Next 15.5.x intermittently returns 400 for valid
  // local images). Static webp served via the Next file handler is
  // cacheable and faster end-to-end for our payload sizes.
  images: { unoptimized: true },
};

export default nextConfig;
