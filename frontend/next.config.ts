import type { NextConfig } from "next";

/**
 * Deployed, the browser only ever talks to this site: /api/* is forwarded to the backend
 * (BACKEND_ORIGIN, e.g. https://popsicle.up.railway.app). Login cookies then belong to this
 * site, so browsers that block third-party cookies (Safari) still keep you logged in.
 * Locally BACKEND_ORIGIN is unset and the app calls http://localhost:8000 directly.
 */
export function apiRewrites(backendOrigin: string | undefined) {
  if (!backendOrigin) return [];
  return [{ source: "/api/:path*", destination: `${backendOrigin.replace(/\/$/, "")}/api/:path*` }];
}

export const SECURITY_HEADERS = [
  // No other site can show Popsicle inside a frame (to trick you into clicking things).
  { key: "X-Frame-Options", value: "DENY" },
  // No plugins, no hijacking relative links with a <base> tag, forms only post to Popsicle.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Links out (LinkedIn, Meet, Gmail) see only popsicle's address, never the page or person you were on.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The end-to-end tests build into their own folder so they don't disturb a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  images: {
    // Company logos shown in Find people come from Hunter.
    remotePatterns: [new URL("https://logos.hunter.io/**")],
  },
  async rewrites() {
    return apiRewrites(process.env.BACKEND_ORIGIN);
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
