import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api as fake } from "@/test/server";
import { ApiError, UNAUTHORIZED_EVENT, api } from "./api";

describe("api", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs JSON with the session cookie", async () => {
    const calls = fake("get", "/api/stats", { sent_total: 3 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await api.get("/api/stats")).toEqual({ sent_total: 3 });
    expect(calls).toHaveLength(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "include", body: undefined, headers: undefined });
  });

  it("sends JSON bodies for POST, PUT and PATCH", async () => {
    const post = fake("post", "/api/x", { ok: 1 });
    const put = fake("put", "/api/x", { ok: 2 });
    const patch = fake("patch", "/api/x", { ok: 3 });
    expect(await api.post("/api/x", { a: 1 })).toEqual({ ok: 1 });
    expect(await api.put("/api/x", { b: 2 })).toEqual({ ok: 2 });
    expect(await api.patch("/api/x", { c: 3 })).toEqual({ ok: 3 });
    expect([post[0].body, put[0].body, patch[0].body]).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("sends FormData as-is, without a JSON content type", async () => {
    // jsdom's FormData can't go through Node's fetch, so answer it directly.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: 1 }));
    const form = new FormData();
    form.append("file", new Blob(["hi"]), "a.txt");
    expect(await api.post("/api/attachments", form)).toEqual({ id: 1 });
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ body: form, headers: undefined });
  });

  it("returns nothing for 204 responses", async () => {
    fake("delete", "/api/templates/1", null, 204);
    expect(await api.del("/api/templates/1")).toBeUndefined();
  });

  it("throws ApiError with FastAPI's detail message", async () => {
    fake("post", "/api/x", { detail: "Nope" }, 409);
    const err = await api.post("/api/x").catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("Nope");
  });

  it("turns validation error lists into text", async () => {
    fake("post", "/api/x", { detail: [{ msg: "bad" }] }, 422);
    await expect(api.post("/api/x")).rejects.toThrow('[{"msg":"bad"}]');
  });

  it("falls back to the status text when the error body isn't JSON", async () => {
    fake("get", "/api/x", () => new HttpResponse("oops", { status: 500, statusText: "Server Error" }));
    await expect(api.get("/api/x")).rejects.toThrow("Server Error");
  });

  it("announces a 401 so the app can go to the login page, except from auth calls", async () => {
    const heard = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, heard);
    fake("get", "/api/stats", { detail: "Log in" }, 401);
    fake("get", "/api/auth/me", { detail: "Log in" }, 401);
    await expect(api.get("/api/stats")).rejects.toThrow("Log in");
    await expect(api.get("/api/auth/me")).rejects.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, heard);
  });
});
