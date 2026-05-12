import type { Metadata } from "next";
import VerticalPage from "../components/VerticalPage";

export const metadata: Metadata = {
  title: "Operator Systems",
  description:
    "Cerebro builds operational systems for founder-led service businesses where lead response, admin handoffs, payment recovery, and reporting are still too manual.",
};

export default function OperatorsPage() {
  return (
    <VerticalPage
      activeHref="/operators"
      eyebrow="Operator route"
      title="If the business runs on handoffs, follow-up, and memory, we can tighten it."
      intro="Not every company landing here is a gym. Some are service businesses with the same underlying problem: sales, delivery, and admin are crossing too many tools, too many inboxes, and too many human reminders. That is the layer Cerebro fixes."
      primaryCta={{
        href: "#contact",
        label: "Start the conversation",
      }}
      secondaryCta={{
        href: "/finance",
        label: "View finance route",
      }}
      pressureLabel="What usually breaks first"
      pressurePoints={[
        "Leads sit too long because follow-up depends on whoever remembers to chase, not on a system.",
        "Admins and operators rebuild the same weekly picture from inboxes, spreadsheets, and half-finished notes.",
        "Owners can feel the drag, but they cannot point to the exact handoffs where margin and time are leaking away.",
      ]}
      buildLabel="What Cerebro builds"
      buildPoints={[
        "Lead and client flow systems that remove the lag between enquiry, reply, booking, payment, and follow-up.",
        "A clearer operating rhythm so the team can see open loops, missed tasks, and exceptions without chasing for updates.",
        "Reporting that shows what needs attention this week, not a backwards-looking dump that arrives after the problem is old.",
      ]}
      fitLabel="Best fit"
      fitPoints={[
        "Founder-led service businesses with a small team, recurring admin load, and too many customer handoffs.",
        "Operators who have already bought software, but still feel like the real business runs in DMs, memory, and catch-up work.",
        "Teams that need more structure without replacing every tool or committing to a bloated platform rollout.",
        "Non-fitness businesses that found Cerebro through referrals and need a route that speaks to their operating reality.",
      ]}
      contactTitle="If the business is growing but the operating layer still feels improvised, this is the right route."
      contactBody="Send a short note on the business, the team size, and where the week disappears. Cerebro can tell you quickly whether the problem is lead flow, reporting, billing, handoffs, or all four."
      contactHref="mailto:pedro@cerebroai.au?subject=Operator%20systems%20conversation"
    />
  );
}
