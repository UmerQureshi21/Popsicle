import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth";
import { hunterStatus } from "@/test/fixtures";
import { navigation } from "@/test/navigation";
import { api } from "@/test/server";
import Nav from "./Nav";

function renderNav(user: { email: string; name: string | null } | null = null) {
  api("get", "/api/auth/me", { user, auth_required: false });
  return render(
    <AuthProvider>
      <Nav />
    </AuthProvider>,
  );
}

describe("Nav", () => {
  it.each(["/", "/login", "/book/k3J9abc"])("is hidden on %s", (path) => {
    navigation.pathname = path;
    api("get", "/api/people-search/status", hunterStatus());
    const { container } = renderNav();
    expect(container.querySelector("nav")).toBeNull();
  });

  it("highlights the current tab", async () => {
    navigation.pathname = "/find";
    api("get", "/api/people-search/status", hunterStatus());
    renderNav();
    const main = await screen.findByRole("navigation", { name: "Main" });
    expect(within(main).getByRole("link", { name: "Find people" }).className).toContain("bg-night");
    expect(within(main).getByRole("link", { name: "Compose" }).className).not.toContain("bg-night");
    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getByRole("link", { name: "Find" })).toHaveAttribute("aria-current", "page");
  });

  it("shows Hunter credits left, in red when low", async () => {
    api("get", "/api/people-search/status", hunterStatus({ credits_remaining: 3 }));
    renderNav();
    const pill = await screen.findByRole("link", { name: "Hunter credits left this month: 3 of 50 · resets Nov 2" });
    expect(pill.className).toContain("text-crimson");
  });

  it("credits without a total or reset date", async () => {
    api("get", "/api/people-search/status", hunterStatus({ credits_total: null, reset_date: null }));
    renderNav();
    const pill = await screen.findByRole("link", { name: "Hunter credits left this month: 40" });
    expect(pill.className).not.toContain("text-crimson");
  });

  it("hides credits when Hunter isn't set up", async () => {
    const calls = api("get", "/api/people-search/status", hunterStatus({ configured: false }));
    renderNav();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole("link", { name: /credits/ })).not.toBeInTheDocument();
  });

  it("shows who's logged in and logs out", async () => {
    api("get", "/api/people-search/status", hunterStatus());
    const logout = api("post", "/api/auth/logout", null, 204);
    renderNav({ email: "me@x.com", name: "Me Myself" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Account" }));
    expect(screen.getByText("me@x.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Log out/ }));
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/login"));
    expect(logout).toHaveLength(1);
  });

  it("has no account menu when nobody is logged in", async () => {
    api("get", "/api/people-search/status", hunterStatus());
    renderNav();
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
  });
});
