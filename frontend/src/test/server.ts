import { http, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { API_URL } from "@/lib/api";

export const server = setupServer();

type Method = "get" | "post" | "put" | "patch" | "delete";

/** A request the fake backend received. */
export type Call = { method: string; path: string; url: URL; body: unknown };

/**
 * Answer one API route: `api("get", "/api/stats", {...})`. The response can be a function of the
 * request body and URL. Returns the list of calls made to that route.
 */
export function api(
  method: Method,
  path: string,
  response: JsonBodyType | ((call: Call) => JsonBodyType | Response | Promise<JsonBodyType | Response>) = null,
  status = 200,
): Call[] {
  const calls: Call[] = [];
  server.use(
    http[method](API_URL + path, async ({ request }) => {
      const url = new URL(request.url);
      const text = method === "get" || method === "delete" ? "" : await request.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {}
      const call = { method: request.method, path: url.pathname, url, body };
      calls.push(call);
      const res = typeof response === "function" ? await response(call) : response;
      if (res instanceof Response) return res;
      if (status === 204) return new HttpResponse(null, { status });
      return HttpResponse.json(res, { status });
    }),
  );
  return calls;
}

/** An error response in FastAPI's shape. */
export function apiError(method: Method, path: string, status: number, detail: unknown = "Something went wrong") {
  return api(method, path, { detail }, status);
}

/** Answers that most pages ask for on load and tests rarely care about. */
export function quietDefaults() {
  api("get", "/api/people-search/status", { configured: true, credits_remaining: 40, credits_total: 50, reset_date: "2026-11-02" });
  api("get", "/api/companies", []);
  api("get", "/api/templates", []);
  api("get", "/api/gmail/status", { connected: true, email: "me@gmail.com", credentials_file_present: true });
}
