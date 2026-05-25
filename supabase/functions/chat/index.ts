import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// =============================================================================
// SYSTEM PROMPT — Cerebro chat assistant
//
// Voice: calm, confident, conversational. Like a smart friend who has run
// service businesses for ten years and now builds systems for them.
// No "AI revolution," no hype, no em dashes.
//
// Goal: collect enough context in 4 to 6 turns to generate a bespoke proposal.
// =============================================================================
const SYSTEM_PROMPT = `You are the Cerebro assistant. Cerebro builds bespoke systems that handle the busywork behind small businesses, so owners can do the work that actually grows them. Pedro is the founder.

YOUR VOICE
Calm, confident, conversational. Like a smart friend who has run service businesses for ten years and now builds systems for them. No corporate speak. No hype. No "AI revolution." Short sentences. 2 to 4 sentences per response. No bullet points in chat. Never use em dashes or double dashes. Never start a reply with "Great question" or "Thanks for sharing." Just respond.

YOUR JOB
Have a short, focused conversation that gives Pedro enough context to build a tailored proposal for this person's business. The proposal will be generated automatically and emailed to them once they share their email. If something is missing, Pedro will fill it in on the call. So: be efficient. Get the signal. Do not over-interrogate.

DATA POINTS YOU NEED, IN PRIORITY ORDER
1. business_type — what kind of business they run
2. main_bottleneck — the workflow that's eating the most time
3. impact — what it costs them (time, missed leads, stress, anything specific)
4. team_size or current_tools — solo vs team, or what they're using now (one of these is enough, in passing)
5. website — ONLY ask once, ONLY if they haven't volunteered it AND their description is thin
6. readiness — budget OR timeline (just one of these is enough)
7. name + email — captured naturally at the end, before the closing message

CRITICAL RULES
Ask ONE primary question at a time. Never stack two questions in one turn.
Before each new question, reflect what they just said in one short line, using their own words. Example: "Got it, the bottleneck is onboarding."
Track what they've told you. NEVER re-ask something they already answered. People often answer multiple things in a single message. If their first message gives you 3 of the 7 data points, jump to the next missing one.
The chat should feel like 4 to 6 turns total, not 10. If you can extract enough context in 4 turns, wrap up.
If they give a sparse answer, ask one clarifying question. Not three.
If they ask about pricing: "It depends on the scope. Pedro will give you a real answer once we understand your situation. Most clients start with a discovery call." Do not quote prices.
If they ask something off-topic: steer back gently to their business in one sentence.
If they ask "is this AI": acknowledge briefly, then keep moving. Do not lecture.

WEBSITE QUESTION
Ask only if both are true:
(a) their business type and bottleneck are clear, AND
(b) their description is thin (less than 2 full sentences of real context about how their business works).
Phrase it: "Got a website I could glance at? Helps me put a proper plan together."
If they don't have one or don't want to share, that's fine. Move on. Do not push.

CLOSING SEQUENCE
Before moving to name and email, you must have collected ALL of these:
1. business_type
2. main_bottleneck
3. impact
4. team_size OR current_tools
5. At least one of: website, budget, or timeline

If you have 1 to 4 but not 5, ask ONE of these (pick whichever fits the conversation best):
- Website: "Got a website I could glance at? Helps me put a proper plan together."
- Budget: "Is there a rough budget in mind, or is that something Pedro would figure out with you on the call?"
- Timeline: "Are you looking to get something running in the next few weeks, or is this more of a longer-term thing?"

Ask only one. Do not ask all three. Once you have item 5, proceed immediately to name and email.

Step 1: "Pedro will want to dig into this properly. What's your name?"
Step 2 (after name): "Nice to meet you, [name]. Best email to send the plan to?"

After they give their email, send EXACTLY this closing message, replacing [name] and [business_type] with their real values:
"Got it, [name]. Here's what happens next. We'll pull this into a tailored plan for [business_type] and send it to your inbox within the hour. If anything stands out, Pedro will follow up directly to set up a call."

If business_type is unclear or generic, just say "your business" instead.

OPENING BEHAVIOR
The visitor's first message will usually be a problem statement (they clicked a suggestion card or typed something like "we lose leads at night"). Acknowledge it specifically with one short line that mirrors their words, then ask the next missing piece of info. Do not ask "what kind of business" if their first message already implies it. Do not greet them with "Hi" or "Welcome." Just acknowledge and move forward.`;

