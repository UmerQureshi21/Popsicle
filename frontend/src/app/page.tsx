import Image from "next/image";
import { Inbox, Video, type LucideIcon } from "lucide-react";
import Link from "next/link";
import Reveal from "@/components/landing/Reveal";
import FeatureBeams from "@/components/landing/FeatureBeams";
import HeroVisual from "@/components/landing/HeroVisual";
import HowItWorks from "@/components/landing/HowItWorks";
import TemplateDemo from "@/components/landing/TemplateDemo";

const Chip = ({ children }: { children: string }) => <span className="placeholder-chip">{`{{${children}}}`}</span>;

const FEATURES: { image?: string; icon?: LucideIcon; title: string; text: React.ReactNode }[] = [
  {
    image: "/hunter-logo.png",
    title: "Find the right people",
    text: "Search any company by job title and location. People and their emails come from Hunter’s database.",
  },
  {
    image: "/curly-brace.png",
    title: "Introduce variables",
    text: (
      <>
        With different values per email. Drop in <Chip>first_name</Chip>, <Chip>company</Chip> or any detail you like, and
        every person gets a version that reads like you wrote it just for them.
      </>
    ),
  },
  {
    image: "/checkmark.png",
    title: "Never email twice",
    text: "Popsicle remembers everyone you’ve contacted and skips them automatically.",
  },
  {
    image: "/gmail-con.png",
    title: "Sent from your Gmail",
    text: "Emails go out from your own account, spaced out like a person would send them, or scheduled for the morning when people read.",
  },
  {
    icon: Inbox,
    title: "Every reply in one place",
    text: "Popsicle follows each conversation in your Gmail and shows who wrote back, so no reply gets buried.",
  },
  {
    icon: Video,
    title: "Coffee chat in one click",
    text: "When they say yes, pick a time. Popsicle creates the Google Meet, sends the calendar invite and replies with the link.",
  },
];

const REPO_URL = "https://github.com/UmerQureshi21/Popsicle";

/** GitHub's mark (lucide no longer ships brand icons). */
function GitHubMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="/compose"
      className="group inline-flex items-center gap-3 rounded-full bg-crimson px-10 py-5 text-lg font-semibold text-white shadow-[0_18px_40px_-12px_rgba(217,4,41,0.6)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-scarlet hover:shadow-[0_24px_50px_-12px_rgba(217,4,41,0.7)]"
    >
      {children}
      <svg className="size-5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></svg>
    </Link>
  );
}

