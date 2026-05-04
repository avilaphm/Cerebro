import Nav from "./components/Nav";
import FadeIn from "./components/FadeIn";
import { AnimatedHero } from "@/components/ui/animated-hero";
import GetInTouchSection from "./components/GetInTouchSection";

export default function Home() {
  return (
    <>
      <Nav />

      {/* Hero */}
      <AnimatedHero />

      <div className="border-t border-black" />

      {/* The Shift */}
      <section className="py-[140px] px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="max-w-[700px]">
              <p className="font-display text-[clamp(1.4rem,3.2vw,2rem)] font-light leading-[1.65] text-black italic">
                "Every business has a version of the same problem.
                The work that actually grows your business keeps getting pushed
                to tomorrow. Because today is full of the stuff that just needs
                to get done."
              </p>
              <p className="text-[clamp(0.95rem,1.8vw,1.1rem)] font-light leading-[1.8] text-black/60 max-w-[540px] mt-8">
                Invoices. Follow-ups. Onboarding. Reports. Scheduling.
                None of it is hard. All of it takes time. And it never stops.
                What if it just&hellip; happened?
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      <div className="border-t border-black" />

      {/* What Changes */}
      <section className="py-[140px] px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-16">
              What changes
            </p>
            <ul>
              {[
                "Clients get onboarded without you lifting a finger.",
                "Follow-ups happen at the right time, in the right tone.",
                "Reports compile themselves.",
                "Your week gets lighter without your service getting worse.",
              ].map((outcome, i) => (
                <li
                  key={outcome}
                  className="flex items-start gap-8 py-8 border-t border-black group cursor-default"
                >
                  <span className="text-[0.65rem] font-medium text-black/30 tracking-[0.1em] w-6 shrink-0 mt-[0.4rem] tabular-nums">
                    0{i + 1}
                  </span>
                  <span className="text-[clamp(1.05rem,2.2vw,1.3rem)] font-light leading-snug text-black/50 group-hover:text-black transition-colors duration-300">
                    {outcome}
                  </span>
                </li>
              ))}
              <li className="border-t border-black" aria-hidden="true" />
            </ul>
          </FadeIn>
        </div>
      </section>

      <div className="border-t border-black" />

      {/* How It Works */}
      <section className="py-[140px] px-6 md:px-12">
        <div className="w-full max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-20">
              How it works
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
              {[
                {
                  n: "01",
                  title: "We talk",
                  body: "You tell us what's eating your time. We listen, ask the right questions, and find exactly where the hours are going.",
                },
                {
                  n: "02",
                  title: "We build",
                  body: "Custom systems, tailored to how your business actually runs. No off-the-shelf templates.",
                },
                {
                  n: "03",
                  title: "It runs",
                  body: "You get the time back. We stay on call. The systems keep working whether you're in the office or not.",
                },
              ].map((step, i) => (
                <div
                  key={step.n}
                  className={`py-10 ${
                    i < 2
                      ? "md:pr-12 md:border-r md:border-black border-b border-black md:border-b-0"
                      : ""
                  } ${i > 0 ? "md:pl-12" : ""}`}
                >
                  <p className="font-display text-[4rem] font-light text-black/08 leading-none mb-8 tracking-[-0.02em] select-none" style={{ color: "rgba(0,0,0,0.07)" }}>
                    {step.n}
                  </p>
                  <h3 className="font-display text-xl font-medium tracking-[-0.01em] mb-4 text-black">
                    {step.title}
                  </h3>
                  <p className="text-sm font-light text-black/60 leading-relaxed">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <div className="border-t border-black" />

      {/* About */}
      <section className="py-[140px] px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-10">
              Why Cerebro
            </p>
            <p className="text-[1.05rem] font-light text-black/60 leading-[1.9] max-w-[560px]">
              I ran service businesses for 10 years before I started building
              these systems. Not because I studied automation. Because I was
              drowning in admin and knew there had to be a better way.
              I built the systems for my own business first. Then I started
              building them for others.{" "}
              <span className="text-black">
                Cerebro exists because every business owner deserves to spend
                their day on the work they actually care about. Not the work
                that just needs to get done.
              </span>
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Get in Touch Section */}
      <section id="get-in-touch" className="border-t border-black py-[140px] px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-8">
              Get in touch
            </p>
            <h2 className="font-display text-[clamp(2.2rem,5vw,4rem)] font-light tracking-[-0.025em] text-black mb-5 max-w-[640px]">
              Ready to get your time back?
            </h2>
            <p className="text-sm font-light text-black mb-14 leading-relaxed max-w-[420px]">
              One conversation is all it takes to see where the hours are going.
            </p>
            <GetInTouchSection />
          </FadeIn>
        </div>
      </section>

      {/* Footer */}
      <footer className="flex items-center justify-between px-6 md:px-12 py-8 border-t border-black">
        <span className="font-display text-sm font-medium tracking-[0.1em] uppercase text-black">
          Cerebro
        </span>
        <span className="text-xs font-light text-black/30">
          &copy; 2026 Cerebro
        </span>
      </footer>
    </>
  );
}
