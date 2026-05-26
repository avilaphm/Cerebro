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
    const accessToken = Deno.env.get('CEREBRO_SUPABASE_ACCESS_TOKEN');
    if (!accessToken) return json({ error: 'CEREBRO_SUPABASE_ACCESS_TOKEN is not configured for template management.' }, 500);

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
      return json({ error: 'Only Pedro can manage email templates.' }, 403);
    }

    const body = await req.json() as {
      action?: 'get' | 'update';
      template?: 'invite';
      subject?: string;
      html?: string;
    };

    if (body.template !== 'invite') return json({ error: 'Only the invite template is supported right now.' }, 400);

    const projectRef = new URL(url).hostname.split('.')[0];
    const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

    if (body.action === 'get') {
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return json({ error: await res.text() }, res.status);
      const config = await res.json() as Record<string, string>;
      return json({
        subject: config.mailer_subjects_invite ?? '',
        html: config.mailer_templates_invite_content ?? '',
      });
    }

    if (body.action === 'update') {
      const subject = body.subject?.trim();
      const html = body.html?.trim();
      if (!subject || !html) return json({ error: 'Subject and HTML are required.' }, 400);
      if (!html.includes('{{ .ConfirmationURL }}')) {
        return json({ error: 'Invite template must include {{ .ConfirmationURL }}.' }, 400);
      }

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          smtp_sender_name: 'Pedro Avila Coaching',
          mailer_subjects_invite: subject,
          mailer_templates_invite_content: html,
        }),
      });
      if (!res.ok) return json({ error: await res.text() }, res.status);

      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Template management failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
