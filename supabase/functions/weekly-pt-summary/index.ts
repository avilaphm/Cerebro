import OpenAI from 'npm:openai@4.104.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(url, serviceKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = authData.user.email?.toLowerCase() ?? '';
    const { data: requesterProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (requesterProfile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
      return json({ error: 'Only Pedro can generate weekly PT summaries.' }, 403);
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: clients }, { data: workouts }, { data: sets }, { data: events }] = await Promise.all([
      adminClient.from('pt_clients').select('id, name, email, goals').neq('status', 'archived'),
      adminClient.from('pt_workout_logs').select('*').gte('completed_at', since).order('completed_at', { ascending: false }),
      adminClient.from('pt_set_logs').select('*').gte('created_at', since).order('created_at', { ascending: false }),
      adminClient.from('pt_events').select('*').gte('created_at', since).order('created_at', { ascending: false }),
    ]);

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Write a concise weekly PT coaching summary for Pedro. Focus on what each client did, weight progression, missed signal, goals, and what Pedro should do next. No hype.',
        },
        {
          role: 'user',
          content: JSON.stringify({ clients, workouts, sets, events }),
        },
      ],
    });

    const summary = response.choices[0]?.message.content ?? 'No summary generated.';
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const pedroEmail = Deno.env.get('PEDRO_EMAIL') ?? 'pedro@meetavila.com';

    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: Deno.env.get('RESEND_FROM_PEDRO_NOTIFY') ?? 'Cerebro PT <onboarding@resend.dev>',
          to: pedroEmail,
          subject: 'Weekly PT summary',
          text: summary,
        }),
      });
    }

    return json({ summary });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Weekly summary failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
