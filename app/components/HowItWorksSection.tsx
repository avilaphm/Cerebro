import FadeIn from "./FadeIn";

const STEPS = [
  {
    n: "01",
    title: "The audit",
    body: "Tell us how your operation actually runs. Where leads come from, what software you use, where the week goes. Thirty minutes. We ask the questions most operators have never been asked.",
  },
  {
    n: "02",
    title: "The diagnosis",
    body: "Three specific leaks, ranked by financial impact. The order to fix them. Time and money estimates. Sent in writing after the call, whether you hire us or not.",
  },
  {
    n: "03",
    title: "The build",
    body: "We connect your existing tools. Mindbody, Glofox, Trainerize, Stripe. Custom workflows, tested before they go live. You see exactly what runs and how.",
  },
  {
    n: "04",
    title: "It runs",
    body: "Lead replies happen automatically. Payments recover themselves. Members get flagged before they cancel. You get a Sunday report instead of a Sunday session.",
  },
];

export default function HowItWorksSection() {
  return (
    <section className="py-[140px] px-6 md:px-12">
      <div className="w-full max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-20">
            How it works
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                className={`py-10 ${
                  // Right border on desktop except last column; bottom border on mobile/tablet except last row
                  i < STEPS.length - 1
                    ? "lg:pr-8 lg:border-r lg:border-black border-b border-black lg:border-b-0"
                    : ""
                } ${i > 0 ? "lg:pl-8" : ""} ${
                  // 2-col layout adjustments for tablet
                  i % 2 === 0 ? "md:pr-8 md:border-r md:border-black lg:pr-8" : "md:pl-8"
                } ${
                  i < 2 ? "md:border-b md:border-black lg:border-b-0" : ""
                }`}
              >
                <p
                  className="font-display text-[4rem] font-light leading-none mb-8 tracking-[-0.02em] select-none"
                  style={{ color: "rgba(0,0,0,0.07)" }}
                >
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
  );
}
