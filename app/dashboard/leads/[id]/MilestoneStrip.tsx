import { TAG, hasTag, type TagSlug } from '@/utils/leads/tags';

// Horizontal step indicator for the lead detail page. Each node lights up
// emerald when its matching tag is present. Connector lines between nodes
// fill emerald only once the next node is reached, so progress reads
// naturally left-to-right.

interface Step {
  label: string;
  match: TagSlug[];
}

const STEPS: Step[] = [
  { label: 'Email 1 sent',         match: [TAG.EMAIL1_SENT] },
  { label: 'Email 2 sent',         match: [TAG.EMAIL2_SENT] },
  { label: 'Proposal opened',      match: [TAG.EMAIL2_OPENED, TAG.PROPOSAL_VIEWED] },
  { label: 'PDF downloaded',       match: [TAG.PROPOSAL_DOWNLOADED] },
  { label: 'Booking link clicked', match: [TAG.CALL_BOOKED] },
];

export default function MilestoneStrip({ tags }: { tags: readonly string[] }) {
  const states = STEPS.map((s) => s.match.some((t) => hasTag(tags, t)));

  return (
    <section>
      <h2 className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/40 mb-4">
        Journey
      </h2>
      <div className="border border-black/10 rounded-xl px-6 py-7 bg-white">
        <ol className="flex items-start justify-between gap-2">
          {STEPS.map((step, i) => {
            const done = states[i];
            const nextDone = states[i + 1] ?? false;
            const isLast = i === STEPS.length - 1;
            return (
              <li
                key={step.label}
                className="flex-1 flex flex-col items-center text-center relative"
              >
                {/* Connector from this dot's center to the next dot's center.
                    Each li has equal flex width, so a 100%-wide line starting
                    at left:50% lands right at the next li's center. */}
                {!isLast && (
                  <span
                    aria-hidden
                    className={`absolute top-[7px] left-1/2 w-full h-px transition-colors ${
                      done && nextDone ? 'bg-emerald-500' : 'bg-black/10'
                    }`}
                  />
                )}

                {/* Node dot */}
                <span
                  aria-hidden
                  className={`relative w-4 h-4 rounded-full flex-shrink-0 z-10 transition-colors ${
                    done
                      ? 'bg-emerald-500 ring-4 ring-emerald-500/15'
                      : 'bg-white border-2 border-black/15'
                  }`}
                />

                {/* Label */}
                <span
                  className={`mt-3 text-[11px] leading-tight transition-colors ${
                    done ? 'text-black' : 'text-black/40'
                  }`}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
