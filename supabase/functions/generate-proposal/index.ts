/**
 * generate-proposal — Background edge function called by the chat function
 * after a lead is captured. Does web research (lead's site + similar
 * businesses), generates a storytelling proposal, generates discovery
 * questions for Pedro's call, saves everything to the proposals table, and
 * sends two emails: the proposal to the lead, and a follow-up notification
 * to Pedro with the proposal preview + the questions to ask on the call.
 *
 * Auth: requires an internal shared secret in the Authorization header.
 * Set CEREBRO_INTERNAL_SECRET in both the chat function and this function's
 * environment so they can talk to each other.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// =============================================================================
// Config (env-driven so domain switch is a one-line flip)
// =============================================================================
const FROM_LEAD_PROPOSAL =
  Deno.env.get('RESEND_FROM_LEAD_PROPOSAL') ??
  'Pedro at Cerebro <onboarding@resend.dev>';
const FROM_PEDRO_NOTIFY =
  Deno.env.get('RESEND_FROM_PEDRO_NOTIFY') ??
  'Cerebro Notifications <onboarding@resend.dev>';
const PEDRO_EMAIL = Deno.env.get('PEDRO_EMAIL') ?? 'pedro@meetavila.com';
// Optional Cal.com / Calendly URL. If empty, the proposal CTA falls back to
// "reply to this email" instead of a button link.
const BOOKING_URL = Deno.env.get('BOOKING_URL') ?? '';

// =============================================================================
// Step A — Research prompt (uses web_search + web_fetch server-side tools)
// =============================================================================
const RESEARCH_SYSTEM = `You are an analyst preparing a research brief for Pedro at Cerebro, an AI automation consultancy. Pedro will use this brief to write a tailored proposal for a small business owner.

Your job: gather just enough context to write a proposal that feels personalized and informed. Not a full audit. Not a market report.

Use the web tools sparingly:
- If the lead shared a website, fetch its homepage and extract: who they serve, services offered, tone of their brand, anything visible about their team size or process.
- Then run 1 to 2 targeted web searches on automation patterns for their specific business type (e.g., "automation for boutique law firms client onboarding"). Look for what other small businesses in that segment are actually automating.

Output a tight plain-text research brief in this format. No markdown headers. No fluff.

WEBSITE OBSERVATIONS:
[2 to 4 short observations from the homepage if a site was provided. Otherwise: "No website provided."]

SIMILAR BUSINESSES:
[2 to 4 short observations about what businesses like this typically automate, with one example or pattern that's specific.]

WHAT THIS LEAD LIKELY NEEDS:
[3 to 5 sentences. Synthesise what you learned plus what the lead said into a clear picture of where the highest-leverage automation lives for this specific business. Use plain language. No hype. No em dashes.]

Hard rules:
- Never invent numbers. If you cite a number, attribute it.
- Never say "AI revolution" or "10x" or "game-changer."
- If a search returns nothing useful, say so and move on.
- Total output: 200 to 400 words.`;

// =============================================================================
// Step B — Proposal generation (storytelling HTML email)
// =============================================================================
const PROPOSAL_SYSTEM = `You are writing a tailored proposal email from Pedro, the founder of Cerebro, to a specific small business owner who just had a chat with the Cerebro assistant.

Cerebro builds bespoke systems that handle the busywork behind small businesses. Voice: premium, calm, intelligent, founder-to-founder. Pedro ran service businesses for ten years before building these systems. He has lived the pain.

Voice rules (non-negotiable):
- Never use em dashes or double dashes.
- No corporate speak. No "I'm thrilled / excited / delighted." No "AI revolution."
- No bullet-list-heavy structure. Write in flowing paragraphs with occasional short standalone lines for emphasis.
- Use the lead's own words wherever they shared specifics. Quote them directly when it lands.
- Numbers: only use ones the lead supplied OR clearly labeled conservative estimates ("based on similar businesses, this can mean..."). Never invent precise claims.
- Write like Pedro is talking. Conversational rhythm. Short sentences mixed with longer ones.

Structure the email as a story in this exact order. Each section is a paragraph or two. Use <p>, <h3>, and <strong> tags only. No <ul>, no <table>, no inline styles in the body.

1. Personal opener (1 short paragraph).
   "Hey [first name]," + one sentence that mirrors what they shared, in their words.

2. Here's what we heard (1 paragraph).
   Their bottleneck and impact, restated. Use their phrases.

3. Here's why it keeps happening (1 short paragraph).
   Reframe the problem as a system design issue, not a personal failure. Calm and grounded.

4. Here's what we'd build (2 paragraphs OR 2 to 3 numbered story-steps).
   2 to 3 specific automations tailored to their business and bottleneck. Each one should feel built around what they said. Avoid generic "we'll automate your onboarding" lines. Be specific to their situation, informed by the research brief if provided.

5. What changes (1 short paragraph or 3 short standalone lines).
   Outcomes, in plain language. Tie back to their words.

6. Next step (1 paragraph).
   A warm, low-pressure CTA. If a booking URL is provided, end with a sentence inviting them to book. If not, invite them to reply.

7. Sign-off.
   "Pedro" on its own line, then a small line "Cerebro" in a lighter weight.

Output: ONLY the inner HTML for the email body. No <html>, <head>, <body>, or <style> tags. The wrapper will be added by the caller.

If the research brief is empty or thin, that's fine. Lean harder on what the lead said directly.`;

// =============================================================================
// Step C — Discovery questions (for Pedro's call, internal-only)
// =============================================================================
const QUESTIONS_SYSTEM = `You are helping Pedro prepare for a discovery call with a small business owner who just had a chat with the Cerebro assistant and just received a tailored proposal.

Look at the lead's chat transcript, the structured fields, and the proposal that was sent. Identify what's missing or unclear that Pedro should ask on the call.

Output 3 to 5 questions, each on its own line. Each question should:
- Be specific (not "tell me about your business")
- Fill a real gap in the proposal (volume numbers, integration constraints, decision-maker, timeline, budget if not stated, technical setup)
- Be phrased the way Pedro would actually ask it: direct, warm, conversational
- Not repeat anything the lead already answered in the chat

Output ONLY the questions, one per line, no numbering, no preamble. No em dashes.`;

// =============================================================================
// Helpers
// =============================================================================
interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  message: string | null;
  industry: string | null;
  pain_point: string | null;
  current_tools: string | null;
  team_size: string | null;
  budget: string | null;
  timeline: string | null;
  website: string | null;
}

function extractTextFromBlocks(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('\n')
    .trim();
}

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// =============================================================================
// Handler
// =============================================================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Internal-only auth check
  const authHeader = req.headers.get('Authorization') ?? '';
  const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');
  if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { lead_id } = (await req.json()) as { lead_id: string };
    if (!lead_id) {
      return new Response(JSON.stringify({ error: 'lead_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Load the lead and the most recent conversation transcript
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single<LeadRow>();

    if (leadError || !lead) {
      console.error('Lead fetch error:', leadError);
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: convoRow } = await supabase
      .from('conversations')
      .select('messages')
      .eq('lead_id', lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ messages: { role: string; content: string }[] }>();

    const transcript = (convoRow?.messages ?? [])
      .map((m) => `${m.role === 'user' ? 'Visitor' : 'Cerebro'}: ${m.content}`)
      .join('\n');

    const firstName = lead.name?.split(' ')[0] ?? 'there';
    const businessLabel = lead.industry ?? 'your business';

    // Insert a pending proposal row up front so we have an id to update later
    const { data: proposalRow, error: proposalInsertError } = await supabase
      .from('proposals')
      .insert({
        lead_id: lead.id,
        status: 'pending',
      })
      .select()
      .single<{ id: string }>();

    if (proposalInsertError || !proposalRow) {
      console.error('Proposal insert error:', proposalInsertError);
    }

    const proposalId = proposalRow?.id;

    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
    });

    // 2. Step A — Research
    const leadFacts = `
Lead snapshot:
- Name: ${lead.name ?? 'unknown'}
- Business / industry: ${lead.industry ?? 'unknown'}
- Bottleneck: ${lead.pain_point ?? 'unknown'}
- Current tools: ${lead.current_tools ?? 'unknown'}
- Team size: ${lead.team_size ?? 'unknown'}
- Budget: ${lead.budget ?? 'not specified'}
- Timeline: ${lead.timeline ?? 'not specified'}
- Website: ${lead.website ?? 'not provided'}

Their summary (in their own words):
${lead.message ?? 'not specified'}

Chat transcript:
${transcript || 'not available'}
`.trim();

    const websiteDomain = extractDomain(lead.website);
    const researchTools: any[] = [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 2,
      },
    ];
    // Only enable web_fetch if a website was provided. Restrict to that domain.
    if (websiteDomain) {
      researchTools.push({
        type: 'web_fetch_20250910',
        name: 'web_fetch',
        max_uses: 2,
        allowed_domains: [websiteDomain, `www.${websiteDomain}`],
        citations: { enabled: false },
      });
    }

    let researchSummary = '';
    try {
      // The web_fetch tool requires the anthropic-beta header. Pass it via the
      // SDK's per-request options (second arg), not in the body.
      const researchOptions = websiteDomain
        ? { headers: { 'anthropic-beta': 'web-fetch-2025-09-10' } }
        : undefined;

      const researchResponse = await anthropic.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: RESEARCH_SYSTEM,
          tools: researchTools,
          messages: [
            {
              role: 'user',
              content: `Research brief request for the following lead. Use the tools if useful; skip them if the context is already enough.\n\n${leadFacts}`,
            },
          ],
        } as any,
        researchOptions,
      );

      researchSummary = extractTextFromBlocks(researchResponse.content as unknown[]);
    } catch (err) {
      console.error('Research step failed:', err);
      researchSummary = '';
    }

    // 3. Step B — Generate the proposal HTML
    let proposalInnerHtml = '';
    try {
      const proposalResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: PROPOSAL_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${leadFacts}\n\nResearch brief:\n${researchSummary || '(none gathered)'}\n\nWrite the proposal email body now. Inner HTML only.`,
          },
        ],
      });

      proposalInnerHtml = extractTextFromBlocks(
        proposalResponse.content as unknown[],
      );
    } catch (err) {
      console.error('Proposal generation failed:', err);
    }

    // 4. Step C — Generate Pedro's discovery questions
    let discoveryQuestions = '';
    try {
      const questionsResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: QUESTIONS_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${leadFacts}\n\nProposal that was sent:\n${proposalInnerHtml}\n\nGenerate the discovery call questions now.`,
          },
        ],
      });
      discoveryQuestions = extractTextFromBlocks(
        questionsResponse.content as unknown[],
      );
    } catch (err) {
      console.error('Discovery questions step failed:', err);
    }

    // 5. Save everything to the proposals table
    if (proposalId) {
      const { error: updateError } = await supabase
        .from('proposals')
        .update({
          proposal_html: proposalInnerHtml,
          proposal_text: proposalInnerHtml.replace(/<[^>]+>/g, ''),
          research_summary: researchSummary,
          discovery_questions: discoveryQuestions,
          status: proposalInnerHtml ? 'pending' : 'failed',
        })
        .eq('id', proposalId);

      if (updateError) {
        console.error('Proposal update error:', updateError);
      }
    }

    // 6. Email the proposal to the lead
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not set');
      return new Response(JSON.stringify({ ok: false, reason: 'no_resend_key' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!proposalInnerHtml) {
      console.error('No proposal HTML generated. Skipping email send.');
      return new Response(JSON.stringify({ ok: false, reason: 'no_proposal' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!lead.email) {
      console.error('Lead has no email; cannot send proposal.');
      return new Response(JSON.stringify({ ok: false, reason: 'no_email' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ctaHtml = BOOKING_URL
      ? `<p style="margin:32px 0 0 0;">
           <a href="${BOOKING_URL}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:14px 28px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;">Book a call with Pedro &rarr;</a>
         </p>`
      : `<p style="margin:32px 0 0 0;color:#666;font-size:14px;">Just hit reply if you want to talk it through.</p>`;

    const proposalEmailHtml = `
      <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:0 auto;padding:48px 24px;color:#000;line-height:1.8;font-size:16px;">
        ${proposalInnerHtml}
        ${ctaHtml}
      </div>
    `;

    const proposalSubject = `A plan for ${businessLabel}, ${firstName}.`;

    const proposalSendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_LEAD_PROPOSAL,
        to: [lead.email],
        subject: proposalSubject,
        html: proposalEmailHtml,
      }),
    });

    if (!proposalSendRes.ok) {
      console.error('Proposal send error:', await proposalSendRes.text());
      if (proposalId) {
        await supabase
          .from('proposals')
          .update({ status: 'failed' })
          .eq('id', proposalId);
      }
    } else if (proposalId) {
      await supabase
        .from('proposals')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', proposalId);
    }

    // 7. Email Pedro the proposal preview + the discovery questions
    const questionsHtml = discoveryQuestions
      ? `<ol style="margin:0 0 0 0;padding-left:20px;">${discoveryQuestions
          .split('\n')
          .map((q) => q.trim())
          .filter(Boolean)
          .map((q) => `<li style="margin:0 0 8px 0;">${q}</li>`)
          .join('')}</ol>`
      : '<em>None generated</em>';

    const researchHtml = researchSummary
      ? `<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;background:#fafafa;padding:14px;border-radius:4px;margin:0;">${researchSummary}</pre>`
      : '<em>None gathered</em>';

    const pedroNotifyHtml = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:680px;margin:0 auto;padding:48px 24px;color:#000;line-height:1.7;font-size:14px;">
        <h2 style="font-size:18px;margin:0 0 8px 0;">Proposal sent to ${lead.name ?? 'lead'}</h2>
        <p style="margin:0 0 24px 0;color:#666;font-size:13px;">Lead ID: ${lead.id}${proposalId ? ' &middot; Proposal ID: ' + proposalId : ''}</p>

        <h3 style="font-size:14px;margin:24px 0 12px 0;text-transform:uppercase;letter-spacing:0.08em;color:#666;">Discovery questions to ask on the call</h3>
        ${questionsHtml}

        <h3 style="font-size:14px;margin:32px 0 12px 0;text-transform:uppercase;letter-spacing:0.08em;color:#666;">Research summary</h3>
        ${researchHtml}

        <h3 style="font-size:14px;margin:32px 0 12px 0;text-transform:uppercase;letter-spacing:0.08em;color:#666;">Proposal preview (what the lead saw)</h3>
        <div style="border:1px solid #e5e5e5;border-radius:4px;padding:24px;background:#fff;">
          ${proposalEmailHtml}
        </div>
      </div>
    `;

    const pedroNotifyRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_PEDRO_NOTIFY,
        to: [PEDRO_EMAIL],
        subject: `Proposal sent: ${lead.name ?? 'unnamed'} (${businessLabel})`,
        html: pedroNotifyHtml,
      }),
    });
    if (!pedroNotifyRes.ok) {
      console.error('Pedro notify error:', await pedroNotifyRes.text());
    }

    return new Response(
      JSON.stringify({
        ok: true,
        lead_id: lead.id,
        proposal_id: proposalId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('generate-proposal error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
