import Link from "next/link";
import FadeIn from "./FadeIn";
import MarketingDoors from "./MarketingDoors";
import Nav from "./Nav";
import SiteFooter from "./SiteFooter";

type VerticalPageProps = {
  activeHref: string;
  eyebrow: string;
  title: string;
  intro: string;
  primaryCta: {
    href: string;
    label: string;
  };
  secondaryCta: {
    href: string;
    label: string;
  };
  pressureLabel: string;
  pressurePoints: string[];
  buildLabel: string;
  buildPoints: string[];
  fitLabel: string;
  fitPoints: string[];
  contactTitle: string;
  contactBody: string;
  contactHref: string;
};

export default function VerticalPage({
  activeHref,
  eyebrow,
  title,
  intro,
  primaryCta,
  secondaryCta,
  pressureLabel,
  pressurePoints,
  buildLabel,
  buildPoints,
  fitLabel,
  fitPoints,
  contactTitle,
  contactBody,
  contactHref,
}: VerticalPageProps) {
  return (
    <>
      <Nav />

      <main className="bg-[#f8f4ec] pt-24 text-black md:pt-32">
        <section className="px-6 pb-16 md:px-12 md:pb-24">
          <div className="mx-auto max-w-6xl">
            <FadeIn instant>
              <p className="text-[0.68rem] font-medium uppercase tracking-[0.22em] text-black/55">
                {eyebrow}
              </p>
              <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
                <div>
                  <h1 className="max-w-4xl font-display text-[clamp(3rem,8vw,6.8rem)] font-light leading-[0.98] tracking-[-0.04em]">
                    {title}
                  </h1>
                  <p className="mt-8 max-w-2xl text-[1.02rem] font-light leading-[1.9] text-black/68">
                    {intro}
                  </p>
                </div>

                <div className="border-l border-black/20 pl-6">
                  <p className="text-[0.62rem] font-medium uppercase tracking-[0.2em] text-black/40">
                    Route
                  </p>
                  <p className="mt-4 font-display text-[1.8rem] font-light leading-tight">
                    Three doors. One operating brain.
                  </p>
                </div>
              </div>

              <div className="mt-12 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link
                  href={primaryCta.href}
                  className="inline-flex items-center justify-center gap-3 bg-black px-8 py-4 text-[0.72rem] font-medium uppercase tracking-[0.14em] text-white transition-[opacity,transform] duration-200 hover:-translate-y-px hover:opacity-80"
                >
                  {primaryCta.label}
                  <span aria-hidden="true">↗</span>
                </Link>
                <Link
                  href={secondaryCta.href}
                  className="inline-flex items-center justify-center gap-3 border border-black px-8 py-4 text-[0.72rem] font-medium uppercase tracking-[0.14em] text-black transition-colors duration-200 hover:bg-black hover:text-white"
                >
                  {secondaryCta.label}
                </Link>
              </div>

              <div className="mt-14">
                <MarketingDoors activeHref={activeHref} />
              </div>
            </FadeIn>
          </div>
        </section>

        <div className="border-t border-black" />

        <section className="px-6 py-16 md:px-12 md:py-24">
          <div className="mx-auto max-w-6xl">
            <FadeIn>
              <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <div>
                  <p className="text-[0.62rem] font-medium uppercase tracking-[0.2em] text-black/40">
                    {pressureLabel}
                  </p>
                </div>

                <div className="grid gap-px border border-black bg-black md:grid-cols-3">
                  {pressurePoints.map((point) => (
                    <div key={point} className="bg-[#fffdf8] p-6">
                      <p className="text-[0.98rem] font-light leading-[1.8] text-black/68">
                        {point}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        <div className="border-t border-black" />

        <section className="px-6 py-16 md:px-12 md:py-24">
          <div className="mx-auto max-w-6xl">
            <FadeIn>
              <div className="grid gap-12 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <div>
                  <p className="text-[0.62rem] font-medium uppercase tracking-[0.2em] text-black/40">
                    {buildLabel}
                  </p>
                </div>

                <div className="space-y-5">
                  {buildPoints.map((point, index) => (
                    <div
                      key={point}
                      className="flex gap-5 border-t border-black/15 py-5 first:border-t first:pt-0"
                    >
                      <span className="w-8 shrink-0 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-black/30">
                        0{index + 1}
                      </span>
                      <p className="max-w-3xl font-display text-[clamp(1.35rem,3vw,2rem)] font-light leading-[1.3] tracking-[-0.02em]">
                        {point}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        <div className="border-t border-black" />

        <section className="px-6 py-16 md:px-12 md:py-24">
          <div className="mx-auto max-w-6xl">
            <FadeIn>
              <div className="grid gap-12 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <div>
                  <p className="text-[0.62rem] font-medium uppercase tracking-[0.2em] text-black/40">
                    {fitLabel}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {fitPoints.map((point) => (
                    <div
                      key={point}
                      className="border border-black/15 bg-white px-5 py-5 text-[0.95rem] font-light leading-[1.8] text-black/68"
                    >
                      {point}
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        <div className="border-t border-black" />

        <section id="contact" className="px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-6xl">
            <FadeIn>
              <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
                <div>
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.22em] text-black/55">
                    Contact
                  </p>
                  <h2 className="mt-6 max-w-2xl font-display text-[clamp(2.2rem,5vw,4rem)] font-light leading-[1.04] tracking-[-0.03em]">
                    {contactTitle}
                  </h2>
                  <p className="mt-6 max-w-xl text-[1rem] font-light leading-[1.9] text-black/68">
                    {contactBody}
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  <a
                    href={contactHref}
                    className="inline-flex items-center justify-center gap-3 bg-black px-8 py-4 text-[0.72rem] font-medium uppercase tracking-[0.14em] text-white transition-[opacity,transform] duration-200 hover:-translate-y-px hover:opacity-80"
                  >
                    Email Pedro
                    <span aria-hidden="true">↗</span>
                  </a>
                  <Link
                    href="/"
                    className="inline-flex items-center justify-center border border-black px-8 py-4 text-[0.72rem] font-medium uppercase tracking-[0.14em] text-black transition-colors duration-200 hover:bg-black hover:text-white"
                  >
                    View fitness route
                  </Link>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
