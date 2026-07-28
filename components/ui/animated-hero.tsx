"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import CerebroMark from "@/components/brand/CerebroMark";

function AnimatedHero() {
  const [titleNumber, setTitleNumber] = useState(0);
  const titles = useMemo(
    () => [
      "rebuild reports.",
      "clean spreadsheets.",
      "hunt for answers.",
      "repeat the process.",
      "hire just to grow.",
    ],
    []
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setTitleNumber((prev) => (prev === titles.length - 1 ? 0 : prev + 1));
    }, 2200);
    return () => clearTimeout(timeoutId);
  }, [titleNumber, titles]);

  return (
    <div className="relative flex min-h-[100svh] w-full items-end overflow-hidden px-6 pb-12 pt-36 md:px-12 md:pb-16 md:pt-44">
      <CerebroMark className="pointer-events-none absolute -right-10 top-24 hidden h-auto w-[19rem] text-black/[0.055] lg:block" />

      <div className="relative mx-auto w-full max-w-6xl">
        <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-10">
          Embedded AI systems partner · Sydney
        </p>

        <h1 className="font-display text-[clamp(2.8rem,8vw,7rem)] font-light leading-[1.02] tracking-[-0.025em] max-w-[980px] mb-6 text-black">
          Your best people shouldn&apos;t{" "}
          <span className="relative inline-flex justify-start overflow-hidden h-[2.15em] sm:h-[1.15em] align-bottom w-full">
            {titles.map((title, index) => (
              <motion.em
                key={index}
                className="absolute left-0 font-display font-light not-italic"
                style={{ fontStyle: "italic" }}
                initial={{ opacity: 0, y: 60 }}
                transition={{ type: "spring", stiffness: 60, damping: 18 }}
                animate={
                  titleNumber === index
                    ? { y: 0, opacity: 1 }
                    : {
                        y: titleNumber > index ? -60 : 60,
                        opacity: 0,
                      }
                }
              >
                {title}
              </motion.em>
            ))}
          </span>
        </h1>

        <p className="mt-8 max-w-[580px] text-[clamp(1rem,1.8vw,1.15rem)] font-light leading-[1.7] text-black/65 md:mt-10">
          Cerebro works inside your business to find where output is getting
          stuck, then builds the system around the way your team already works.
        </p>

        <div className="mt-10 flex flex-col items-start gap-6 sm:flex-row sm:items-center md:mt-12">
          <a
            href="#start"
            className="inline-flex items-center gap-3 text-[0.7rem] font-medium tracking-[0.12em] uppercase text-white bg-black px-8 py-4 no-underline transition-[opacity,transform] duration-200 hover:opacity-75 hover:-translate-y-px shrink-0"
          >
            Map the bottleneck
            <span aria-hidden="true">→</span>
          </a>
          <p className="max-w-[330px] text-sm font-light leading-relaxed text-black/55">
            Built inside your business. Not dropped on top of it.
          </p>
        </div>

        <dl className="mt-12 grid max-w-[920px] grid-cols-1 border-y border-black/20 sm:grid-cols-3 md:mt-14">
          <div className="flex items-baseline justify-between gap-6 py-4 sm:block sm:border-r sm:border-black/20 sm:px-6 sm:first:pl-0">
            <dt className="text-[0.58rem] font-medium uppercase tracking-[0.18em] text-black/35">
              Focus
            </dt>
            <dd className="mt-1 text-sm font-light text-black">
              One priority system
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-6 border-t border-black/20 py-4 sm:block sm:border-r sm:border-t-0 sm:border-black/20 sm:px-6">
            <dt className="text-[0.58rem] font-medium uppercase tracking-[0.18em] text-black/35">
              Cadence
            </dt>
            <dd className="mt-1 text-sm font-light text-black">
              2 × 4 hours each week
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-6 border-t border-black/20 py-4 sm:block sm:border-t-0 sm:pl-6">
            <dt className="text-[0.58rem] font-medium uppercase tracking-[0.18em] text-black/35">
              Payback target
            </dt>
            <dd className="mt-1 text-sm font-light text-black">
              Within the first 60 days
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export { AnimatedHero };
