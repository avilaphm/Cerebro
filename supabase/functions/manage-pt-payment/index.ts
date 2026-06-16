import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';
import { creditPack, PACK_PRICES, VALID_PACKS, type PackSize } from '../_shared/credit-pack.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];

type Action = 'create_topup_intent' | 'confirm_topup';

interface RequestBody {
  action?: Action;
  client_id?: string;
  pack?: number;
  payment_intent_id?: string;
  save_card?: boolean;
}

interface PTClientRow {
  id: string;
  name: string;
  email: string;
  user_id: string | null;
  sessions_remaining: number;
  stripe_customer_id: string | null;
  last_pack_size: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ error: 'Stripe is not configured.' }, 500);

    const adminClient = createClient(url, serviceKey);
    // Deno edge runtime: stripe-node must use the fetch HTTP client, not Node http.
    const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = authData.user.email?.toLowerCase() ?? '';
    const { data: requesterProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();
    const isAdmin = requesterProfile?.role === 'admin' || PEDRO_EMAILS.includes(requesterEmail);

    const body = (await req.json()) as RequestBody;
    if (!body.action) return json({ error: 'Missing action.' }, 400);

    const client = await getClientForRequest(adminClient, authData.user.id, isAdmin, body.client_id);
    if (!client) return json({ error: 'Client not found.' }, 404);

    if (body.action === 'create_topup_intent') {
      return await createTopupIntent(adminClient, stripe, client, body);
    }
    if (body.action === 'confirm_topup') {
      return await confirmTopup(adminClient, stripe, client, body);
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('manage-pt-payment failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Payment action failed.' }, 500);
  }
});

async function createTopupIntent(
  adminClient: ReturnType<typeof createClient>,
  stripe: Stripe,
  client: PTClientRow,
  body: RequestBody,
) {
  const pack = Number(body.pack) as PackSize;
  if (!VALID_PACKS.includes(pack)) return json({ error: 'Invalid pack size.' }, 400);
  const amount = PACK_PRICES[pack];

  const customerId = await ensureStripeCustomer(adminClient, stripe, client);

  // Look for an already-saved card so the client can pay in one tap. A failure
  // here must not block the purchase — fall back to entering a new card.
  let savedCard: { brand: string; last4: string; payment_method_id: string } | null = null;
  try {
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
    const pm = methods.data[0];
    if (pm?.card) {
      savedCard = { brand: pm.card.brand, last4: pm.card.last4, payment_method_id: pm.id };
    }
  } catch (error) {
    console.error('Could not list saved cards:', error);
  }

  // No setup_future_usage here: whether the card is kept is the client's choice,
  // handled at confirm time (attach on consent). This also stops Stripe from
  // rendering its own "save card" checkbox, so our single checkbox is the source of truth.
  const intent = await stripe.paymentIntents.create({
    amount,
    currency: 'aud',
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    metadata: {
      pt_client_id: client.id,
      pack_size: String(pack),
    },
  });

  return json({
    client_secret: intent.client_secret,
    payment_intent_id: intent.id,
    amount_cents: amount,
    pack,
    saved_card: savedCard,
  });
}

async function confirmTopup(
  adminClient: ReturnType<typeof createClient>,
  stripe: Stripe,
  client: PTClientRow,
  body: RequestBody,
) {
  if (!body.payment_intent_id) return json({ error: 'Missing payment_intent_id.' }, 400);
  const intent = await stripe.paymentIntents.retrieve(body.payment_intent_id, {
    expand: ['latest_charge.payment_method_details'],
  });

  if (intent.metadata?.pt_client_id !== client.id) {
    return json({ error: 'This payment does not belong to you.' }, 403);
  }
  if (intent.status !== 'succeeded') {
    return json({ error: `Payment not complete (status: ${intent.status}).`, status: intent.status }, 400);
  }

  const result = await creditPack(adminClient, intent);

  // Save the card for future one-tap top-ups only if the client opted in, and
  // only if it isn't already on their account.
  if (body.save_card && intent.payment_method && client.stripe_customer_id) {
    const pmId = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method.id;
    try {
      const existing = await stripe.paymentMethods.list({ customer: client.stripe_customer_id, type: 'card' });
      const newFingerprint = await cardFingerprint(stripe, pmId);
      const alreadySaved = existing.data.some((m) => m.card?.fingerprint && m.card.fingerprint === newFingerprint);
      if (!alreadySaved) {
        await stripe.paymentMethods.attach(pmId, { customer: client.stripe_customer_id });
      }
    } catch (error) {
      console.error('Could not save card:', error);
    }
  }

  return json({ ok: true, ...result });
}

async function cardFingerprint(stripe: Stripe, paymentMethodId: string) {
  try {
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    return pm.card?.fingerprint ?? null;
  } catch {
    return null;
  }
}

async function ensureStripeCustomer(
  adminClient: ReturnType<typeof createClient>,
  stripe: Stripe,
  client: PTClientRow,
) {
  // A stored customer id can become stale: the Stripe key may have been rotated
  // or switched between live/test, leaving an id that no longer exists under the
  // current key. Verify it before trusting it, and self-heal if it's gone.
  if (client.stripe_customer_id) {
    try {
      const existing = await stripe.customers.retrieve(client.stripe_customer_id);
      if (!existing.deleted) return client.stripe_customer_id;
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing')) {
        throw error;
      }
      // resource_missing → fall through and recreate the customer below.
    }
  }
  const customer = await stripe.customers.create({
    email: client.email,
    name: client.name,
    metadata: { pt_client_id: client.id },
  });
  await adminClient.from('pt_clients').update({ stripe_customer_id: customer.id }).eq('id', client.id);
  return customer.id;
}

async function getClientForRequest(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  isAdmin: boolean,
  requestedClientId?: string,
) {
  let query = adminClient
    .from('pt_clients')
    .select('id, name, email, user_id, sessions_remaining, stripe_customer_id, last_pack_size')
    .neq('status', 'archived');
  query = isAdmin && requestedClientId ? query.eq('id', requestedClientId) : query.eq('user_id', userId);
  const { data } = await query.limit(1).maybeSingle();
  return data as PTClientRow | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
