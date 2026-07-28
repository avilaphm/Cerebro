import type { Metadata } from "next";
import VerticalPage from "../components/VerticalPage";

export const metadata: Metadata = {
  title: "Expert Service Firm Systems",
  description:
    "Cerebro works inside advisory, construction, engineering, and professional service firms to increase delivery output without matching headcount.",
};

export default function OperatorsPage() {
  return (
    <VerticalPage
      activeHref="/operators"
      eyebrow="Expert firms route"
      title="Your senior people should spend their time on judgement, not production work."
      intro="Advisory, construction, engineering, and professional service firms often have the same constraint. The expertise is strong, the work is valuable, but delivery still depends on senior people collecting data, comparing versions, drafting reports, and carrying the firm's method in their heads."
      primaryCta={{
        href: "#contact",
        label: "Map the bottleneck",
      }}
      secondaryCta={{
        href: "/finance",
        label: "View finance route",
      }}
      pressureLabel="What usually breaks first"
      pressurePoints={[
        "Recurring analysis takes days or weeks because data has to be found, cleaned, and compared by hand.",
        "Reports and client documents start from old templates, then senior staff rebuild the same structure for every engagement.",
        "Growth requires more delivery staff because output is still tied directly to expert hours.",
      ]}
      buildLabel="What Cerebro builds"
      buildPoints={[
        "Analysis systems that compare live data, rank the material changes, and put the exceptions in front of an expert for review.",
        "Report and document builders that start with the approved data, method, and audience instead of an empty page.",
        "A maintained knowledge layer that gives the team access to the firm's method without removing human review.",
      ]}
      fitLabel="Best fit"
      fitPoints={[
        "Expert-led firms with roughly 10 to 50 people and high internal delivery costs.",
        "Teams producing recurring analysis, reports, proposals, contracts, or client packs.",
        "Businesses with strong domain expertise but fragmented data across Excel, SharePoint, inboxes, and specialist tools.",
        "Owners who want more clients and revenue without increasing headcount at the same rate.",
      ]}
      contactTitle="If delivery capacity is the constraint, start with the work your best people keep repeating."
      contactBody="Send the team size, the recurring deliverable, and where the cycle slows down. Pedro will map the first system worth testing and the result it needs to prove."
      contactHref="mailto:pedro@cerebroai.au?subject=Expert%20firm%20systems%20conversation"
    />
  );
}