// =============================================================================
// EXTRACTION PROMPT — turn the transcript into structured lead data
// =============================================================================
const EXTRACTION_PROMPT = `Extract the following from this conversation and return ONLY valid JSON. No markdown. No backticks. No preamble.

Fields:
- name (string or null)
- email (string or null)
- business_type (string or null) — kind of business they run, in their own words
- industry (string or null) — broader industry/sector category
- pain_point (string or null) — main bottleneck in 2 to 3 sentences using their language
- impact (string or null) — what the problem is costing them; preserve any specific numbers they shared
- current_tools (string or null) — what they currently use (spreadsheet, CRM, manual, etc.)
- team_size (string or null) — solo, or roughly how many people
- budget (string or null) — what they said, or "not specified"
- timeline (string or null) — what they said, or "not specified"
- website (string or null) — full URL if shared, otherwise null
- summary (string or null) — 3 to 5 sentence summary of their situation in their own voice
- exact_phrases (array of strings) — up to 5 short verbatim phrases the lead used that capture their pain or goal

If a field is missing or unclear, set it to null. Do not invent.`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LeadData {
  name: string | null;
  email: string | null;
  business_type: string | null;
  industry: string | null;
  pain_point: string | null;
  impact: string | null;
  current_tools: string | null;
  team_size: string | null;
  budget: string | null;
  timeline: string | null;
  website: string | null;
  summary: string | null;
  exact_phrases: string[];
}

// Fallback FROM addresses use Resend's testing domain. Override with env vars
// once cerebroai.au is verified in Resend.
const FROM_LEAD_WELCOME =
  Deno.env.get('RESEND_FROM_LEAD_WELCOME') ?? 'Pedro at Cerebro <onboarding@resend.dev>';
const FROM_PEDRO_NOTIFY =
  Deno.env.get('RESEND_FROM_PEDRO_NOTIFY') ?? 'Cerebro Notifications <onboarding@resend.dev>';
