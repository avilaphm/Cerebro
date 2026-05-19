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

interface ClientContext {
  goals: string | null;
  coaching_focus: string | null;
  favourite_foods: string[];
  foods_to_avoid: string[];
  typical_meals: Record<string, unknown> | null;
  eating_habits: Record<string, unknown> | null;
  recurring_gaps: string[];
  daily_targets: Record<string, number> | null;
}

function buildClientContextBlock(ctx: ClientContext): string {
  const lines: string[] = [];

  if (ctx.goals) lines.push(`Client goals: ${ctx.goals}`);
  if (ctx.coaching_focus) lines.push(`Coaching focus: ${ctx.coaching_focus}`);
  if (ctx.daily_targets) {
    const t = ctx.daily_targets;
    lines.push(`Daily targets: ${t.protein_g ?? '?'}g protein / ${t.carbs_g ?? '?'}g carbs / ${t.fat_g ?? '?'}g fat / ${t.fibre_g ?? '?'}g fibre / ${t.calories ?? '?'} kcal`);
  }
  if (ctx.favourite_foods?.length) lines.push(`Foods they regularly eat: ${ctx.favourite_foods.join(', ')}`);
  if (ctx.foods_to_avoid?.length) lines.push(`Foods to avoid (allergies/dislikes): ${ctx.foods_to_avoid.join(', ')}`);
  if (ctx.typical_meals) lines.push(`Typical meal patterns: ${JSON.stringify(ctx.typical_meals)}`);
  if (ctx.eating_habits) lines.push(`Eating habits: ${JSON.stringify(ctx.eating_habits)}`);
  if (ctx.recurring_gaps?.length) lines.push(`Known recurring nutrition gaps: ${ctx.recurring_gaps.join(', ')}`);

  if (lines.length === 0) return '';
  return `\nClient profile (use to improve accuracy — adjust estimates to match their typical portions and habits):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function buildPrompt(
  text: string | undefined,
  photoCount: number,
  currentTime: string,
  ctx: ClientContext,
): string {
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

  const ctxBlock = buildClientContextBlock(ctx);
  if (ctxBlock) parts.push(ctxBlock);

  if (text) parts.push(`\nWhat the client said/typed: "${text}"`);
  if (photoCount > 0) parts.push(`\nFood photos attached: ${photoCount}`);

  parts.push(`
Analyze ALL food mentioned and/or visible in photos.

Rules:
1. Create a SEPARATE entry for each distinct meal (breakfast, lunch, dinner, snack)
2. Infer meal type from what they said. If not specified, use time: morning→breakfast, midday→lunch, afternoon→snack, evening/night→dinner
3. Use the client profile above to improve portion estimates — if they regularly eat certain foods, use those typical serving sizes
4. If foods_to_avoid are present in an image, flag them gently in meal_description but still log what is visible
5. Be conservative — don't inflate calories
6. When photos are provided: identify food visible, estimate portions accounting for the plate/bowl size as reference

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

    // Verify ownership + fetch client context in parallel
    const [clientRow, nutritionDoc] = await Promise.all([
      adminClient
        .from('pt_clients')
        .select('id, goals, coaching_focus')
        .eq('id', client_id)
        .eq('user_id', authData.user.id)
        .single(),
      adminClient
        .from('pt_client_nutrition_doc')
        .select('favourite_foods, foods_to_avoid, typical_meals, eating_habits, recurring_gaps, daily_targets')
        .eq('client_id', client_id)
        .single(),
    ]);

    if (!clientRow.data) return json({ error: 'Client not found.' }, 404);

    const ctx: ClientContext = {
      goals: clientRow.data.goals ?? null,
      coaching_focus: clientRow.data.coaching_focus ?? null,
      favourite_foods: (nutritionDoc.data?.favourite_foods as string[]) ?? [],
      foods_to_avoid: (nutritionDoc.data?.foods_to_avoid as string[]) ?? [],
      typical_meals: (nutritionDoc.data?.typical_meals as Record<string, unknown>) ?? null,
      eating_habits: (nutritionDoc.data?.eating_habits as Record<string, unknown>) ?? null,
      recurring_gaps: (nutritionDoc.data?.recurring_gaps as string[]) ?? [],
      daily_targets: (nutritionDoc.data?.daily_targets as Record<string, number>) ?? null,
    };

    const now = current_time ?? new Date().toISOString();
    const prompt = buildPrompt(text, photos.length, now, ctx);

    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
    type ValidMime = typeof validMimes[number];

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
