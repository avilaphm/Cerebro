import { createClient } from 'npm:@supabase/supabase-js@2';

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

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ text?: string }>;
  }>;
  error?: { message?: string };
};

async function generateTextWithOpenAI(params: {
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
  maxOutputTokens: number;
}) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      instructions: params.instructions,
      input: params.input,
      max_output_tokens: params.maxOutputTokens,
    }),
  });

  const text = await res.text();
  let payload: OpenAIResponse;
  try {
    payload = JSON.parse(text) as OpenAIResponse;
  } catch {
    throw new Error(`OpenAI returned non-JSON response: ${text.slice(0, 300)}`);
  }

  if (!res.ok || payload.error) {
    throw new Error(payload.error?.message ?? `OpenAI request failed with ${res.status}`);
  }

  const outputText = payload.output_text
    ?? payload.output?.flatMap((item) => item.content?.map((content) => content.text ?? '') ?? []).join('\n')
    ?? '';

  if (!outputText.trim()) throw new Error('OpenAI returned an empty response');
  return outputText;
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

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'OPENAI_API_KEY is not configured' }, 500);
    const openaiModel = Deno.env.get('OPENAI_EXERCISE_IMPORT_MODEL') ?? 'gpt-4.1';

    // Step 1: extract all exercise names from the document
    const namesText = await generateTextWithOpenAI({
      apiKey: openaiKey,
      model: openaiModel,
      maxOutputTokens: 4096,
      instructions: 'Extract all exercise names from the document. Return ONLY a JSON array of strings. No markdown. No explanation.',
      input: `Document:\n${docText.slice(0, 120000)}`,
    });

    const allNames = parseJsonArray(namesText) as string[] | null;
    if (!allNames) return json({ error: 'Could not parse exercise names from document', partial: namesText.slice(0, 400) }, 500);

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
      const detailText = await generateTextWithOpenAI({
        apiKey: openaiKey,
        model: openaiModel,
        maxOutputTokens: 16000,
        instructions: DETAIL_SYSTEM,
        input: `Exercise names to extract:\n${batch.join('\n')}\n\nDocument:\n${docText.slice(0, 120000)}`,
      });

      const exercises = parseJsonArray(detailText) as Record<string, unknown>[] | null;
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
          source: 'openai-import',
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
