import type { Metadata } from "next";
import VerticalPage from "../components/VerticalPage";

export const metadata: Metadata = {
  title: "Finance and M&A Systems",
  description:
    "Embedded reporting, diligence, and operating systems for finance teams that need current answers without rebuilding the same analysis by hand.",
};

export default function FinancePage() {
  return (
    <VerticalPage
      activeHref="/finance"
      eyebrow="Finance and M&A route"
      title="The answer should not arrive after the decision window closes."
      intro="Cerebro works with finance teams and acquisitive operators where reporting, diligence, and portfolio visibility still depend on people stitching systems together at month-end. We build against the live process so the human role moves from collecting and formatting to reviewing and deciding."
      primaryCta={{
        href: "#contact",
        label: "Map the reporting constraint",
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
        "A plain-English map of the data, approvals, and documents that move a decision through the business.",
        "Exception reporting that puts material changes and missing inputs in front of a reviewer instead of asking them to inspect every line.",
        "A repeatable reporting layer that makes post-deal visibility faster and less dependent on whoever used to hold the model together.",
      ]}
      fitLabel="Best fit"
      fitPoints={[
        "Boutique advisory, M&A, and finance teams where senior people still build recurring analysis and decks manually.",
        "Acquisition work where the P&L is not enough and the real question is how the machine behaves week to week.",
        "Operators preparing for a raise, sale, or integration and needing to tighten the business before outside scrutiny lands.",
        "Portfolio teams that need the same operating picture across businesses without forcing every company onto one platform.",
      ]}
      contactTitle="If the team keeps rebuilding the same answer, that is the place to start."
      contactBody="Send the context, the recurring output, and where the cycle slows down. Cerebro can map the system worth testing before another month disappears into spreadsheet archaeology."
      contactHref="mailto:pedro@cerebroai.au?subject=Finance%20systems%20review"
    />
  );
}
