import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS, apiRewrites } from "../../next.config";

describe("next.config", () => {
  it("forwards /api to the backend only when one is set", () => {
    expect(apiRewrites(undefined)).toEqual([]);
    expect(apiRewrites("https://popsicle.up.railway.app/")).toEqual([
      { source: "/api/:path*", destination: "https://popsicle.up.railway.app/api/:path*" },
    ]);
  });

  it("uses BACKEND_ORIGIN from the environment", async () => {
    const before = process.env.BACKEND_ORIGIN;
    process.env.BACKEND_ORIGIN = "https://api.example";
    try {
      expect(await nextConfig.rewrites!()).toEqual(apiRewrites("https://api.example"));
    } finally {
      process.env.BACKEND_ORIGIN = before;
    }
  });

  it("sends security headers on every page", async () => {
    const headers = await nextConfig.headers!();
    expect(headers).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
    const byName = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byName["X-Frame-Options"]).toBe("DENY");
    expect(byName["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
