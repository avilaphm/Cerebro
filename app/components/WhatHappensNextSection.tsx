import FadeIn from "./FadeIn";

const ITEMS = [
  {
    n: "01",
    title: "One priority system.",
    body: "Not a shopping list of ideas. We choose the bottleneck with the clearest operational and commercial value.",
  },
  {
    n: "02",
    title: "Eight embedded weeks.",
    body: "Two four-hour sessions each week inside the business, plus the building and testing needed between them.",
  },
  {
    n: "03",
    title: "A clear finish line.",
    body: "Agreed success criteria, team handover, documentation, and thirty days of support after launch.",
  },
  {
    n: "04",
    title: "Built to pay for itself.",
    body: "The first system is selected to recover its cost within 60 days through saved time, increased output, or both.",
  },
];

export default function WhatHappensNextSection() {
  return (
    <section className="py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-20">
            The engagement
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0">
            {ITEMS.map((item, i) => (
              <div
                key={item.n}
                className={`py-10 ${
                  i < ITEMS.length - 1
                    ? "lg:pr-8 lg:border-r lg:border-black border-b border-black lg:border-b-0"
                    : ""
                } ${i > 0 ? "lg:pl-8" : ""} ${
                  i % 2 === 0 ? "md:pr-8 md:border-r md:border-black" : "md:pl-8"
                } ${i < 2 ? "md:border-b md:border-black lg:border-b-0" : ""}`}
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
