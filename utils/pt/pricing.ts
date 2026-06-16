// Session-pack pricing. Mirrors the server-authoritative table in
// supabase/functions/_shared/credit-pack.ts — keep both in sync.
// Tier 1 is the standard rate; tier 2 is the higher rate, set per client.

export type PriceTier = 1 | 2;
export type PackSize = 1 | 2 | 5 | 10;

export const PACK_SIZES: PackSize[] = [1, 2, 5, 10];

export const TIER_PACK_PRICES: Record<PriceTier, Record<PackSize, number>> = {
  1: { 1: 11000, 2: 22000, 5: 52500, 10: 100000 },
  2: { 1: 12000, 2: 24000, 5: 57500, 10: 110000 },
};

export const TIER_LABELS: Record<PriceTier, string> = {
  1: 'Tier 1 (standard)',
  2: 'Tier 2 (premium)',
};

export function normalizeTier(value: unknown): PriceTier {
  return value === 2 ? 2 : 1;
}

// Whole-dollar display when the price is a round dollar amount, otherwise 2dp.
function formatAud(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString('en-AU')}`
    : `$${dollars.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface PackOption {
  pack: PackSize;
  amountCents: number;
  price: string;
  per: string;
}

export function packOptionsForTier(tier: unknown): PackOption[] {
  const prices = TIER_PACK_PRICES[normalizeTier(tier)];
  return PACK_SIZES.map((pack) => ({
    pack,
    amountCents: prices[pack],
    price: formatAud(prices[pack]),
    per: `${formatAud(prices[pack] / pack)} / session`,
  }));
}
