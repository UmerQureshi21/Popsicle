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
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-cloud px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden items-center justify-center gap-10 lg:flex">
        <Image src="/left-pop.png" alt="" width={500} height={500} priority className="animate-float h-auto w-64 -rotate-12 opacity-90" />
        <div className="w-[28rem] shrink-0" />
        <Image
          src="/right-pop.png"
          alt=""
          width={500}
          height={500}
          priority
          className="animate-float h-auto w-64 rotate-12 opacity-90 [animation-delay:-3s]"
        />
      </div>
      {mounted && <LoginCard />}
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
    <div className="animate-fade-up relative w-full max-w-md">
      <Link href="/" className="mb-8 flex items-center justify-center gap-3">
        <Image src="/cold-emailer-logo.png" alt="" width={48} height={43} priority />
        <span className="text-3xl font-extrabold tracking-tight text-ink">Popsicle</span>
      </Link>

      <div className="rounded-[28px] border border-white/60 bg-white/70 p-2 shadow-[0_40px_100px_-30px_rgba(43,45,66,0.45)] backdrop-blur-2xl">
        <div className="rounded-[22px] bg-white px-6 pt-6 pb-7 sm:px-8">
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

          <h1 className="mt-6 text-xl font-semibold text-ink">{mode === "login" ? "Welcome back" : "Set up your account"}</h1>
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

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-steel">
            <Lock className="size-3.5" /> Accounts are by invitation only
          </p>
        </div>
      </div>

      {me && !me.auth_required && (
        <p className="mt-5 text-center text-sm text-steel">
          Running locally, so login is optional.{" "}
          <Link href="/compose" className="font-medium text-ink underline-offset-2 hover:underline">
            Continue without logging in
          </Link>
        </p>
      )}
    </div>
  );
}
