import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';
import { creditPack } from '../_shared/credit-pack.ts';

// Stripe webhook receiver. verify_jwt = false (Stripe is not a Supabase user) —
// authenticity is enforced by verifying the Stripe signature against
// STRIPE_WEBHOOK_SECRET. This is the reliable backstop that credits a purchase
// even if the client closes the tab before confirm_topup runs. Idempotent via
// the pt_payments unique constraint inside creditPack().
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    return new Response('Stripe not configured', { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing stripe-signature', { status: 400 });

  // Deno edge runtime: fetch HTTP client + SubtleCrypto provider for async verify.
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret, undefined, cryptoProvider);
  } catch (error) {
    return new Response(`Signature verification failed: ${error instanceof Error ? error.message : 'unknown'}`, { status: 400 });
  }

  if (event.type === 'payment_intent.succeeded') {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const intent = event.data.object as Stripe.PaymentIntent;

    // Only act on our session-pack purchases (they carry pt_client_id metadata).
    if (intent.metadata?.pt_client_id) {
      try {
        // Re-retrieve with the charge expanded so card brand/last4 are available.
        const full = await stripe.paymentIntents.retrieve(intent.id, {
          expand: ['latest_charge.payment_method_details'],
        });
        await creditPack(adminClient, full);
      } catch (error) {
        console.error('creditPack failed for', intent.id, error);
        return new Response('credit failed', { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
