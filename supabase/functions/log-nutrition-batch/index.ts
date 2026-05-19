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

interface PhotoInput {
  base64: string;
  mime_type: string;
}

interface RequestBody {
  client_id: string;
  text?: string;
  photos?: PhotoInput[];
  current_time?: string;
}

interface MealResult {
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  meal_description: string;
  food_items: Array<{ name: string; quantity: string; unit: string }>;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  calories: number | null;
  confidence: 'high' | 'medium' | 'low';
}

function buildPrompt(text: string | undefined, photoCount: number, currentTime: string): string {
  const hour = new Date(currentTime).getHours();
  const timeHint =
    hour < 6 ? 'late night'
    : hour < 11 ? 'morning'
    : hour < 14 ? 'midday'
    : hour < 17 ? 'afternoon'
    : hour < 21 ? 'evening'
    : 'night';

  const parts: string[] = [
    `You are a nutrition tracking assistant. Current time: ${currentTime} (${timeHint}).`,
  ];

  if (text) parts.push(`\nUser said/typed: "${text}"`);
  if (photoCount > 0) parts.push(`\nFood photos attached: ${photoCount}`);

  parts.push(`
Analyze ALL food mentioned and/or visible in photos.

Rules:
1. Create a SEPARATE entry for each distinct meal (breakfast, lunch, dinner, snack)
2. Infer meal type from what they said. If not specified, use time: morning→breakfast, midday→lunch, afternoon→snack, evening/night→dinner
3. Use realistic portion estimates when amounts are not given
4. When photos are provided, identify what food is visible and estimate portions
5. Be conservative — don't inflate calories

Return ONLY a valid JSON array (no other text):
[
  {
    "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
    "meal_description": "brief description of this meal",
    "food_items": [{"name": "food", "quantity": "100", "unit": "g"}],
    "protein_g": number or null,
    "carbs_g": number or null,
    "fat_g": number or null,
    "fibre_g": number or null,
    "calories": number or null,
    "confidence": "high" | "medium" | "low"
  }
]

Return [] if no food can be identified.`);

  return parts.join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const body = (await req.json()) as RequestBody;
    const { client_id, text, photos = [], current_time } = body;

    if (!client_id) return json({ error: 'Missing client_id.' }, 400);
    if (!text?.trim() && photos.length === 0) return json({ error: 'No food data provided.' }, 400);

    // Verify ownership
    const { data: clientRow } = await adminClient
      .from('pt_clients')
      .select('id')
      .eq('id', client_id)
      .eq('user_id', authData.user.id)
      .single();
    if (!clientRow) return json({ error: 'Client not found.' }, 404);

    const now = current_time ?? new Date().toISOString();
    const prompt = buildPrompt(text, photos.length, now);

    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
    type ValidMime = typeof validMimes[number];

    // Build content blocks: photos first, then text prompt
    const contentBlocks: Anthropic.MessageParam['content'] = [
      ...photos.slice(0, 10).map((p): Anthropic.Messages.ImageBlockParam => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: (validMimes as readonly string[]).includes(p.mime_type)
            ? (p.mime_type as ValidMime)
            : 'image/jpeg',
          data: p.base64,
        },
      })),
      { type: 'text', text: prompt },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return json({ ok: false, error: 'Could not parse food from this input.' });

    let meals: MealResult[];
    try {
      meals = JSON.parse(arrayMatch[0]) as MealResult[];
    } catch {
      return json({ ok: false, error: 'Could not parse food from this input.' });
    }

    if (!Array.isArray(meals) || meals.length === 0) {
      return json({ ok: false, error: 'No food could be identified. Please describe what you ate more clearly.' });
    }

    const inputType = photos.length > 0 ? 'photo' : 'text';
    const rawTranscript = text ?? null;

    const rows = meals.map((m) => ({
      client_id,
      input_type: inputType,
      raw_transcript: rawTranscript,
      meal_description: m.meal_description,
      food_items: m.food_items,
      protein_g: m.protein_g,
      carbs_g: m.carbs_g,
      fat_g: m.fat_g,
      fibre_g: m.fibre_g,
      calories: m.calories,
      confidence: m.confidence,
      meal_type: m.meal_type,
    }));

    const { data: inserted, error: insertError } = await adminClient
      .from('pt_nutrition_logs')
      .insert(rows)
      .select('id');

    if (insertError) {
      console.error('log-nutrition-batch insert error:', insertError);
      return json({ error: 'Failed to save nutrition logs.' }, 500);
    }

    // Rolling 28-day purge
    const purgeDate = new Date();
    purgeDate.setDate(purgeDate.getDate() - 28);
    void adminClient
      .from('pt_nutrition_logs')
      .delete()
      .eq('client_id', client_id)
      .lt('logged_at', purgeDate.toISOString());

    // Update weekly averages on nutrition doc
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: recentLogs } = await adminClient
      .from('pt_nutrition_logs')
      .select('protein_g, carbs_g, fat_g, fibre_g, calories')
      .eq('client_id', client_id)
      .gte('logged_at', sevenDaysAgo.toISOString())
      .not('calories', 'is', null);

    if (recentLogs && recentLogs.length > 0) {
      const avg = {
        protein_g: Math.round(recentLogs.reduce((s, l) => s + (l.protein_g ?? 0), 0) / recentLogs.length),
        carbs_g: Math.round(recentLogs.reduce((s, l) => s + (l.carbs_g ?? 0), 0) / recentLogs.length),
        fat_g: Math.round(recentLogs.reduce((s, l) => s + (l.fat_g ?? 0), 0) / recentLogs.length),
        fibre_g: Math.round(recentLogs.reduce((s, l) => s + (l.fibre_g ?? 0), 0) / recentLogs.length),
        calories: Math.round(recentLogs.reduce((s, l) => s + (l.calories ?? 0), 0) / recentLogs.length),
        entries: recentLogs.length,
      };
      void adminClient
        .from('pt_client_nutrition_doc')
        .update({ current_week_avg: avg, updated_at: new Date().toISOString() })
        .eq('client_id', client_id);
    }

    return json({ ok: true, count: meals.length, logs: (inserted ?? []) as Array<{ id: string }> });
  } catch (err) {
    console.error('log-nutrition-batch error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
