import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Mail, ShieldCheck, Variable } from "lucide-react";
import Reveal from "@/components/landing/Reveal";
import TemplateDemo from "@/components/landing/TemplateDemo";

const FEATURES = [
  {
    icon: Variable,
    title: "Variables, not copy-paste",
    text: "Add a column for anything (name, role, team) and drop it into your email with one click.",
  },
  {
    icon: ShieldCheck,
    title: "Never email twice",
    text: "Popsicle remembers everyone you’ve contacted and skips them automatically.",
  },
  {
    icon: Mail,
    title: "Sent from your Gmail",
    text: "Emails go out from your own account, spaced out like a person would send them.",
  },
];

const POP_SHADOW = "drop-shadow(0 40px 45px rgba(43, 45, 66, 0.28))";

function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="/compose"
      className="group inline-flex items-center gap-2 rounded-2xl bg-crimson px-7 py-4 text-base font-semibold text-white shadow-[0_18px_40px_-12px_rgba(217,4,41,0.6)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-scarlet hover:shadow-[0_24px_50px_-12px_rgba(217,4,41,0.7)]"
    >
      {children}
      <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <main className="relative overflow-hidden bg-white">
      {/* Soft glows that pick up the popsicle colours */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px]">
        <div className="animate-glow absolute top-32 -left-32 size-[520px] rounded-full bg-[#5aa9ff]/25 blur-3xl" />
        <div className="animate-glow absolute top-40 -right-32 size-[520px] rounded-full bg-[#c58cff]/25 blur-3xl [animation-delay:-4s]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-white" />
      </div>

      {/* Header */}
      <header className="animate-fade-in relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 pt-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/cold-emailer-logo.png" alt="" width={40} height={36} priority />
          <span className="text-xl font-bold tracking-tight text-ink">Popsicle</span>
        </Link>
        <Link
          href="/compose"
          className="rounded-xl border border-steel/30 bg-white/70 px-5 py-2.5 text-sm font-semibold text-ink backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-lg"
        >
          Log in
        </Link>
      </header>

      {/* Hero */}
      <section className="relative mx-auto flex min-h-[calc(100vh-88px)] max-w-6xl flex-col items-center justify-center px-6 pt-10 pb-24 text-center">
        <div
          aria-hidden
          className="animate-pop-in absolute top-[18%] left-[-6%] hidden w-[clamp(200px,24vw,340px)] md:block"
          style={{ "--r": "-16deg", animationDelay: "250ms" } as React.CSSProperties}
        >
          <Image src="/left-pop.png" alt="" width={500} height={500} priority className="animate-float" style={{ filter: POP_SHADOW }} />
        </div>
        <div
          aria-hidden
          className="animate-pop-in absolute top-[24%] right-[-6%] hidden w-[clamp(200px,24vw,340px)] md:block"
          style={{ "--r": "14deg", animationDelay: "450ms" } as React.CSSProperties}
        >
          <Image
            src="/right-pop.png"
            alt=""
            width={500}
            height={500}
            priority
            className="animate-float [animation-delay:-3s]"
            style={{ filter: POP_SHADOW }}
          />
        </div>

        <div className="relative z-10 flex flex-col items-center">
          <span
            className="animate-fade-in mb-8 inline-flex items-center gap-2 rounded-full border border-cloud bg-white/80 px-4 py-1.5 text-sm font-medium text-ink/80 shadow-sm backdrop-blur"
            style={{ animationDelay: "100ms" }}
          >
            <span className="size-1.5 rounded-full bg-crimson" />
            Cold outreach, without the copy-paste
          </span>

          <h1
            className="animate-fade-in text-[clamp(4rem,13vw,9.5rem)] leading-[0.9] font-extrabold tracking-[-0.05em] text-ink"
            style={{ animationDelay: "200ms" }}
          >
            Popsicle
          </h1>

          <p
            className="animate-fade-in mt-6 text-[clamp(1.5rem,3.4vw,2.5rem)] font-semibold tracking-tight text-ink"
            style={{ animationDelay: "350ms" }}
          >
            Cold emails that <span className="whitespace-nowrap text-crimson">don’t feel cold.</span>
          </p>

          <p className="animate-fade-in mt-5 max-w-xl text-lg leading-relaxed text-balance text-steel" style={{ animationDelay: "500ms" }}>
            Write one email, add the people you want to reach, and Popsicle sends each of them a personal copy from your
            own Gmail.
          </p>

          <div className="animate-fade-in mt-10 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "650ms" }}>
            <PrimaryButton>Get started</PrimaryButton>
            <a
              href="#how"
              className="rounded-2xl px-6 py-4 text-base font-semibold text-ink transition-colors duration-300 hover:bg-cloud"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative mx-auto max-w-5xl scroll-mt-10 px-6 py-24">
        <Reveal className="mb-14 text-center">
          <p className="text-sm font-semibold tracking-widest text-crimson uppercase">How it works</p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-balance text-ink sm:text-5xl">One template. Every inbox personal.</h2>
        </Reveal>
        <Reveal delay={150}>
          <TemplateDemo />
        </Reveal>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <div className="grid gap-5 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }, n) => (
            <Reveal key={title} delay={n * 120}>
              <div className="h-full rounded-3xl border border-cloud bg-white p-7 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_60px_-30px_rgba(43,45,66,0.4)]">
                <span className="grid size-11 place-items-center rounded-2xl bg-crimson/10 text-crimson">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-ink">{title}</h3>
                <p className="mt-2 leading-relaxed text-pretty text-steel">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-6 pb-20">
        <Reveal>
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-ink px-8 py-16 text-center shadow-2xl">
            <Image
              src="/left-pop.png"
              alt=""
              width={500}
              height={500}
              aria-hidden
              className="pointer-events-none absolute -bottom-16 -left-10 w-56 -rotate-12 opacity-90 sm:w-64"
            />
            <Image
              src="/right-pop.png"
              alt=""
              width={500}
              height={500}
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-10 w-56 rotate-[200deg] opacity-90 sm:w-64"
            />
            <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">Ready to warm up your outreach?</h2>
            <p className="relative mx-auto mt-3 max-w-md text-balance text-white/60">Your next ten emails can take the time it takes to write one.</p>
            <div className="relative mt-8">
              <PrimaryButton>Get started</PrimaryButton>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-cloud py-8 text-center text-sm text-steel">© {new Date().getFullYear()} Popsicle</footer>
    </main>
  );
}