export default function LandingPage() {
  return (
    <main className="relative overflow-hidden bg-paper">

      {/* Header */}
      <header className="animate-fade-in relative z-10 mx-auto flex max-w-[1600px] items-center justify-between px-10 pt-6 sm:px-14">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/cold-emailer-logo.png" alt="" width={40} height={36} priority />
          <span className="text-xl font-bold tracking-tight text-ink">Popsicle</span>
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-steel/30 bg-paper/70 px-6 py-2 text-sm font-semibold text-ink backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-lg"
        >
          Log in
        </Link>
      </header>

      {/* Hero: the pitch on the left, the pipeline in one picture on the right */}
      <section className="relative mx-auto grid min-h-[calc(100vh-88px)] max-w-[1600px] items-center gap-12 px-6 pt-10 pb-24 sm:px-14 lg:grid-cols-[1fr_1.1fr] lg:gap-6">
        <div className="relative z-10">
          <h1
            className="animate-fade-in text-[clamp(3rem,6.6vw,7rem)] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance text-ink"
            style={{ animationDelay: "200ms" }}
          >
            <span className="text-crimson">Pop</span> into their inbox
          </h1>
          <p className="animate-fade-in mt-7 max-w-xl text-lg leading-relaxed text-pretty text-ink/70" style={{ animationDelay: "500ms" }}>
            Find the emails of people you want to connect with, send them in one batch, track who replied, and book the coffee
            chat, all in one place.
          </p>
          <div className="animate-fade-in mt-10" style={{ animationDelay: "650ms" }}>
            <PrimaryButton>Get started</PrimaryButton>
          </div>
        </div>

        <HeroVisual />
      </section>

      <div className="h-32 bg-paper sm:h-40" />

      {/* How it works */}
      <section id="how" className="relative flex min-h-screen scroll-mt-10 flex-col justify-center bg-cloud px-6 py-32">
        <div className="mx-auto w-full max-w-7xl">
          <Reveal className="mb-14 text-center">
            <p className="text-sm font-semibold tracking-widest text-crimson uppercase">How it works</p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight text-balance text-ink sm:text-5xl">From first email to first call.</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-balance text-steel">Five steps from a company name to a coffee chat on your calendar.</p>
          </Reveal>

          <HowItWorks />
        </div>
      </section>

      {/* Step 3 demo */}
      <section className="relative flex min-h-screen flex-col justify-center px-6 py-32">
        <div className="mx-auto w-full max-w-7xl">
          <Reveal className="mb-14 text-center">
            <h2 className="text-4xl font-bold tracking-tight text-balance text-ink sm:text-5xl">Step 2 in action</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-balance text-steel">You write one template; each person gets their own version.</p>
          </Reveal>
          <Reveal delay={150}>
            <TemplateDemo />
          </Reveal>
        </div>
      </section>

      <div className="h-32 bg-paper sm:h-40" />

      {/* Features */}
      <section className="relative flex min-h-screen flex-col justify-center bg-cloud px-6 py-32">
        <div className="mx-auto w-full max-w-[1500px]">
          <FeatureBeams>
            <div className="grid auto-rows-fr gap-6 sm:grid-cols-2 sm:gap-x-16 sm:gap-y-14">
              {FEATURES.map(({ image, icon: Icon, title, text }, n) => {
                // A checkerboard: the dark cards sit diagonally from each other.
                const dark = n % 4 === 1 || n % 4 === 2;
                return (
                  <div key={title}>
                    <div
                      data-beam-card
                      className={`h-full min-h-[320px] rounded-[2rem] border p-10 shadow-sm ring-0 ring-crimson/20 transition-all duration-500 sm:p-12 hover:-translate-y-1 hover:shadow-[0_30px_60px_-30px_rgba(43,45,66,0.4)] data-lit:ring-2 data-lit:shadow-[0_30px_70px_-34px_rgba(217,4,41,0.55)] ${dark ? "border-night bg-night" : "border-paper bg-paper"}`}
                    >
                      {image ? (
                        <Image src={image} alt="" width={64} height={64} className={`size-16 object-contain ${dark ? "brightness-0 invert" : ""}`} />
                      ) : (
                        Icon && <Icon className={`size-16 ${dark ? "text-white" : "text-crimson"}`} strokeWidth={1.5} />
                      )}
                      <h3 className={`mt-7 text-2xl font-semibold tracking-tight text-balance ${dark ? "text-white" : "text-ink"}`}>{title}</h3>
                      <p className={`mt-3 text-lg leading-relaxed text-pretty ${dark ? "text-white/60" : "text-steel"}`}>{text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </FeatureBeams>
        </div>
      </section>

      <div className="h-32 bg-paper sm:h-40" />

      {/* Closing CTA */}
      <section className="px-6 pb-20">
        <Reveal>
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-night px-8 py-16 text-center shadow-2xl">
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
            <p className="relative mx-auto mt-3 max-w-md text-balance text-white/60">Write one email, reach ten people, and spend your time on the conversations that follow.</p>
            <div className="relative mt-8">
              <PrimaryButton>Get started</PrimaryButton>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3 border-t border-cloud px-6 py-8 text-sm text-steel">
        <span>© {new Date().getFullYear()} Popsicle</span>
        <span aria-hidden>·</span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Popsicle on GitHub"
          title="Popsicle on GitHub"
          className="inline-flex rounded-lg p-1 text-ink/60 transition-colors hover:bg-cloud hover:text-ink"
        >
          <GitHubMark className="size-5" />
        </a>
      </footer>
    </main>
  );
}
