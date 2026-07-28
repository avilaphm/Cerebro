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
  title: "Embedded AI Systems Partner",
  description:
    "Cerebro works inside expert-led businesses to find where output is getting stuck, then builds bespoke systems around the way the team already works.",
};

export default function Home() {
  return (
    <>
      <AuthHashRedirect />
      <Nav />

      <AnimatedHero />

      <div className="border-t border-black" />

      <RealitySection />

      <div className="border-t border-black" />

      <WhatChangesSection />

      <div className="border-t border-black" />

      <HowItWorksSection />

      <div className="border-t border-black" />

      <WhoItsForSection />

      <div className="border-t border-black" />

      <WhyCerebroSection />

      <div className="border-t border-black" />

      <WhatHappensNextSection />

      <section id="start" className="border-t border-black py-20 md:py-[140px] px-6 md:px-12 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-6 md:mb-8">
              Business diagnostic
            </p>
            <h2 className="font-display text-[clamp(2rem,5vw,4rem)] font-light tracking-[-0.025em] text-black mb-4 md:mb-5 max-w-[640px]">
              Tell me where output is getting stuck.
            </h2>
            <p className="text-sm font-light text-black mb-8 md:mb-14 leading-relaxed max-w-[460px]">
              Two minutes. You will get a tailored starting point in your inbox
              within the hour.
            </p>
            <GetInTouchSection />
          </FadeIn>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
