import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Tag slugs ───────────────────────────────────────────────────────────────
// Mirrors the seed in 20260510000000_lead_tags_and_pipeline.sql.
// Keep this list in sync with the `tags` table.

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

export type Stage =
  | 'fresh'
  | 'email1_sent'
  | 'email2_sent'
  | 'proposal_viewed'
  | 'call_booked'
  | 'client'
  | 'nurture'
  | 'lost';

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'fresh',           label: 'Fresh Lead'      },
  { key: 'email1_sent',     label: 'Email 1 Sent'    },
  { key: 'email2_sent',     label: 'Email 2 Sent'    },
  { key: 'proposal_viewed', label: 'Proposal Viewed' },
  { key: 'call_booked',     label: 'Call Booked'     },
  { key: 'client',          label: 'Client'          },
  { key: 'nurture',         label: 'Nurture'         },
  { key: 'lost',            label: 'Lost'            },
];

const PROGRESS: Stage[] = [
  'fresh',
  'email1_sent',
  'email2_sent',
  'proposal_viewed',
  'call_booked',
  'client',
];

export function progressIndex(stage: Stage): number {
  return PROGRESS.indexOf(stage);
}

export function progressStages(): Stage[] {
  return PROGRESS;
}

// Mirrors the SQL function lead_stage() in 20260510000000_lead_tags_and_pipeline.sql.
// Keeping a TS twin lets the dashboard compute stage from in-memory tags
// without round-tripping to the DB after a tag toggle.
export function computeStage(tags: readonly string[]): Stage {
  const has = (s: TagSlug) => tags.includes(s);

  if (has(TAG.CLIENT)) return 'client';
  if (has(TAG.LOST))   return 'lost';
  if (has(TAG.NOT_CLIENT) || has(TAG.POST_CALL_NURTURE)) return 'nurture';
  if (has(TAG.CALL_COMPLETED) || has(TAG.CALL_BOOKED))   return 'call_booked';
  if (has(TAG.PRE_CALL_NURTURE))                         return 'nurture';
  if (has(TAG.PROPOSAL_DOWNLOADED) || has(TAG.PROPOSAL_VIEWED)) return 'proposal_viewed';
  if (has(TAG.EMAIL2_OPENED) || has(TAG.EMAIL2_SENT))    return 'email2_sent';
  if (has(TAG.EMAIL1_OPENED) || has(TAG.EMAIL1_SENT))    return 'email1_sent';
  return 'fresh';
}

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
