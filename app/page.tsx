import type { Metadata } from "next";
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
import SiteFooter from "./components/SiteFooter";

export const metadata: Metadata = {
  title: "Fitness Operations Systems",
  description:
    "Automation systems for gyms, studios, and PTs in Australia and New Zealand. Lead replies, billing recovery, retention flags, and admin clarity without replacing your stack.",
};

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
      <SiteFooter />
    </>
  );
}
