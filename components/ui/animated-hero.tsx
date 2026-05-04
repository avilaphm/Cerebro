"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

function AnimatedHero() {
  const [titleNumber, setTitleNumber] = useState(0);
  const titles = useMemo(
    () => [
      "chase invoices.",
      "send reminder emails.",
      "update spreadsheets.",
      "compile reports.",
      "answer the same question twice.",
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
    <div className="w-full min-h-screen flex items-end pb-20 pt-44 px-6 md:px-12">
      <div className="w-full max-w-5xl mx-auto">
        <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-10">
          AI Automation for Service Businesses
        </p>

        <h1 className="font-display text-[clamp(2.8rem,8vw,7rem)] font-light leading-[1.06] tracking-[-0.02em] max-w-[900px] mb-6 text-black">
          You didn&apos;t start a business to{" "}
          <span className="relative inline-flex justify-start overflow-hidden h-[1.15em] align-bottom w-full">
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

        <div className="flex items-start gap-10 flex-col sm:flex-row mt-14">
          <a
            href="#get-in-touch"
            className="inline-flex items-center gap-3 text-[0.7rem] font-medium tracking-[0.12em] uppercase text-white bg-black px-8 py-4 no-underline transition-[opacity,transform] duration-200 hover:opacity-75 hover:-translate-y-px shrink-0"
          >
            Get in touch
            <span aria-hidden="true">→</span>
          </a>
          <p className="text-sm font-light text-black/60 leading-relaxed max-w-[360px] pt-1">
            We make that part disappear. So your business keeps running.
            While you do the work that matters.
          </p>
        </div>
      </div>
    </div>
  );
}

export { AnimatedHero };
