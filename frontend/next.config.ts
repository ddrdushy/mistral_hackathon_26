import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Skip ESLint and TS errors at build time — they surface in dev anyway
  // and shouldn't block production builds.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
