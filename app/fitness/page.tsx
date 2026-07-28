import type { Metadata } from "next";
import VerticalPage from "../components/VerticalPage";

export const metadata: Metadata = {
  title: "Fitness Business Systems",
  description:
    "Embedded systems for gyms, studios, and coaching businesses that need cleaner lead flow, retention, billing, and reporting without replacing their stack.",
};

export default function FitnessPage() {
  return (
    <VerticalPage
      activeHref="/fitness"
      eyebrow="Fitness route"
      title="The business should not fall behind while you are on the floor."
      intro="Fitness is where Pedro learned the cost of a business held together by late replies, manual check-ins, missed payments, and Sunday catch-up. Cerebro builds around the tools and habits already in place, then removes the work that keeps pulling the owner away from coaching."
      primaryCta={{
        href: "#contact",
        label: "Map the bottleneck",
      }}
      secondaryCta={{
        href: "/",
        label: "View embedded offer",
      }}
      pressureLabel="What usually gets missed"
      pressurePoints={[
        "Leads message after hours and go cold before anyone sends the booking link.",
        "Trials, quiet members, and failed payments are noticed after the chance to recover them has passed.",
        "The owner spends evenings rebuilding reports, writing check-ins, and chasing work the existing stack should already support.",
      ]}
      buildLabel="What Cerebro builds"
      buildPoints={[
        "Lead and trial follow-up that responds quickly while keeping the conversation human.",
        "Retention and billing signals that surface the right member before silence turns into cancellation.",
        "A weekly operating picture that shows cash flow, attendance, open loops, and the one thing requiring attention.",
      ]}
      fitLabel="Best fit"
      fitPoints={[
        "Solo coaches with a full book and no clean separation between coaching and admin.",
        "Boutique gyms and studios where the front desk cannot carry every follow-up manually.",
        "Multi-site operators pulling different reports from different systems to understand the same week.",
        "Fitness businesses that want to keep Mindbody, Glofox, Hapana, Trainerize, or their current stack.",
      ]}
      contactTitle="Tell Pedro where the business keeps pulling you away from the floor."
      contactBody="Share the business size, the tools you use, and the part of the week that keeps being rebuilt by hand. The first conversation is about finding the one system worth fixing first."
      contactHref="mailto:pedro@cerebroai.au?subject=Fitness%20systems%20conversation"
    />
  );
}
