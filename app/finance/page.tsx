import type { Metadata } from "next";
import VerticalPage from "../components/VerticalPage";

export const metadata: Metadata = {
  title: "Finance and M&A Systems",
  description:
    "Cerebro maps how an operating business actually runs across reporting, billing, lead flow, and handoffs so finance teams can diligence the hidden admin layer.",
};

export default function FinancePage() {
  return (
    <VerticalPage
      activeHref="/finance"
      eyebrow="Finance and M&A route"
      title="See the operation before you inherit the mess."
      intro="Cerebro helps finance teams and acquisitive operators inspect the admin layer under revenue, retention, and reporting. The goal is simple: surface the manual patches, owner dependency, and data gaps before they become your problem."
      primaryCta={{
        href: "#contact",
        label: "Discuss a diligence pass",
      }}
      secondaryCta={{
        href: "/operators",
        label: "View operator route",
      }}
      pressureLabel="Where risk hides"
      pressurePoints={[
        "Reporting looks clean because one operator is stitching five systems together by hand at month-end.",
        "Lead flow, booking, billing, and retention signals live in separate tools, so performance gets narrated instead of measured.",
        "The business can keep growing while its operating memory stays trapped in one founder, one GM, or one office manager.",
      ]}
      buildLabel="What Cerebro builds"
      buildPoints={[
        "A plain-English map of the workflows that move money, clients, and decisions through the business.",
        "Exception reporting that shows where failed payments, missed follow-up, or service slippage are being hidden by manual recovery.",
        "An operating layer that makes post-deal reporting faster, cleaner, and less dependent on whoever used to hold the whole thing together.",
      ]}
      fitLabel="Best fit"
      fitPoints={[
        "Fitness roll-ups, studio groups, and other service portfolios where operational quality matters as much as topline performance.",
        "Acquisition work where the P&L is not enough and the real question is how the machine behaves week to week.",
        "Operators preparing for a raise, sale, or integration and needing to tighten the business before outside scrutiny lands.",
        "Teams that want the same brand language as the fitness route, but a more diligence-oriented entry point.",
      ]}
      contactTitle="If you are looking at an acquisition, a portfolio company, or a reporting mess, start here."
      contactBody="Send the context, the timeline, and where the uncertainty sits. Cerebro can scope the operational diagnosis before it turns into another spreadsheet archaeology project."
      contactHref="mailto:pedro@cerebroai.au?subject=Finance%20systems%20review"
    />
  );
}
