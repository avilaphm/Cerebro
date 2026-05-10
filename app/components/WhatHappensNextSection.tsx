import FadeIn from "./FadeIn";

const ITEMS = [
  {
    n: "01",
    title: "The picture.",
    body: "Three specific leaks in your operation. Named, ranked by impact, with time and money estimates. In plain language.",
  },
  {
    n: "02",
    title: "The order to fix them.",
    body: "Not all three at once. The sequence. What to build first, because it pays for the next two.",
  },
  {
    n: "03",
    title: "A conversation with Pedro.",
    body: "Thirty minutes. No deck, no pitch. If you want to go further, we talk. If not, you keep the picture anyway.",
  },
];

export default function WhatHappensNextSection() {
  return (
    <section className="py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-20">
            From the audit
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {ITEMS.map((item, i) => (
              <div
                key={item.n}
                className={`py-10 ${
                  i < 2
                    ? "md:pr-12 md:border-r md:border-black border-b border-black md:border-b-0"
                    : ""
                } ${i > 0 ? "md:pl-12" : ""}`}
              >
                <p
                  className="font-display text-[3.5rem] font-light leading-none mb-8 tracking-[-0.02em] select-none"
                  style={{ color: "rgba(0,0,0,0.07)" }}
                >
                  {item.n}
                </p>
                <h3 className="font-display text-lg font-medium tracking-[-0.01em] mb-4 text-black">
                  {item.title}
                </h3>
                <p className="text-sm font-light text-black/60 leading-relaxed">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
