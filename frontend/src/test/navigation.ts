import { vi } from "vitest";

/** What next/navigation returns in tests: set `navigation.pathname`, check `navigation.router.push`. */
export const navigation = {
  pathname: "/compose",
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
};

export function resetNavigation() {
  navigation.pathname = "/compose";
  Object.values(navigation.router).forEach((fn) => fn.mockReset());
}
