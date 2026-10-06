"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowRight, Loader2, Lock } from "lucide-react";
import { api, type AuthUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const subscribe = () => () => {};

/** Where to go after logging in: ?next=/find, but only paths inside this app. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && next !== "/login" ? next : "/compose";
}

export default function LoginPage() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-2">
      {/* Left half: the form */}
      <section className="flex items-center justify-center px-6 py-12 sm:px-10">{mounted && <LoginCard />}</section>

      {/* Right half: just the popsicle (hidden on phones so the form gets the screen) */}
      <section aria-hidden className="hidden lg:block">
        <div className="relative grid h-full place-items-center overflow-hidden bg-gradient-to-br from-[#d6ebff] via-[#eaf4ff] to-cloud">
          <div className="absolute size-[60%] rounded-full bg-[#5aa9ff]/30 blur-3xl" />
          <div className="animate-pop-in relative w-[min(26rem,62%)]" style={{ "--r": "-14deg", animationDelay: "200ms" } as React.CSSProperties}>
            <Image
              src="/left-pop.png"
              alt=""
              width={500}
              height={500}
              priority
              className="h-auto w-full"
              style={{ filter: "drop-shadow(0 50px 60px rgba(43, 45, 66, 0.3))" }}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function LoginCard() {
  const router = useRouter();
  const { me, setUser } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in: skip this page.
  useEffect(() => {
    if (me?.user) router.replace(nextPath());
  }, [me, router]);

  const submit = async () => {
    setError(null);
    if (mode === "signup" && password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const user = await api.post<AuthUser>(`/api/auth/${mode}`, { email, password });
      setUser(user);
      router.replace(nextPath());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const switchMode = (m: "login" | "signup") => {
    setMode(m);
    setError(null);
    setConfirm("");
  };

  const input =
    "mt-1.5 w-full rounded-xl border border-steel/30 bg-white px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-steel/60 focus:border-scarlet focus:ring-4 focus:ring-scarlet/10";

  return (
    <div className="animate-fade-up w-full max-w-sm">
      <Link href="/" className="mb-10 inline-flex items-center gap-2.5">
        <Image src="/cold-emailer-logo.png" alt="" width={40} height={36} priority />
        <span className="text-2xl font-extrabold tracking-tight text-ink">Popsicle</span>
      </Link>

      <div>
        <div>
          <div className="grid grid-cols-2 rounded-xl bg-cloud p-1 text-sm font-medium" role="tablist">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`rounded-lg py-2 transition-all ${mode === m ? "bg-white text-ink shadow-sm" : "text-steel hover:text-ink"}`}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <h1 className="mt-8 text-3xl font-bold tracking-tight text-ink">{mode === "login" ? "Welcome back" : "Set up your account"}</h1>
          <p className="mt-1 text-sm text-steel">
            {mode === "login"
              ? "Log in to write and send your emails."
              : "Popsicle is invite-only. If you've been invited, choose a password for your email."}
          </p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="block">
              <span className="text-sm font-medium text-ink">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={input}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Password</span>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 8 characters" : ""}
                className={input}
              />
            </label>
            {mode === "signup" && (
              <label className="block">
                <span className="text-sm font-medium text-ink">Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={input}
                />
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-crimson/5 px-3.5 py-2.5 text-sm text-crimson">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-crimson py-3 text-sm font-semibold text-white shadow-[0_14px_30px_-12px_rgba(217,4,41,0.6)] transition-all hover:bg-scarlet disabled:bg-steel/60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "login" ? "Log in" : "Create account"}
              {!busy && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
            </button>
          </form>

          <p className="mt-6 flex items-center gap-1.5 text-xs text-steel">
            <Lock className="size-3.5" /> Accounts are by invitation only
          </p>
        </div>
      </div>

      {me && !me.auth_required && (
        <p className="mt-8 text-sm text-steel">
          Running locally, so login is optional.{" "}
          <Link href="/compose" className="font-medium text-ink underline-offset-2 hover:underline">
            Continue without logging in
          </Link>
        </p>
      )}
    </div>
  );
}
