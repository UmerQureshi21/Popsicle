"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { UNAUTHORIZED_EVENT, api, type AuthUser, type Me } from "./api";

type AuthState = {
  /** null until the first check finishes */
  me: Me | null;
  setUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({ me: null, setUser: () => {}, logout: async () => {} });

export const useAuth = () => useContext(AuthContext);

/** Pages anyone can see without logging in: the landing page, login, and booking links. */
const PUBLIC_ROUTES = ["/", "/login"];
export const isPublicRoute = (pathname: string) => PUBLIC_ROUTES.includes(pathname) || pathname.startsWith("/book/");

/**
 * Knows who's logged in, and sends visitors to /login when the backend requires it
 * (AUTH_REQUIRED=true when deployed). Locally the app stays open.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api.get<Me>("/api/auth/me").then(setMe, () => setMe({ user: null, auth_required: false }));
    // A session that expires mid-use: any 401 means we're logged out, which triggers the redirect below.
    const onUnauthorized = () => setMe({ auth_required: true, user: null });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const isPublic = isPublicRoute(pathname);
  const blocked = !!me && me.auth_required && !me.user && !isPublic;

  useEffect(() => {
    if (blocked) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [blocked, pathname, router]);

  const setUser = useCallback((user: AuthUser | null) => setMe((m) => ({ auth_required: m?.auth_required ?? false, user })), []);

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setUser(null);
    router.replace("/login");
  }, [router, setUser]);

  // While login is required, don't flash app pages before the check (or redirect) completes.
  const hide = !isPublic && (me === null || blocked);

  return <AuthContext.Provider value={{ me, setUser, logout }}>{hide ? null : children}</AuthContext.Provider>;
}
