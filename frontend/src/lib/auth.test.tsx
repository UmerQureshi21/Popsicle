import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { navigation } from "@/test/navigation";
import { api, apiError } from "@/test/server";
import { UNAUTHORIZED_EVENT } from "./api";
import { AuthProvider, useAuth } from "./auth";

function Who() {
  const { me, setUser, logout } = useAuth();
  return (
    <div>
      <p>user: {me?.user?.email ?? "none"}</p>
      <button onClick={() => setUser({ email: "new@x.com", name: null })}>set</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

const renderApp = () =>
  render(
    <AuthProvider>
      <Who />
    </AuthProvider>,
  );

describe("AuthProvider", () => {
  it("shows the app locally without logging in", async () => {
    api("get", "/api/auth/me", { user: null, auth_required: false });
    renderApp();
    expect(await screen.findByText("user: none")).toBeInTheDocument();
    expect(navigation.router.replace).not.toHaveBeenCalled();
  });

  it("hides app pages and sends visitors to log in when login is required", async () => {
    navigation.pathname = "/find";
    api("get", "/api/auth/me", { user: null, auth_required: true });
    renderApp();
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/login?next=%2Ffind"));
    expect(screen.queryByText(/user:/)).not.toBeInTheDocument();
  });

  it("shows public pages while logged out", async () => {
    navigation.pathname = "/login";
    api("get", "/api/auth/me", { user: null, auth_required: true });
    renderApp();
    expect(screen.getByText("user: none")).toBeInTheDocument();
    await waitFor(() => expect(navigation.router.replace).not.toHaveBeenCalled());
  });

  it("booking links work without logging in", async () => {
    navigation.pathname = "/book/k3J9abc";
    api("get", "/api/auth/me", { user: null, auth_required: true });
    renderApp();
    expect(screen.getByText("user: none")).toBeInTheDocument();
    await waitFor(() => expect(navigation.router.replace).not.toHaveBeenCalled());
  });

  it("shows the logged-in user", async () => {
    api("get", "/api/auth/me", { user: { email: "me@x.com", name: "Me" }, auth_required: true });
    renderApp();
    expect(await screen.findByText("user: me@x.com")).toBeInTheDocument();
  });

  it("treats a failed check as running locally", async () => {
    apiError("get", "/api/auth/me", 500);
    renderApp();
    expect(await screen.findByText("user: none")).toBeInTheDocument();
  });

  it("sends you to log in when a session expires mid-use", async () => {
    api("get", "/api/auth/me", { user: { email: "me@x.com", name: null }, auth_required: true });
    renderApp();
    await screen.findByText("user: me@x.com");
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/login?next=%2Fcompose"));
  });

  it("setUser and logout", async () => {
    api("get", "/api/auth/me", { user: null, auth_required: false });
    const logout = api("post", "/api/auth/logout", null, 204);
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByText("set"));
    expect(screen.getByText("user: new@x.com")).toBeInTheDocument();
    await user.click(screen.getByText("logout"));
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/login"));
    expect(logout).toHaveLength(1);
    expect(screen.getByText("user: none")).toBeInTheDocument();
  });

  it("logs out locally even if the request fails", async () => {
    api("get", "/api/auth/me", { user: { email: "me@x.com", name: null }, auth_required: false });
    apiError("post", "/api/auth/logout", 500);
    renderApp();
    await userEvent.setup().click(await screen.findByText("logout"));
    await waitFor(() => expect(screen.getByText("user: none")).toBeInTheDocument());
  });
});

it("useAuth outside the provider has harmless defaults", async () => {
  render(<Who />);
  await userEvent.setup().click(screen.getByText("set"));
  await userEvent.setup().click(screen.getByText("logout"));
  expect(screen.getByText("user: none")).toBeInTheDocument();
});
