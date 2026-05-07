/**
 * post-to-x — Posts a social draft to X (Twitter) using OAuth 1.0a.
 *
 * Two modes:
 *   { draft_id: string }         — post one specific draft (from "Post now" button)
 *   { process_scheduled: true }  — find and post all due scheduled drafts (cron job)
 *
 * Auth: user session (dashboard) OR CEREBRO_INTERNAL_SECRET (cron).
 *
 * Required Supabase Edge Function secrets:
 *   X_CONSUMER_KEY, X_CONSUMER_KEY_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TWEET_ENDPOINT = 'https://api.twitter.com/2/tweets';

// ─── OAuth 1.0a ───────────────────────────────────────────────────────────────

function pct(s: string): string {
  return encodeURIComponent(s);
}

async function oauthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const ts    = Math.floor(Date.now() / 1000).toString();

  const base: Record<string, string> = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        ts,
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };

  const paramStr = Object.entries(base)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join('&');

  const sigBase = [method.toUpperCase(), pct(url), pct(paramStr)].join('&');
  const signingKey = `${pct(consumerSecret)}&${pct(accessTokenSecret)}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(sigBase));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  base.oauth_signature = sig;

  return 'OAuth ' + Object.entries(base)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
    .join(', ');
}

// ─── Post one tweet ───────────────────────────────────────────────────────────

async function sendTweet(text: string): Promise<{ id: string } | { error: string }> {
  const consumerKey       = Deno.env.get('X_CONSUMER_KEY');
  const consumerSecret    = Deno.env.get('X_CONSUMER_KEY_SECRET');
  const accessToken       = Deno.env.get('X_ACCESS_TOKEN');
  const accessTokenSecret = Deno.env.get('X_ACCESS_TOKEN_SECRET');

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    return { error: 'X API credentials not configured in edge function secrets' };
  }

  const auth = await oauthHeader(
    'POST', TWEET_ENDPOINT,
    consumerKey, consumerSecret,
    accessToken, accessTokenSecret,
  );

  const res  = await fetch(TWEET_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.errors?.[0]?.message ?? data?.detail ?? JSON.stringify(data);
    return { error: msg };
  }

  return { id: data.data.id as string };
}

// ─── Process one draft ────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>;

async function postDraft(
  supabase: SupabaseClient,
  draftId: string,
): Promise<{ ok: boolean; tweet_id?: string; error?: string }> {
  const { data: draft } = await supabase
    .from('social_drafts')
    .select('id, content, status')
    .eq('id', draftId)
    .single<{ id: string; content: string; status: string }>();

  if (!draft)                     return { ok: false, error: 'Draft not found' };
  if (draft.status === 'posted')  return { ok: true };

  const result = await sendTweet(draft.content);

  if ('error' in result) {
    console.error('Tweet failed for draft', draftId, result.error);
    return { ok: false, error: result.error };
  }

  await supabase
    .from('social_drafts')
    .update({ status: 'posted', tweet_id: result.id, posted_at: new Date().toISOString() })
    .eq('id', draftId);

  console.log('Posted tweet', result.id, 'for draft', draftId);
  return { ok: true, tweet_id: result.id };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const serviceKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!;
  const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');
  const authHeader     = req.headers.get('Authorization') ?? '';

  const isInternal = internalSecret && authHeader === `Bearer ${internalSecret}`;
  const svc = createClient(supabaseUrl, serviceKey);

  let authorized = isInternal;
  if (!authorized) {
    const user = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: u }, error } = await user.auth.getUser();
    authorized = !error && !!u;
  }
  if (!authorized) return respond({ error: 'Unauthorized' }, 401);

  try {
    const body = (await req.json()) as { draft_id?: string; process_scheduled?: boolean };

    // ── Auto-post all due scheduled drafts ──
    if (body.process_scheduled) {
      const { data: due } = await svc
        .from('social_drafts')
        .select('id')
        .eq('status', 'scheduled')
        .eq('platform', 'twitter')
        .lte('scheduled_at', new Date().toISOString())
        .limit(20);

      const results: { id: string; ok: boolean; tweet_id?: string; error?: string }[] = [];
      for (const d of due ?? []) {
        const r = await postDraft(svc, d.id);
        results.push({ id: d.id, ...r });
        if (results.length > 1) await new Promise((r) => setTimeout(r, 500));
      }
      return respond({ ok: true, processed: results.length, results });
    }

    // ── Post one specific draft ──
    if (body.draft_id) {
      const result = await postDraft(svc, body.draft_id);
      if (!result.ok) return respond({ error: result.error });
      return respond({ ok: true, tweet_id: result.tweet_id });
    }

    return respond({ error: 'draft_id or process_scheduled required' });
  } catch (err) {
    console.error('post-to-x error:', err);
    return respond({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
