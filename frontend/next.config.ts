import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Company logos shown in Find people come from Hunter.
    remotePatterns: [new URL("https://logos.hunter.io/**")],
  },
};

export default nextConfig;
