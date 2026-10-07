import { NextResponse, type NextRequest } from "next/server";

export const PROXY_HEADER = "x-popsicle-proxy";
export const CLIENT_IP_HEADER = "x-popsicle-client-ip";

/**
 * Runs on the frontend's server for every /api call before it's forwarded to the backend
 * (see next.config.ts). Deployed, the backend only accepts calls carrying PROXY_SECRET, and only
 * believes the visitor's address when it comes from here. Whatever a visitor sends in these
 * headers is replaced, so they can't be faked.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(PROXY_HEADER);
  headers.delete(CLIENT_IP_HEADER);
  const secret = process.env.PROXY_SECRET;
  if (secret) {
    headers.set(PROXY_HEADER, secret);
    // Set by the hosting platform (Vercel replaces anything the visitor sent).
    const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim();
    if (ip) headers.set(CLIENT_IP_HEADER, ip);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
