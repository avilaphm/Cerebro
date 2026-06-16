import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

export type PackSize = 1 | 2 | 5 | 10;
export type PriceTier = 1 | 2;

// Server-authoritative prices (cents, AUD). Never trust a client-supplied amount.
// Tier 1 is the standard rate; tier 2 is the higher rate, set per client.
export const TIER_PACK_PRICES: Record<PriceTier, Record<PackSize, number>> = {
  1: { 1: 11000, 2: 22000, 5: 52500, 10: 100000 },
  2: { 1: 12000, 2: 24000, 5: 57500, 10: 110000 },
};

// Back-compat default (tier 1) for any caller that doesn't pass a tier.
export const PACK_PRICES: Record<PackSize, number> = TIER_PACK_PRICES[1];

export const VALID_PACKS: PackSize[] = [1, 2, 5, 10];

export function normalizeTier(value: unknown): PriceTier {
  return value === 2 ? 2 : 1;
}

export function packPrice(tier: unknown, pack: PackSize): number {
  return TIER_PACK_PRICES[normalizeTier(tier)][pack];
}

// Credit a successful PaymentIntent to the client's session balance — exactly once.
// Called by manage-pt-payment's confirm_topup (instant UX) and by stripe-webhook
// (reliable backstop). The pt_payments.stripe_payment_intent_id UNIQUE constraint
// makes this idempotent: whichever path runs second detects the duplicate and no-ops.
export async function creditPack(adminClient: ReturnType<typeof createClient>, intent: Stripe.PaymentIntent) {
  const clientId = intent.metadata?.pt_client_id;
  const pack = Number(intent.metadata?.pack_size);
  if (!clientId || !VALID_PACKS.includes(pack as PackSize)) {
    throw new Error('PaymentIntent is missing pt_client_id / pack_size metadata.');
  }

  const { data: clientRow } = await adminClient
    .from('pt_clients')
    .select('id, name, email, sessions_remaining')
    .eq('id', clientId)
    .maybeSingle();
  if (!clientRow) throw new Error('Client not found for payment.');
  const current = clientRow as { id: string; name: string; email: string; sessions_remaining: number };

  const charge = (intent as Stripe.PaymentIntent & { latest_charge?: Stripe.Charge | null }).latest_charge;
  const card = (charge && typeof charge !== 'string') ? charge.payment_method_details?.card : null;

  // Idempotency guard: insert the payment row first. A duplicate intent id hits
  // the unique constraint, we detect it (23505), and skip crediting.
  const { error: insertError } = await adminClient.from('pt_payments').insert({
    client_id: current.id,
    stripe_payment_intent_id: intent.id,
    pack_size: pack,
    amount_cents: intent.amount,
    currency: intent.currency ?? 'aud',
    status: 'succeeded',
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
  });

  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      return { already_credited: true, sessions_remaining: current.sessions_remaining, pack };
    }
    throw new Error(insertError.message);
  }

  const nextBalance = current.sessions_remaining + pack;
  await adminClient.from('pt_clients').update({
    sessions_remaining: nextBalance,
    last_pack_size: pack,
    updated_at: new Date().toISOString(),
  }).eq('id', current.id);

  await adminClient.from('pt_session_ledger').insert({
    client_id: current.id,
    entry_type: 'pack_added',
    quantity: pack,
    balance_after: nextBalance,
    notes: `Stripe top-up: ${pack} session pack ($${(intent.amount / 100).toFixed(2)} ${(intent.currency ?? 'aud').toUpperCase()}).`,
  });

  await adminClient.from('pt_events').insert({
    client_id: current.id,
    event_type: 'pt_pack_purchased',
    metadata: { pack, amount_cents: intent.amount, payment_intent_id: intent.id, balance_after: nextBalance },
  });

  await sendPurchaseEmail(adminClient, current, pack, intent.amount, nextBalance);

  return { already_credited: false, sessions_remaining: nextBalance, pack };
}

async function sendPurchaseEmail(
  adminClient: ReturnType<typeof createClient>,
  client: { id: string; name: string; email: string },
  pack: number,
  amountCents: number,
  balance: number,
) {
  const subject = `Your ${pack} session pack is ready`;
  const text = `Hi ${client.name},\n\nYour payment of $${(amountCents / 100).toFixed(2)} AUD went through and ${pack} session${pack === 1 ? '' : 's'} have been added to your account.\n\nYou now have ${balance} session${balance === 1 ? '' : 's'} available to book.\n\nPedro`;
  await sendEmail(client.email, subject, text);
  await adminClient.from('pt_notification_log').insert({
    client_id: client.id,
    notification_type: 'pack_purchased',
    recipient_email: client.email,
    subject,
    metadata: { pack, amount_cents: amountCents, balance_after: balance },
  });
}

async function sendEmail(to: string, subject: string, text: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM_PEDRO_NOTIFY') ?? 'Pedro Avila Coaching <onboarding@resend.dev>',
      to,
      subject,
      text,
    }),
  });
}
