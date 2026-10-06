import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { navigation, resetNavigation } from "./navigation";
import { server } from "./server";

// Node 25 has its own global localStorage (unusable without --localstorage-file) that hides
// jsdom's. Use jsdom's, so storage works and Storage.prototype can be spied on.
const { window: dom } = (globalThis as unknown as { jsdom: { window: Window } }).jsdom;
for (const key of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, key, { value: dom[key], configurable: true });
}

// The backend is faked at the network level, so lib/api.ts runs for real. Any request a test
// didn't set up a handler for fails the test.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  resetNavigation();
  window.history.replaceState(null, "", "/");
});
afterAll(() => server.close());

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  usePathname: () => navigation.pathname,
}));

// next/image needs Next's image loader; a plain <img> is enough here.
vi.mock("next/image", () => ({
  default: ({ priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority;
    return createElement("img", props);
  },
}));

// jsdom doesn't lay anything out.
Element.prototype.scrollIntoView = () => {};
