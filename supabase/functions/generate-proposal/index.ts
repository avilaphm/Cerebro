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
const PEDRO_EMAIL = Deno.env.get('PEDRO_EMAIL') ?? 'pedro@cerebroai.au';
const BOOKING_URL = Deno.env.get('BOOKING_URL') ?? '';
// Used to embed the email open tracking pixel. Set APP_URL to https://cerebroai.au in production.
const APP_URL = Deno.env.get('APP_URL') ?? '';

// =============================================================================
// Step A — Research prompt (uses web_search + web_fetch server-side tools)
// =============================================================================
const RESEARCH_SYSTEM = `You are an analyst preparing a research brief for Pedro at Cerebro, an embedded AI systems consultancy. Pedro will use this brief to identify the first high-value system to build for an expert-led business.

Your job: gather just enough context to write a proposal that feels personalized and informed. Not a full audit. Not a market report.

Use the web tools sparingly:
- If the lead shared a website, fetch its homepage and extract: who they serve, services offered, tone of their brand, anything visible about their team size or process.
- Then run 1 to 2 targeted web searches on how their specific business type handles the named recurring work. Look for the systems, data formats, review requirements, security constraints, and common failure points that shape a practical build.

Output a tight plain-text research brief in this format. No markdown headers. No fluff.

WEBSITE OBSERVATIONS:
[2 to 4 short observations from the homepage if a site was provided. Otherwise: "No website provided."]

DELIVERY PATTERNS:
[2 to 4 short observations about how businesses like this produce the named work, including one specific system or data pattern.]

FIRST SYSTEM TO INVESTIGATE:
[3 to 5 sentences. Synthesise what you learned plus what the lead said into a clear picture of the single highest-leverage system to test first. State what should remain human. Use plain language. No hype. No em dashes.]

Hard rules:
- Never invent numbers. If you cite a number, attribute it.
- Never say "AI revolution" or "10x" or "game-changer."
- If a search returns nothing useful, say so and move on.
- Total output: 200 to 400 words.`;

// =============================================================================
// Step B — Proposal generation (storytelling HTML email)
// =============================================================================
const PROPOSAL_SYSTEM = `You are writing a tailored starting-point email from Pedro, the founder of Cerebro, to an operator who just had a chat with the Cerebro assistant.

Write this like Pedro is continuing a useful business conversation. Not a pitch deck. Not polished agency copy. A real message from a builder who wants to understand the work before prescribing the system.

Cerebro is an embedded AI systems partner. Pedro spends two four-hour sessions each week inside the client business, works alongside the team, and builds one priority system around the way the work already moves. A typical embedded build runs for eight weeks and starts at A$25,000. Human judgement stays. Repetitive production work goes.

Voice rules (non-negotiable):
- Never use em dashes or double dashes. Never.
- Write like you are talking to a friend. Warm, direct, no fluff.
- No corporate speak. Nothing that sounds like a marketing team wrote it. No "I'm thrilled / excited / delighted." No "AI revolution." No "innovative solution."
- Use the lead's own words wherever they shared specifics. If they said something specific, repeat it back to them in their own language.
- Numbers: only use ones the lead supplied OR clearly labeled conservative estimates. Never invent precise claims.
- Short sentences. Conversational rhythm. The kind of thing Pedro would actually say out loud.
- No hedging. No "this could potentially perhaps help with..."

Structure the email in this order:

1. Personal opener (1 short paragraph).
   Start with "Hey [first name]," then one warm sentence that picks up directly from what they shared. Like you were already mid-conversation.

2. What we heard (1 paragraph).
   Their bottleneck and what it is costing them, restated in plain language using their phrases. Make them feel understood.

3. Why it keeps happening (1 short paragraph).
   Reframe the problem as a system design issue, not a personal failure. Matter-of-fact. Not preachy.

4. The first system to investigate (one short intro sentence + a bullet list).
   Name ONE priority system, not a shopping list of unrelated ideas. Then use a <ul> with 2 to 3 <li> items describing its essential components, the human review point, and the existing tools or documents it needs to fit around. Be concrete.

5. What changes (1 short paragraph or 2 to 3 short standalone lines).
   State the practical outcome and how it should be measured. Use only numbers the lead supplied. Do not guarantee the outcome.

6. Next step (1 paragraph).
   Explain that the next conversation maps the live process, confirms data and security constraints, and agrees success criteria. State that embedded builds start at A$25,000, with the final scope confirmed after that diagnostic. If a booking URL is provided, invite them to book. If not, invite them to reply.

7. Sign-off.
   "Pedro" on its own line, then "Cerebro" in a lighter weight below it.

Output: ONLY the inner HTML for the email body. Use <p>, <ul>, <li>, <strong> tags only. No headings. No <html>, <head>, <body>, or <style> tags. The wrapper is added by the caller.

If the research brief is thin or empty, lean harder on exactly what the lead said.`;

