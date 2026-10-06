import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests build into their own folder so they don't disturb a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    // Company logos shown in Find people come from Hunter.
    remotePatterns: [new URL("https://logos.hunter.io/**")],
  },
};

export default nextConfig;
