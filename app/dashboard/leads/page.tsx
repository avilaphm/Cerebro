import { createClient } from '@/utils/supabase/server';

interface Lead {
  id: string;
  created_at: string;
  name: string | null;
  email: string | null;
  business_type?: string | null;
  industry: string | null;
  pain_point: string | null;
  status: string | null;
  proposals: { status: string; lead_name: string | null }[];
}

export default async function LeadsPage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from('leads')
    .select('id, created_at, name, email, industry, pain_point, status, proposals(status, lead_name)')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (leads ?? []) as Lead[];

  return (
    <div className="p-8">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Dashboard
      </p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-8">
        Leads
      </h1>

      <div className="border border-black/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-black/2">
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Date</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Name</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Email</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Business</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Bottleneck</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Proposal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-black/30 text-sm">
                  No leads yet. They will appear here once someone completes the chatbot.
                </td>
              </tr>
            )}
            {rows.map((lead) => {
              const proposal = lead.proposals?.[0];
              const date = new Date(lead.created_at).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });
              return (
                <tr key={lead.id} className="border-b border-black/5 hover:bg-black/2 transition-colors">
                  <td className="px-5 py-3.5 text-black/40 whitespace-nowrap">{date}</td>
                  <td className="px-5 py-3.5 text-black font-medium">{lead.name ?? '—'}</td>
                  <td className="px-5 py-3.5 text-black/60">{lead.email ?? '—'}</td>
                  <td className="px-5 py-3.5 text-black/60">{lead.industry ?? '—'}</td>
                  <td className="px-5 py-3.5 text-black/60 max-w-xs">
                    <span className="line-clamp-2">{lead.pain_point ?? '—'}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    {proposal ? (
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                          proposal.status === 'sent'
                            ? 'bg-black text-white'
                            : proposal.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-black/10 text-black/50'
                        }`}
                      >
                        {proposal.status}
                      </span>
                    ) : (
                      <span className="text-black/20 text-xs">none</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
