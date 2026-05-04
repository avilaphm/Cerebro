import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You are the Cerebro assistant on the Cerebro website. Cerebro is an AI automation consultancy for service businesses. You help visitors understand how AI automation can save them time and improve their operations.

Your personality: Calm, confident, conversational. No corporate speak. No hype. You talk like a smart friend who happens to know a lot about business automation. Short sentences. No bullet points in chat. Keep responses to 2 to 4 sentences max.

Your job is to qualify this lead by collecting 7 pieces of information through natural conversation. The 7 data points are:

core_problem: What they want automated or what is eating their time
industry: What kind of business they run
time_drain: The specific task that takes the most time
current_tools: What they currently use to manage it (spreadsheets, a tool, manual, nothing)
team_size: Whether they are solo or have a team, and roughly how many people
budget: Whether they have a budget in mind or need Pedro to scope it
timeline: How soon they want to get this moving

CRITICAL RULES FOR QUESTION FLOW:
Before asking any question, check if the person has ALREADY answered it in a previous message. People often answer multiple questions in a single message without being asked. You must track what you know and what you still need.
After every message from the visitor, internally update which of the 7 data points you now have. Only ask about data points you are still missing. Never re-ask something they already told you. Never ask a question whose answer is obvious from what they already said.
If their first message is detailed and covers multiple data points at once, acknowledge the detail, validate what they said with a short insight, then ask only the NEXT missing data point.
For example, if someone writes "I run a personal training business and I spend hours every week manually tracking sessions on my calendar and sending check-in emails to clients" then you already have: core_problem (session tracking and manual emails), industry (personal training), time_drain (tracking sessions and sending emails), and current_tools (calendar, manual). You should NOT ask about any of those. Skip ahead to team_size, budget, or timeline.
Never ask more than one question at a time. Each response should: acknowledge what they said (1 sentence), add a small insight or validation showing you understand their problem (1 sentence), then ask the next missing data point naturally (1 sentence).
Once you have all 7 data points, transition to collecting their name and email:

Say something like "Pedro is going to want to dig into this properly. What is your name?"
After they give their name: "Great to meet you [name]. And the best email to reach you at?"

After collecting the email, send exactly this closing message:
"Got it, [name]. Here is what happens next. Pedro will review everything you have shared, put together an initial plan for what Cerebro can do for your business, and reach out via email to book a call. On that call, he will walk you through exactly how this could work for you. Expect to hear from him within 24 hours."

Additional rules:

Never say "I am just an AI" or "I am a chatbot." You are the Cerebro assistant.
Never mention specific pricing. If asked about cost, say it depends entirely on scope and that Pedro will give them a proper answer after understanding their situation. You can say most clients start with a discovery call to figure out what makes sense.
Never use em dashes or double dashes.
Keep every response to 2 to 4 sentences maximum. This is a chat, not an essay.
If they give very short answers, that is fine. Do not push. Just ask the next question naturally.
If someone asks something unrelated to business or automation, gently steer back with something like "Good question but probably one for Pedro directly. For now, tell me more about what is eating your time."
Be genuinely helpful. If you can give a quick example of how something they described could be automated, do it in one sentence. It builds trust and shows Cerebro knows what it is doing.`;

const EXTRACTION_PROMPT = `Extract the following from this conversation and return ONLY valid JSON with no other text, no markdown backticks, no preamble. Fields: name (string), email (string), industry (string, the type of business they run), pain_point (string, their core problem summarised in 2 to 3 sentences), current_tools (string, what they currently use to handle the problem), team_size (string, solo or number of people), budget (string, their stated budget or "not specified"), timeline (string, how soon they want to move), message (string, a full 3 to 5 sentence summary of everything they described wanting to automate and their overall situation). If any field is missing set it to null.`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LeadData {
  name: string | null;
  email: string | null;
  industry: string | null;
  pain_point: string | null;
  current_tools: string | null;
  team_size: string | null;
  budget: string | null;
  timeline: string | null;
  message: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, messages } = await req.json() as {
      action: 'chat' | 'capture';
      messages: Message[];
    };

    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
    });

    // ── CHAT ──────────────────────────────────────────────────────────────────
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

    // ── CAPTURE ───────────────────────────────────────────────────────────────
    if (action === 'capture') {
      const conversationText = messages
        .map((m) => `${m.role === 'user' ? 'Visitor' : 'Cerebro'}: ${m.content}`)
        .join('\n');

      // 1. Extract structured lead data
      const extractResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
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
          name: null, email: null, industry: null, pain_point: null,
          current_tools: null, team_size: null, budget: null, timeline: null, message: null,
        };
      }

      // 2. Save lead to Supabase
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .insert({
          name: leadData.name,
          email: leadData.email,
          message: leadData.message,
          industry: leadData.industry,
          pain_point: leadData.pain_point,
          current_tools: leadData.current_tools,
          team_size: leadData.team_size,
          budget: leadData.budget,
          timeline: leadData.timeline,
          source: 'website_chatbot',
          status: 'new',
        })
        .select()
        .single();

      if (leadError) {
        console.error('Lead insert error:', JSON.stringify(leadError));
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

      // 4. Generate draft scope (internal, never shown to client)
      let scopeDraft = '';
      if (lead?.id) {
        try {
          const scopePrompt = `You are Pedro's AI assistant at Cerebro, an AI automation consultancy. Based on the following lead information, draft a concise project scope that Pedro can review before his discovery call.

Lead info:

Industry: ${leadData.industry ?? 'not specified'}
Pain point: ${leadData.pain_point ?? 'not specified'}
Current tools: ${leadData.current_tools ?? 'not specified'}
Team size: ${leadData.team_size ?? 'not specified'}
Budget: ${leadData.budget ?? 'not specified'}
Timeline: ${leadData.timeline ?? 'not specified'}
Full description: ${leadData.message ?? 'not specified'}