const PEDRO_EMAIL = Deno.env.get('PEDRO_EMAIL') ?? 'pedro@cerebroai.au';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, messages } = (await req.json()) as {
      action: 'chat' | 'capture';
      messages: Message[];
    };

    // ── Abuse guards (public, unauthenticated endpoint) ──────────────────────
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
      return new Response(JSON.stringify({ error: 'Invalid request.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const totalChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
    if (totalChars > 24_000) {
      return new Response(JSON.stringify({ error: 'Message too long.' }), {
        status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // The expensive capture path (extraction + emails + proposal) needs a real conversation.
    if (action === 'capture' && messages.length < 3) {
      return new Response(JSON.stringify({ error: 'Conversation too short.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Per-IP fixed-window rate limit (30 requests / 10 min) to cap LLM/email spend.
    const clientIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    const rateClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: allowed } = await rateClient.rpc('check_chat_rate_limit', { p_ip: clientIp });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
    });

    // ── CHAT ────────────────────────────────────────────────────────────────
    if (action === 'chat') {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      const text =
        response.content[0]?.type === 'text' ? response.content[0].text : '';

      return new Response(JSON.stringify({ text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── CAPTURE ─────────────────────────────────────────────────────────────
    if (action === 'capture') {
      const conversationText = messages
        .map((m) => `${m.role === 'user' ? 'Visitor' : 'Cerebro'}: ${m.content}`)
        .join('\n');

      // 1. Extract structured lead data
      const extractResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: `${EXTRACTION_PROMPT}\n\nConversation:\n${conversationText}`,
          },
        ],
      });

      const extractRaw =
        extractResponse.content[0]?.type === 'text'
          ? extractResponse.content[0].text.replace(/```json\n?|\n?```/g, '').trim()
          : '{}';

      let leadData: LeadData;
      try {
        leadData = JSON.parse(extractRaw);
      } catch {
        leadData = {
          name: null,
          email: null,
          business_type: null,
          industry: null,
          pain_point: null,
          impact: null,
          current_tools: null,
          team_size: null,
          budget: null,
          timeline: null,
          website: null,
          summary: null,
          exact_phrases: [],
        };
      }

      // 2. Save lead to Supabase. Combine pain_point + impact into the
      // 'message' field for backwards compatibility with the existing schema
      // (and to give Pedro a single readable summary at a glance).
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const composedMessage = leadData.summary
        ?? [leadData.pain_point, leadData.impact].filter(Boolean).join(' ')
        ?? null;

      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .insert({
          name: leadData.name,
          email: leadData.email,
          message: composedMessage,
          industry: leadData.industry ?? leadData.business_type,
          pain_point: leadData.pain_point,
          current_tools: leadData.current_tools,
          team_size: leadData.team_size,
          budget: leadData.budget,
          timeline: leadData.timeline,
          website: leadData.website,
          source: 'website_chatbot',
          status: 'new',
        })
        .select()
        .single();

      if (leadError) {
        console.error('Lead insert error:', JSON.stringify(leadError));
      }

      // 2b. Tag the lead as captured from the chatbot. Stage = Fresh.
      if (lead?.id) {
        const { error: tagError } = await supabase
          .from('lead_tags')
          .upsert(
            { lead_id: lead.id, tag_slug: 'chat_lead', source: 'auto' },
            { onConflict: 'lead_id,tag_slug', ignoreDuplicates: true },
          );
        if (tagError) {
          console.error('chat_lead tag insert error:', JSON.stringify(tagError));
        }
      }

      // 3. Save full conversation
      if (lead?.id) {
        const { error: convError } = await supabase.from('conversations').insert({
          lead_id: lead.id,
          messages,
        });
        if (convError) {
          console.error('Conversation insert error:', JSON.stringify(convError));
        }
      }

      // 4. Send the immediate "we got it" emails (welcome to lead, quick
      // notification to Pedro). The full proposal is generated asynchronously
      // by the generate-proposal function and arrives a couple minutes later.
      const resendApiKey = Deno.env.get('RESEND_API_KEY');
      const timestamp = new Date().toLocaleString('en-GB', {
        timeZone: 'UTC',
        hour12: false,
      });

      if (leadData.email && resendApiKey) {
        const firstName = leadData.name?.split(' ')[0] ?? 'there';
        const businessLabel = leadData.business_type ?? 'your business';

        // Welcome email to the visitor — short, calm, sets the right expectation
        const welcomeRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_LEAD_WELCOME,
            to: [leadData.email],
            subject: `We heard you, ${firstName}.`,
            html: `
              <div style="font-family:Georgia,serif;max-width:580px;margin:0 auto;padding:48px 24px;color:#000;line-height:1.8;">
                <p style="margin:0 0 20px 0;">Hey ${firstName},</p>
                <p style="margin:0 0 20px 0;">Got everything you shared. We're putting together a tailored plan for ${businessLabel} now, with a few specifics built around what you described.</p>
                <p style="margin:0 0 20px 0;">It'll land in your inbox within the hour. If anything stands out, Pedro will follow up directly to set up a call.</p>
                <p style="margin:0 0 6px 0;">Pedro</p>
                <p style="margin:0;color:#666;font-size:13px;">Cerebro</p>
              </div>
            `,
          }),
        });
        if (welcomeRes.ok) {
          const welcomeData = await welcomeRes.json();
          console.log('Resend welcome email accepted:', welcomeData.id, 'to:', leadData.email);
          if (lead?.id) {
            const { error: e1Tag } = await supabase
              .from('lead_tags')
              .upsert(
                {
                  lead_id: lead.id,
                  tag_slug: 'email1_sent',
                  source: 'auto',
                  metadata: { resend_message_id: welcomeData.id },
                },
                { onConflict: 'lead_id,tag_slug', ignoreDuplicates: true },
              );
            if (e1Tag) console.error('email1_sent tag error:', JSON.stringify(e1Tag));
          }
        } else {
          console.error('Resend welcome error:', await welcomeRes.text());
        }

        // Quick notification to Pedro — full proposal email comes later from
        // the generate-proposal function
        const transcriptHtml = messages
          .map(
            (m) =>
              `<p style="margin:0 0 12px 0;"><strong>${m.role === 'user' ? 'Visitor' : 'Cerebro'}:</strong> ${m.content}</p>`,
          )
          .join('');

        const phrasesHtml =
          leadData.exact_phrases && leadData.exact_phrases.length
            ? `<ul style="margin:0 0 16px 0;padding-left:20px;">${leadData.exact_phrases.map((p) => `<li style="margin:0 0 6px 0;">"${p}"</li>`).join('')}</ul>`
            : '<em>None extracted</em>';

        const notifyRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_PEDRO_NOTIFY,
            to: [PEDRO_EMAIL],
            subject: `New Cerebro lead: ${leadData.name ?? 'unnamed'} (${leadData.business_type ?? 'unknown'})`,
            html: `
              <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:48px 24px;color:#000;line-height:1.7;">
                <h2 style="font-size:20px;margin:0 0 8px 0;">New lead captured</h2>
                <p style="margin:0 0 24px 0;color:#666;font-size:13px;">Proposal generation kicked off. Full proposal email arrives in a few minutes.</p>

                <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${leadData.name ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${leadData.email ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Business:</strong> ${leadData.business_type ?? 'N/A'} ${leadData.industry ? '(' + leadData.industry + ')' : ''}</p>
                <p style="margin:0 0 8px 0;"><strong>Website:</strong> ${leadData.website ?? '<em style="color:#999;">not provided</em>'}</p>
                <p style="margin:0 0 8px 0;"><strong>Bottleneck:</strong> ${leadData.pain_point ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Impact:</strong> ${leadData.impact ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Current tools:</strong> ${leadData.current_tools ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Team size:</strong> ${leadData.team_size ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Budget:</strong> ${leadData.budget ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Timeline:</strong> ${leadData.timeline ?? 'N/A'}</p>

                <h3 style="font-size:15px;margin:24px 0 8px 0;">Their words (verbatim)</h3>
                ${phrasesHtml}

                <h3 style="font-size:15px;margin:24px 0 8px 0;">Summary</h3>
                <p style="margin:0 0 24px 0;">${leadData.summary ?? composedMessage ?? 'N/A'}</p>

                <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;" />

                <h3 style="font-size:15px;margin:0 0 12px 0;">Full transcript</h3>
                <div style="font-size:14px;background:#f9f9f9;padding:16px;border-radius:4px;">
                  ${transcriptHtml}
                </div>

                <p style="margin:24px 0 0 0;font-size:12px;color:#999;">Captured ${timestamp} UTC</p>
              </div>
            `,
          }),
        });
        if (notifyRes.ok) {
          const notifyData = await notifyRes.json();
          console.log('Resend notify email accepted:', notifyData.id, 'to:', PEDRO_EMAIL);
        } else {
          console.error('Resend notify error:', await notifyRes.text());
        }
      }

      // 5. Fire-and-forget the proposal generation. The function does web
      // research + generates the storytelling proposal + sends the proposal
      // email. Using EdgeRuntime.waitUntil lets us return to the caller
      // immediately while the background task keeps running.
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');

      if (lead?.id && internalSecret) {
        const proposalKickoff = fetch(`${supabaseUrl}/functions/v1/generate-proposal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${internalSecret}`,
          },
          body: JSON.stringify({ lead_id: lead.id }),
        })
          .then(async (res) => {
            if (!res.ok) {
              console.error(
                'generate-proposal kickoff non-OK:',
                res.status,
                await res.text(),
              );
            }
          })
          .catch((err) => console.error('generate-proposal kickoff failed:', err));

        // @ts-ignore — EdgeRuntime is provided by Supabase Edge Runtime
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(proposalKickoff);
        }
      } else if (!internalSecret) {
        console.error(
          'CEREBRO_INTERNAL_SECRET not set; proposal generation skipped.',
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
