import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);

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
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
      return json({ error: 'Only Pedro can delete PT clients.' }, 403);
    }

    const { client_id } = (await req.json()) as { client_id?: string };
    if (!client_id) return json({ error: 'Missing client_id.' }, 400);

    const { data: ptClient, error: clientError } = await adminClient
      .from('pt_clients')
      .select('id, name, user_id')
      .eq('id', client_id)
      .single();

    if (clientError || !ptClient) return json({ error: 'Client not found.' }, 404);

    // Delete pt_clients row first (cascades to assignments, workout logs, set logs, events)
    const { error: deleteError } = await adminClient
      .from('pt_clients')
      .delete()
      .eq('id', client_id);

    if (deleteError) return json({ error: deleteError.message }, 500);

    // Delete auth user so the email can be reused — also cascades to profiles
    if (ptClient.user_id) {
      await adminClient.auth.admin.deleteUser(ptClient.user_id);
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Delete failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