Include in your scope:

A 2 to 3 sentence summary of the client's situation
A list of 3 to 5 specific automations Cerebro could build for them. Be specific to their industry and the problems they described. For each automation, write one sentence explaining what it does.
An estimated complexity level: light (1 to 2 weeks), medium (3 to 4 weeks), or heavy (5 plus weeks)
2 to 3 specific talking points Pedro should raise on the discovery call to show he understands their business and has already thought about solutions

Keep it practical and direct. No fluff. No em dashes. Write as if you are briefing Pedro before a meeting.`;

          const scopeResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            messages: [{ role: 'user', content: scopePrompt }],
          });

          scopeDraft =
            scopeResponse.content[0]?.type === 'text'
              ? scopeResponse.content[0].text
              : '';

          if (scopeDraft) {
            const { error: scopeError } = await supabase.from('lead_scopes').insert({
              lead_id: lead.id,
              scope_draft: scopeDraft,
            });
            if (scopeError) {
              console.error('Scope insert error:', JSON.stringify(scopeError));
            }
          }
        } catch (e) {
          console.error('Scope generation error:', e);
        }
      }

      // 5. Send emails via Resend
      const resendApiKey = Deno.env.get('RESEND_API_KEY');
      const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'UTC', hour12: false });

      if (leadData.email && resendApiKey) {
        // Generate personalised opening for visitor welcome email
        let personalizedOpening = leadData.message ?? '';
        if (leadData.message) {
          try {
            const personalizeResponse = await anthropic.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 256,
              messages: [
                {
                  role: 'user',
                  content: `Write 2 to 3 short, warm, direct sentences summarising this person's business problem and what they want automated. Write as if you are Pedro, the founder of Cerebro, speaking directly to them. Reference specific details from what they shared. No em dashes. No corporate language. Conversational tone. Do not start with "It sounds like" or "Based on what you shared." Just speak directly about their problem.\n\nProblem: ${leadData.message}`,
                },
              ],
            });
            personalizedOpening =
              personalizeResponse.content[0]?.type === 'text'
                ? personalizeResponse.content[0].text
                : leadData.message;
          } catch (e) {
            console.error('Personalization error:', e);
          }
        }

        // Welcome email to visitor
        const welcomeRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Pedro at Cerebro <onboarding@resend.dev>',
            to: [leadData.email],
            subject: `We heard you, ${leadData.name}.`,
            html: `
              <div style="font-family:Georgia,serif;max-width:580px;margin:0 auto;padding:48px 24px;color:#000;line-height:1.8;">
                <p style="margin:0 0 20px 0;">Hey ${leadData.name},</p>
                <p style="margin:0 0 20px 0;">${personalizedOpening}</p>
                <p style="margin:0 0 20px 0;">Here is what happens next. Pedro will review everything you shared, put together an initial plan for what we can build for your business, and reach out to book a call. On that call he will walk you through exactly how it could work.</p>
                <p style="margin:0 0 20px 0;">Expect to hear from him within 24 hours.</p>
                <p style="margin:0 0 6px 0;">Pedro</p>
                <p style="margin:0;">Cerebro</p>
              </div>
            `,
          }),
        });
        if (!welcomeRes.ok) {
          console.error('Resend welcome error:', await welcomeRes.text());
        }

        // Notification email to Pedro
        const transcriptHtml = messages
          .map(
            (m) =>
              `<p style="margin:0 0 12px 0;"><strong>${m.role === 'user' ? 'Visitor' : 'Cerebro'}:</strong> ${m.content}</p>`,
          )
          .join('');

        const scopeHtml = scopeDraft
          ? scopeDraft.replace(/\n/g, '<br/>')
          : '<em>Not generated</em>';

        const notifyRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Cerebro Notifications <onboarding@resend.dev>',
            to: ['pedro@meetavila.com'],
            subject: `New Cerebro lead: ${leadData.name}`,
            html: `
              <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:48px 24px;color:#000;line-height:1.7;">
                <h2 style="font-size:20px;margin:0 0 24px 0;">New lead from the Cerebro chatbot</h2>

                <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${leadData.name ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${leadData.email ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Industry:</strong> ${leadData.industry ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Pain point:</strong> ${leadData.pain_point ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Current tools:</strong> ${leadData.current_tools ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Team size:</strong> ${leadData.team_size ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Budget:</strong> ${leadData.budget ?? 'N/A'}</p>
                <p style="margin:0 0 8px 0;"><strong>Timeline:</strong> ${leadData.timeline ?? 'N/A'}</p>

                <h3 style="font-size:15px;margin:24px 0 8px 0;">Full summary</h3>
                <p style="margin:0 0 24px 0;">${leadData.message ?? 'N/A'}</p>

                <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;" />

                <h3 style="font-size:15px;margin:0 0 12px 0;">DRAFT SCOPE (AI-generated, review before call)</h3>
                <div style="font-size:14px;background:#f9f9f9;padding:16px;border-radius:4px;margin:0 0 24px 0;">
                  ${scopeHtml}
                </div>

                <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;" />

                <h3 style="font-size:15px;margin:0 0 12px 0;">Full conversation transcript</h3>
                <div style="font-size:14px;background:#f9f9f9;padding:16px;border-radius:4px;">
                  ${transcriptHtml}
                </div>

                <p style="margin:24px 0 0 0;font-size:12px;color:#999;">Submitted: ${timestamp} UTC</p>
              </div>
            `,
          }),
        });
        if (!notifyRes.ok) {
          console.error('Resend notify error:', await notifyRes.text());
        }
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