// =============================================================================
// Step C — Discovery questions (for Pedro's call, internal-only)
// =============================================================================
const QUESTIONS_SYSTEM = `You are helping Pedro prepare for a business diagnostic with an operator who just received a tailored starting point from Cerebro.

Look at the lead's chat transcript, the structured fields, and the proposal that was sent. Identify what's missing or unclear that Pedro should ask on the call.

Output 3 to 5 questions, each on its own line. Each question should:
- Be specific (not "tell me about your business")
- Fill a real gap in the proposal (cycle volume, current effort hours, source systems, data ownership, confidentiality, human review point, definition of done, decision-maker, timeline, or budget)
- Be phrased the way Pedro would actually ask it: direct, warm, conversational
- Not repeat anything the lead already answered in the chat

Output ONLY the questions, one per line, no numbering, no preamble. No em dashes.`;

// =============================================================================
// Step D — Deliverables extraction (for the dashboard lead card)
// =============================================================================
const DELIVERABLES_SYSTEM = `Extract the named priority system and up to two supporting components from this proposal email body.

Return ONLY a raw JSON array of strings. Each string names one deliverable concisely (under 12 words). No explanation, no wrapper object, no markdown code fences.

Example output:
["Monthly programme variance engine", "Material movement review queue", "Approved report draft"]`;

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
        lead_name: lead.name ?? null,
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
            content: `${leadFacts}\n\nProposal that was sent:\n${proposalInnerHtml}\n\nGenerate the business diagnostic questions now.`,
          },
        ],
      });
      discoveryQuestions = extractTextFromBlocks(
        questionsResponse.content as unknown[],
      );
    } catch (err) {
      console.error('Discovery questions step failed:', err);
    }

    // 5. Step D — Extract deliverables as a JSON array for the dashboard card
    let deliverables: string[] | null = null;
    if (proposalInnerHtml) {
      try {
        const deliverablesResponse = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: DELIVERABLES_SYSTEM,
          messages: [
            {
              role: 'user',
              content: proposalInnerHtml,
            },
          ],
        });
        const raw = extractTextFromBlocks(deliverablesResponse.content as unknown[]).trim();
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          deliverables = JSON.parse(match[0]);
        }
      } catch (err) {
        console.error('Deliverables extraction failed:', err);
      }
    }

    // 6. Save everything to the proposals table
    if (proposalId) {
      const { error: updateError } = await supabase
        .from('proposals')
        .update({
          proposal_html: proposalInnerHtml,
          proposal_text: proposalInnerHtml.replace(/<[^>]+>/g, ''),
          research_summary: researchSummary,
          discovery_questions: discoveryQuestions,
          deliverables: deliverables ?? null,
          status: proposalInnerHtml ? 'pending' : 'failed',
        })
        .eq('id', proposalId);

      if (updateError) {
        console.error('Proposal update error:', updateError);
      }
    }

    // 7. Email the proposal to the lead
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

    const trackingPixel = APP_URL
      ? `<img src="${APP_URL}/api/track/${lead.id}" width="1" height="1" style="display:none!important;border:0;outline:none;" alt="" />`
      : '';

    const proposalEmailHtml = `
      <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:0 auto;padding:48px 24px;color:#000;line-height:1.8;font-size:16px;">
        ${proposalInnerHtml}
        ${ctaHtml}
        ${trackingPixel}
      </div>
    `;

    const proposalSubject = `Where I would start, ${firstName}.`;

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
    } else {
      const proposalSendData = await proposalSendRes.json();
      console.log('Resend proposal email accepted:', proposalSendData.id, 'to:', lead.email);
      if (proposalId) {
        await supabase
          .from('proposals')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', proposalId);
      }
      const { error: e2Tag } = await supabase
        .from('lead_tags')
        .upsert(
          {
            lead_id: lead.id,
            tag_slug: 'email2_sent',
            source: 'auto',
            metadata: { resend_message_id: proposalSendData.id, proposal_id: proposalId },
          },
          { onConflict: 'lead_id,tag_slug', ignoreDuplicates: true },
        );
      if (e2Tag) console.error('email2_sent tag error:', JSON.stringify(e2Tag));
    }

    // 8. Email Pedro the proposal preview + the discovery questions
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
    if (pedroNotifyRes.ok) {
      const pedroNotifyData = await pedroNotifyRes.json();
      console.log('Resend Pedro notify accepted:', pedroNotifyData.id, 'to:', PEDRO_EMAIL);
    } else {
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
