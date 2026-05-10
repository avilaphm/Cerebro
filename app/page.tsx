import Link from "next/link";
import Nav from "./components/Nav";
import FadeIn from "./components/FadeIn";
import { AnimatedHero } from "@/components/ui/animated-hero";
import AuthHashRedirect from "./components/AuthHashRedirect";
import RealitySection from "./components/RealitySection";
import WhatChangesSection from "./components/WhatChangesSection";
import HowItWorksSection from "./components/HowItWorksSection";
import WhoItsForSection from "./components/WhoItsForSection";
import WhyCerebroSection from "./components/WhyCerebroSection";
import WhatHappensNextSection from "./components/WhatHappensNextSection";
import GetInTouchSection from "./components/GetInTouchSection";

export default function Home() {
  return (
    <>
      <AuthHashRedirect />
      <Nav />

      {/* 1. Hero */}
      <AnimatedHero />

      <div className="border-t border-black" />

      {/* 2. The Reality */}
      <RealitySection />

      <div className="border-t border-black" />

      {/* 3. What Changes */}
      <WhatChangesSection />

      <div className="border-t border-black" />

      {/* 4. How It Works */}
      <HowItWorksSection />

      <div className="border-t border-black" />

      {/* 5. Who It's For */}
      <WhoItsForSection />

      <div className="border-t border-black" />

      {/* 6. Why Cerebro */}
      <WhyCerebroSection />

      <div className="border-t border-black" />

      {/* 7. What Happens Next */}
      <WhatHappensNextSection />

      {/* 8. Start the Conversation (chatbot) */}
      <section id="start" className="border-t border-black py-20 md:py-[140px] px-6 md:px-12 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-6 md:mb-8">
              Free operations audit
            </p>
            <h2 className="font-display text-[clamp(2rem,5vw,4rem)] font-light tracking-[-0.025em] text-black mb-4 md:mb-5 max-w-[640px]">
              Tell us where the friction is.
            </h2>
            <p className="text-sm font-light text-black mb-8 md:mb-14 leading-relaxed max-w-[460px]">
              Two minutes. We send your personalized picture in five.
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
        <div className="flex items-center gap-5">
          <Link href="/privacy" className="text-[0.6rem] font-light text-black/25 hover:text-black/50 transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="text-[0.6rem] font-light text-black/25 hover:text-black/50 transition-colors">
            Terms
          </Link>
          <span className="text-xs font-light text-black/30">
            &copy; 2026 Cerebro
          </span>
        </div>
      </footer>
    </>
  );
}
