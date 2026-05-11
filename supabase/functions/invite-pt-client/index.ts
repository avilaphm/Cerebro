import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au'];

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
      return json({ error: 'Only Pedro can invite PT clients.' }, 403);
    }

    const { client_id } = (await req.json()) as { client_id?: string };
    if (!client_id) return json({ error: 'Missing client_id.' }, 400);

    const { data: ptClient, error: clientError } = await adminClient
      .from('pt_clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !ptClient) return json({ error: clientError?.message ?? 'Client not found.' }, 404);

    const redirectTo = `${req.headers.get('Origin') ?? 'https://cerebroai.au'}/auth/callback?next=/client`;
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(ptClient.email, {
      redirectTo,
      data: { full_name: ptClient.name, role: 'client' },
    });

    if (inviteError) return json({ error: inviteError.message }, 400);

    if (invited.user) {
      await adminClient.from('profiles').upsert({
        id: invited.user.id,
        email: ptClient.email,
        full_name: ptClient.name,
        role: 'client',
        updated_at: new Date().toISOString(),
      });
      await adminClient
        .from('pt_clients')
        .update({ user_id: invited.user.id, status: 'invited', updated_at: new Date().toISOString() })
        .eq('id', ptClient.id);
      await adminClient.from('pt_events').insert({
        client_id: ptClient.id,
        event_type: 'client_invited',
        metadata: { email: ptClient.email },
      });
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invite failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
