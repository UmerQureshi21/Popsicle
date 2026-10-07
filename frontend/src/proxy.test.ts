import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { CLIENT_IP_HEADER, PROXY_HEADER, config, proxy } from "./proxy";

// NextResponse.next({ request: { headers } }) passes the new request headers on as x-middleware-request-*.
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

function call(headers: Record<string, string> = {}) {
  return proxy(new NextRequest("https://popsicle.vercel.app/api/companies", { headers }));
}

describe("proxy", () => {
  afterEach(() => {
    delete process.env.PROXY_SECRET;
  });

  it("only runs for API calls", () => {
    expect(config.matcher).toBe("/api/:path*");
  });

  it("adds the shared secret and the visitor's address", () => {
    process.env.PROXY_SECRET = "s".repeat(40);
    const res = call({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" });
    expect(forwarded(res, PROXY_HEADER)).toBe("s".repeat(40));
    expect(forwarded(res, CLIENT_IP_HEADER)).toBe("1.2.3.4");
  });

  it("falls back to the first forwarded address", () => {
    process.env.PROXY_SECRET = "s".repeat(40);
    expect(forwarded(call({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }), CLIENT_IP_HEADER)).toBe("5.6.7.8");
    expect(forwarded(call(), CLIENT_IP_HEADER)).toBeNull();
  });

  it("replaces anything a visitor sends in those headers", () => {
    process.env.PROXY_SECRET = "s".repeat(40);
    const res = call({ [PROXY_HEADER]: "fake", [CLIENT_IP_HEADER]: "6.6.6.6", "x-real-ip": "1.2.3.4" });
    expect(forwarded(res, PROXY_HEADER)).toBe("s".repeat(40));
    expect(forwarded(res, CLIENT_IP_HEADER)).toBe("1.2.3.4");
  });

  it("without a secret (locally) adds nothing and strips fakes", () => {
    const res = call({ [PROXY_HEADER]: "fake", [CLIENT_IP_HEADER]: "6.6.6.6" });
    expect(forwarded(res, PROXY_HEADER)).toBeNull();
    expect(forwarded(res, CLIENT_IP_HEADER)).toBeNull();
  });
});
