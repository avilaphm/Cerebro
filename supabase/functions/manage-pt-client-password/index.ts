import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

type PasswordAction = 'send_reset' | 'set_temporary_password';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const origin = req.headers.get('Origin') ?? 'https://cerebroai.au';

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const authClient = createClient(url, anonKey);
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
      return json({ error: 'Only Pedro can manage PT client passwords.' }, 403);
    }

    const { client_id, action } = (await req.json()) as {
      client_id?: string;
      action?: PasswordAction;
    };
    if (!client_id) return json({ error: 'Missing client_id.' }, 400);
    if (action !== 'send_reset' && action !== 'set_temporary_password') {
      return json({ error: 'Invalid password action.' }, 400);
    }

    const { data: ptClient, error: clientError } = await adminClient
      .from('pt_clients')
      .select('id, name, email, user_id')
      .eq('id', client_id)
      .single();

    if (clientError || !ptClient) return json({ error: clientError?.message ?? 'Client not found.' }, 404);

    if (action === 'send_reset') {
      const { error } = await authClient.auth.resetPasswordForEmail(ptClient.email, {
        redirectTo: callbackUrl(origin, '/client'),
      });
      if (error) return json({ error: error.message }, 400);

      await adminClient.from('pt_events').insert({
        client_id: ptClient.id,
        event_type: 'client_password_reset_sent',
        metadata: { email: ptClient.email },
      });

      return json({ ok: true, action: 'password_reset_sent' });
    }

    if (!ptClient.user_id) {
      return json({ error: 'This client does not have an auth account yet. Send the setup link first.' }, 400);
    }

    const password = generatePassword();
    const { error: updateError } = await adminClient.auth.admin.updateUserById(ptClient.user_id, {
      password,
    });
    if (updateError) return json({ error: updateError.message }, 400);

    await adminClient
      .from('pt_clients')
      .update({
        status: 'active',
        password_created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ptClient.id);

    await adminClient.from('pt_events').insert({
      client_id: ptClient.id,
      event_type: 'client_temporary_password_set',
      metadata: { email: ptClient.email },
    });

    return json({ ok: true, action: 'temporary_password_set', password });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Password action failed.' }, 500);
  }
});

function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const randomPart = Array.from(bytes, (byte) => PASSWORD_CHARS[byte % PASSWORD_CHARS.length]).join('');
  return `Pt-${randomPart}-1!`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function callbackUrl(origin: string, nextPath: '/client') {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('next', nextPath);
  return url.toString();
}
