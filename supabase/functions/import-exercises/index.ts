import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseJsonArray(text: string): unknown[] | null {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
  } catch {
    const match = t.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const v = JSON.parse(match[0]);
        if (Array.isArray(v)) return v;
      } catch { /* fall through */ }
    }
  }
  return null;
}

const DETAIL_SYSTEM = `You are a fitness exercise data extractor. Given a document and a list of exercise names, extract full structured data for ONLY the listed exercises.

For each exercise return:
- name: exact exercise name from the list (string)
- primary_muscles: primary muscles (string array, use: Glutes, Hamstrings, Quadriceps, Calves, Core, Lower Back, Upper Back, Lats, Traps, Chest, Shoulders, Biceps, Triceps, Forearms)
- secondary_muscles: secondary muscles (string array)
- equipment: one of bodyweight/barbell/dumbbells/kettlebell/cable machine/resistance band/machine/TRX/foam roller/stability ball — or null
- video_url: full YouTube URL from document or null
- cues: verbal coaching cues during movement (string array, max 6)
- setup_cues: setup steps in order (string array, max 6)
- tags: from strength-compound/strength-isolation/core/mobility/cardio/golf/running/pilates (string array)
- conditions: conditions this exercise suits e.g. "lower back pain" (string array)

Return ONLY a valid JSON array. No markdown. No explanation. Start with [ end with ].`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const userSupa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json() as { document_text?: string };
    if (!body.document_text || body.document_text.trim().length < 10) {
      return json({ error: 'document_text required' }, 400);
    }
    const docText = body.document_text.trim();

    const { data: existing } = await admin.from('pt_exercises').select('name');
    const existingSet = new Set((existing ?? []).map((e: { name: string }) => e.name.toLowerCase().trim()));

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    // Step 1: extract all exercise names from the document
    const namesMsg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'Extract all exercise names from the document. Return ONLY a JSON array of strings. No markdown. No explanation.',
      messages: [{
        role: 'user',
        content: `Document:\n${docText.slice(0, 120000)}`,
      }],
    });

    const namesContent = namesMsg.content[0];
    if (namesContent.type !== 'text') return json({ error: 'Unexpected AI response' }, 500);

    const allNames = parseJsonArray(namesContent.text) as string[] | null;
    if (!allNames) return json({ error: 'Could not parse exercise names from document', partial: namesContent.text.slice(0, 400) }, 500);

    const newNames = allNames.filter((n) => typeof n === 'string' && n.trim().length > 0 && !existingSet.has(n.toLowerCase().trim()));
    const skipped = allNames.length - newNames.length;

    if (newNames.length === 0) {
      return json({ added: 0, skipped, message: 'All exercises in the document already exist in the library' });
    }

    // Step 2: extract full details in batches of 50
    const BATCH = 50;
    let totalAdded = 0;
    const addedNames: string[] = [];

    for (let i = 0; i < newNames.length; i += BATCH) {
      const batch = newNames.slice(i, i + BATCH);
      const detailMsg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: DETAIL_SYSTEM,
        messages: [{
          role: 'user',
          content: `Exercise names to extract:\n${batch.join('\n')}\n\nDocument:\n${docText.slice(0, 120000)}`,
        }],
      });

      const detailContent = detailMsg.content[0];
      if (detailContent.type !== 'text') continue;

      const exercises = parseJsonArray(detailContent.text) as Record<string, unknown>[] | null;
      if (!exercises) continue;

      const toInsert = exercises
        .filter((ex) => ex.name && typeof ex.name === 'string')
        .map((ex) => ({
          name: ex.name as string,
          primary_muscles: (ex.primary_muscles as string[]) ?? [],
          secondary_muscles: (ex.secondary_muscles as string[]) ?? [],
          muscles: [...((ex.primary_muscles as string[]) ?? []), ...((ex.secondary_muscles as string[]) ?? [])],
          equipment: (ex.equipment as string) ?? null,
          video_url: (ex.video_url as string) ?? null,
          cues: (ex.cues as string[]) ?? [],
          setup_cues: (ex.setup_cues as string[]) ?? [],
          tags: (ex.tags as string[]) ?? [],
          conditions: (ex.conditions as string[]) ?? [],
          progression_ids: [] as string[],
          regression_ids: [] as string[],
          purpose: null,
          source: 'ai',
        }));

      if (toInsert.length === 0) continue;

      const { data: inserted, error: insertErr } = await admin
        .from('pt_exercises')
        .insert(toInsert)
        .select('name');

      if (insertErr) {
        return json({ error: insertErr.message, added: totalAdded, skipped }, 500);
      }
      totalAdded += inserted?.length ?? 0;
      addedNames.push(...(inserted?.map((e: { name: string }) => e.name) ?? []));
    }

    return json({ added: totalAdded, skipped, exercises: addedNames });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
