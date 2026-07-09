import OpenAI from 'npm:openai@4.104.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM = `You are an assistant for a personal trainer named Pedro.

Analyze a client message and determine if it contains important information Pedro should know about. Look for:
- Unavailability (travel, holidays, busy periods, skipping sessions)
- Injuries, pain, or discomfort
- Exercise dislikes or things they cannot do
- Health changes (illness, medication, pregnancy, surgery)
- Schedule changes
- Strong preferences or feedback about the programme

If the message contains nothing notable, return: { "is_notable": false }

If it does, return: { "is_notable": true, "note": "concise note in plain English, 1-2 sentences max, written in third person e.g. Client says they are..." }

Return only valid JSON. No markdown. No commentary.`;
const OPENAI_TEXT_MODEL = Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5.6';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(url, serviceKey);

    const { message_id, client_id, content, context } = (await req.json()) as {
      message_id: string;
      client_id: string;
      content: string;
      context?: Record<string, unknown>;
    };

    if (!message_id || !client_id || !content) {
      return json({ error: 'Missing required fields.' }, 400);
    }

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });

    const contextNote = context
      ? ` [Context: client was on ${String(context.phase_title ?? '')} ${String(context.day_title ?? '')}]`
      : '';

    const response = await openai.chat.completions.create({
      model: OPENAI_TEXT_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${content}${contextNote}` },
      ],
    });

    const raw = response.choices[0]?.message.content ?? '{"is_notable":false}';
    const result = JSON.parse(raw) as { is_notable: boolean; note?: string };

    if (result.is_notable && result.note) {
      await adminClient.from('pt_client_notes').insert({
        client_id,
        source_message_id: message_id,
        content: result.note,
        is_active: true,
      });
    }

    return json({ ok: true, extracted: result.is_notable });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Extraction failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
