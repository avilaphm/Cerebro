import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Tag slugs ───────────────────────────────────────────────────────────────
// Mirrors the seed in 20260510000000_lead_tags_and_pipeline.sql.

export const TAG = {
  CHAT_LEAD:           'chat_lead',
  EMAIL1_SENT:         'email1_sent',
  EMAIL1_OPENED:       'email1_opened',
  EMAIL2_SENT:         'email2_sent',
  EMAIL2_OPENED:       'email2_opened',
  PROPOSAL_VIEWED:     'proposal_viewed',
  PROPOSAL_DOWNLOADED: 'proposal_downloaded',
  CALL_BOOKED:         'call_booked',
  CALL_COMPLETED:      'call_completed',
  CLIENT:              'client',
  NOT_CLIENT:          'not_client',
  PRE_CALL_NURTURE:    'pre_call_nurture',
  POST_CALL_NURTURE:   'post_call_nurture',
  NURTURE_COMPLETE:    'nurture_complete',
  LOST:                'lost',
} as const;

export type TagSlug = typeof TAG[keyof typeof TAG];

// ─── Stage ───────────────────────────────────────────────────────────────────
// Pipeline columns. Stage 1 collapses fresh / email1 / email2 / proposal_viewed
// into a single column — the card's quad-circle indicator shows sub-progress.

export type Stage = 'stage1' | 'call_booked' | 'client' | 'nurture' | 'lost';

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'stage1',      label: 'Stage 1'     },
  { key: 'call_booked', label: 'Call Booked' },
  { key: 'client',      label: 'Client'      },
  { key: 'nurture',     label: 'Nurture'     },
  { key: 'lost',        label: 'Lost'        },
];

export function computeStage(tags: readonly string[]): Stage {
  const has = (s: TagSlug) => tags.includes(s);

  if (has(TAG.CLIENT)) return 'client';
  if (has(TAG.LOST))   return 'lost';
  if (has(TAG.NOT_CLIENT) || has(TAG.POST_CALL_NURTURE)) return 'nurture';
  if (has(TAG.CALL_COMPLETED) || has(TAG.CALL_BOOKED))   return 'call_booked';
  if (has(TAG.PRE_CALL_NURTURE))                         return 'nurture';
  return 'stage1';
}

// ─── Stage 1 sub-progress (the quad-circle on the card) ─────────────────────
// Four named milestones inside Stage 1, clockwise from 12 o'clock.

export const STAGE1_QUARTERS: { key: TagSlug; label: string }[] = [
  { key: TAG.CHAT_LEAD,       label: 'Fresh lead'      },
  { key: TAG.EMAIL1_SENT,     label: 'Email sent'      },
  { key: TAG.PROPOSAL_VIEWED, label: 'Proposal viewed' },
  { key: TAG.CALL_BOOKED,     label: 'Booking clicked' },
];

// ─── Mutations ───────────────────────────────────────────────────────────────

type Source = 'auto' | 'manual' | 'webhook' | 'system';

export async function addTag(
  supabase: SupabaseClient,
  leadId: string,
  slug: TagSlug,
  source: Source = 'manual',
  metadata?: Record<string, unknown>,
) {
  return supabase
    .from('lead_tags')
    .upsert(
      { lead_id: leadId, tag_slug: slug, source, metadata: metadata ?? null },
      { onConflict: 'lead_id,tag_slug', ignoreDuplicates: true },
    );
}

export async function removeTag(
  supabase: SupabaseClient,
  leadId: string,
  slug: TagSlug,
) {
  return supabase
    .from('lead_tags')
    .delete()
    .eq('lead_id', leadId)
    .eq('tag_slug', slug);
}

export function hasTag(tags: readonly string[], slug: TagSlug): boolean {
  return tags.includes(slug);
}
