'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { createClient } from '@/utils/supabase/client';
import { packOptionsForTier } from '@/utils/pt/pricing';

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

// supabase-js collapses a non-2xx Edge Function response into a generic
// "Edge Function returned a non-2xx status code". The actual JSON body lives on
// the error's `context` (the raw Response) — read it so the client sees why.
async function readFunctionError(err: unknown): Promise<string | null> {
  const context = (err as { context?: Response } | null)?.context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.clone().json();
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

const appearance = {
  theme: 'flat' as const,
  variables: {
    colorPrimary: '#000000',
    colorText: '#111111',
    colorBackground: '#ffffff',
    borderRadius: '0px',
    fontFamily: 'inherit',
  },
};

interface SavedCard {
  brand: string;
  last4: string;
  payment_method_id: string;
}

interface IntentResult {
  client_secret: string;
  payment_intent_id: string;
  amount_cents: number;
  pack: number;
  saved_card: SavedCard | null;
}

interface TopUpModalProps {
  open: boolean;
  clientId: string;
  clientName: string;
  clientEmail: string;
  priceTier?: number | null;
  reason?: string | null;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

export default function TopUpModal({ open, clientId, clientName, clientEmail, priceTier, reason, onClose, onSuccess }: TopUpModalProps) {
  const supabase = createClient();
  const packs = packOptionsForTier(priceTier);
  const [step, setStep] = useState<'select' | 'pay' | 'success'>('select');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<IntentResult | null>(null);

  if (!open) return null;

  const reset = () => {
    setStep('select');
    setIntent(null);
    setError(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickPack = async (pack: number) => {
    if (busy) return;
    if (!stripePromise) {
      setError('Payments are not configured yet. Please contact Pedro.');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke<IntentResult & { error?: string }>(
      'manage-pt-payment',
      { body: { action: 'create_topup_intent', client_id: clientId, pack } },
    );
    if (invokeError || !data || data.error || !data.client_secret) {
      setError((await readFunctionError(invokeError)) ?? data?.error ?? invokeError?.message ?? 'Could not start payment.');
      setBusy(false);
      return;
    }
    setIntent(data);
    setStep('pay');
    setBusy(false);
  };

  const handleCredited = async () => {
    setStep('success');
    await onSuccess();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={close}>
      <div className="no-glass max-h-[90vh] w-full max-w-sm overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {step === 'select' && (
          <div className="p-6">
            <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Buy sessions</p>
            <h3 className="mt-1 text-xl font-medium">Top up your pack</h3>
            <p className="mt-1 text-sm text-black/55">
              {reason ?? 'Choose a pack. Sessions are added to your account as soon as you pay.'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {packs.map(({ pack, price, per }) => (
                <button
                  key={pack}
                  type="button"
                  disabled={busy}
                  onClick={() => void pickPack(pack)}
                  className="flex flex-col items-start border border-black/10 px-4 py-4 text-left transition-colors hover:border-black/40 disabled:opacity-40"
                >
                  <span className="text-2xl font-light">{pack}</span>
                  <span className="text-xs text-black/45">session{pack === 1 ? '' : 's'}</span>
                  <span className="mt-2 text-sm font-medium">{price}</span>
                  <span className="text-[0.65rem] text-black/40">{per}</span>
                </button>
              ))}
            </div>
            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            <button type="button" onClick={close} className="mt-4 w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
              Cancel
            </button>
          </div>
        )}

        {step === 'pay' && intent && (
          <Elements stripe={stripePromise} options={{ clientSecret: intent.client_secret, appearance }}>
            <PayForm
              intent={intent}
              onBack={() => { setStep('select'); setIntent(null); setError(null); }}
              onCredited={handleCredited}
              supabase={supabase}
              clientId={clientId}
              clientName={clientName}
              clientEmail={clientEmail}
            />
          </Elements>
        )}

        {step === 'success' && intent && (
          <div className="p-6 text-center">
            <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Payment complete</p>
            <h3 className="mt-2 text-xl font-medium">{intent.pack} session{intent.pack === 1 ? '' : 's'} added</h3>
            <p className="mt-2 text-sm text-black/55">Your sessions are ready. We&apos;re finishing your booking now.</p>
            <button type="button" onClick={close} className="mt-6 w-full bg-black py-3 text-sm font-medium text-white hover:bg-black/85">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface PayFormProps {
  intent: IntentResult;
  onBack: () => void;
  onCredited: () => void | Promise<void>;
  supabase: ReturnType<typeof createClient>;
  clientId: string;
  clientName: string;
  clientEmail: string;
}

function PayForm({ intent, onBack, onCredited, supabase, clientId, clientName, clientEmail }: PayFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useDifferentCard, setUseDifferentCard] = useState(false);
  const [saveCard, setSaveCard] = useState(true);

  const amount = `$${(intent.amount_cents / 100).toFixed(2)}`;
  const savedCard = intent.saved_card;
  const showSaved = savedCard && !useDifferentCard;

  const credit = async (saveThisCard: boolean) => {
    const { data, error: confirmError } = await supabase.functions.invoke<{ error?: string; sessions_remaining?: number }>(
      'manage-pt-payment',
      { body: { action: 'confirm_topup', client_id: clientId, payment_intent_id: intent.payment_intent_id, save_card: saveThisCard } },
    );
    if (confirmError || data?.error) {
      // Payment succeeded with Stripe; the webhook will credit as a backstop.
      setError('Payment went through. Your sessions will appear in a moment.');
    }
    await onCredited();
  };

  const payWithSavedCard = async () => {
    if (!stripe || !savedCard || busy) return;
    setBusy(true);
    setError(null);
    const { error: payError, paymentIntent } = await stripe.confirmCardPayment(intent.client_secret, {
      payment_method: savedCard.payment_method_id,
    });
    if (payError || paymentIntent?.status !== 'succeeded') {
      setError(payError?.message ?? 'Payment could not be completed.');
      setBusy(false);
      return;
    }
    await credit(true); // already on file
  };

  const payWithNewCard = async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Please check your card details.');
      setBusy(false);
      return;
    }
    const { error: payError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: window.location.href,
        // We already know who the client is — supply billing details so Stripe
        // never asks them to retype their name/email.
        payment_method_data: { billing_details: { name: clientName, email: clientEmail } },
      },
    });
    if (payError || paymentIntent?.status !== 'succeeded') {
      setError(payError?.message ?? 'Payment could not be completed.');
      setBusy(false);
      return;
    }
    await credit(saveCard);
  };

  return (
    <div className="p-6">
      <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Pay {amount}</p>
      <h3 className="mt-1 text-xl font-medium">{intent.pack} session{intent.pack === 1 ? '' : 's'}</h3>

      {showSaved ? (
        <div className="mt-5">
          <div className="flex items-center justify-between border border-black/10 px-4 py-3 text-sm">
            <span className="capitalize">{savedCard!.brand} •••• {savedCard!.last4}</span>
            <span className="text-black/40">Saved card</span>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void payWithSavedCard()}
            className="mt-4 w-full bg-black py-3 text-sm font-medium text-white hover:bg-black/85 disabled:opacity-40"
          >
            {busy ? 'Processing…' : `Pay ${amount} with ${savedCard!.brand} ••${savedCard!.last4}`}
          </button>
          <button type="button" onClick={() => setUseDifferentCard(true)} className="mt-2 w-full py-2 text-xs text-black/45 hover:text-black">
            Use a different card
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <PaymentElement
            options={{
              layout: 'tabs',
              // We already have the client's name/email — don't make them retype it.
              fields: { billingDetails: { name: 'never', email: 'never' } },
            }}
          />
          <label className="mt-3 flex items-start gap-2 text-sm text-black/70">
            <input
              type="checkbox"
              checked={saveCard}
              onChange={(e) => setSaveCard(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-black"
            />
            <span>Save this card for faster top-ups next time</span>
          </label>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button
            type="button"
            disabled={busy || !stripe}
            onClick={() => void payWithNewCard()}
            className="mt-4 w-full bg-black py-3 text-sm font-medium text-white hover:bg-black/85 disabled:opacity-40"
          >
            {busy ? 'Processing…' : `Pay ${amount}`}
          </button>
          {savedCard && (
            <button type="button" onClick={() => setUseDifferentCard(false)} className="mt-2 w-full py-2 text-xs text-black/45 hover:text-black">
              Use saved card instead
            </button>
          )}
        </div>
      )}

      <button type="button" onClick={onBack} disabled={busy} className="mt-3 w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black disabled:opacity-40">
        Back
      </button>
    </div>
  );
}
