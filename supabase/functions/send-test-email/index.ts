import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

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
      return json({ error: 'Only Pedro can send test emails.' }, 403);
    }

    const body = await req.json() as { to?: string; subject?: string; html?: string };
    const to = body.to?.trim();
    const subject = body.subject?.trim();
    const html = body.html?.trim();

    if (!to || !subject || !html) return json({ error: 'to, subject, and html are required.' }, 400);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'RESEND_API_KEY is not configured.' }, 500);

    const from = Deno.env.get('RESEND_FROM_PEDRO_NOTIFY') ?? 'Pedro Avila Coaching <onboarding@resend.dev>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `[TEST] ${subject}`, html }),
    });

    if (!res.ok) {
      const text = await res.text();
      return json({ error: `Resend error: ${text}` }, res.status);
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Test send failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
