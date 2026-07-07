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

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'];

async function isAuthorized(
  admin: ReturnType<typeof createClient>,
  userId: string,
  email: string,
  clientId: string,
): Promise<boolean> {
  if (PEDRO_EMAILS.includes(email.toLowerCase())) return true;
  const [{ data: profile }, { data: owned }] = await Promise.all([
    admin.from('profiles').select('role').eq('id', userId).maybeSingle(),
    admin.from('pt_clients').select('id').eq('id', clientId).eq('user_id', userId).maybeSingle(),
  ]);
  return profile?.role === 'admin' || !!owned?.id;
}

const DEFAULT_TARGETS = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 65, fibre_g: 30 };

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

interface RequestBody {
  client_id: string;
  meal_type: MealType;
  ingredients: string[];
  include_staples?: boolean;
  craving?: string;
  exclude?: string[]; // meal names to avoid (single-card regen / craving re-ask)
  count?: number;     // meals to return (default 5; 1 for a single regen)
}

interface Macros { calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number }

function sumLogs(rows: Array<Record<string, number | null>>): Macros {
  return rows.reduce<Macros>((acc, r) => ({
    calories: acc.calories + (Number(r.calories) || 0),
    protein_g: acc.protein_g + (Number(r.protein_g) || 0),
    carbs_g: acc.carbs_g + (Number(r.carbs_g) || 0),
    fat_g: acc.fat_g + (Number(r.fat_g) || 0),
    fibre_g: acc.fibre_g + (Number(r.fibre_g) || 0),
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 });
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function buildPrompt(input: {
  mealType: MealType;
  ingredients: string[];
  includeStaples: boolean;
  craving?: string;
  exclude: string[];
  count: number;
  goal: string | null;
  foodsToAvoid: string[];
  favouriteFoods: string[];
  targets: Macros;
  remaining: Macros;
  mode: 'full_day' | 'gap_fill';
  recentMeals: string[];
}): string {
  const {
    mealType, ingredients, includeStaples, craving, exclude, count,
    goal, foodsToAvoid, favouriteFoods, targets, remaining, mode, recentMeals,
  } = input;

  const modeBlock = mode === 'full_day'
    ? `MODE: FIRST MEAL OF THE DAY. Nothing has been logged yet, so the "remaining" numbers below are the WHOLE day's budget, not one meal. Do NOT build a meal that uses the entire day's calories. Size each option as a sensible single ${mealType} (roughly a normal portion for that meal), and in "whyThisOne" briefly teach how much of the day is left afterwards, e.g. "leaves about X kcal / Yg protein for the rest of today". Educate, don't overload the plate.`
    : `MODE: FILLING THE REMAINING GAP. The client has already eaten today. The "remaining" numbers are what is genuinely left for the rest of the day. Fit options to that remaining budget. If the remaining calories are low, keep options light and higher in protein, and say so in "whyThisOne".`;

  const cravingBlock = craving?.trim()
    ? `The client is craving: "${craving.trim()}".
- Option 1 MUST be that craving, built only from the confirmed ingredients (+ staples), adjusted to fit the macros.
- Options 2 and 3 are variations on the craving.
- The remaining options are your own best picks from the ingredients.
- If the craving needs something they do not have, use the closest available substitute and note it in the description (e.g. "no milk, using their greek yoghurt"). NEVER invent an ingredient they do not have.`
    : `No specific craving. Return ${count} diverse, genuinely different options from the confirmed ingredients.`;

  return `You are a personal nutrition coach helping a client decide what to cook for ${mealType} right now, using only what is in their kitchen.

${modeBlock}

DAILY TARGET: ${targets.calories} kcal / ${targets.protein_g}g protein / ${targets.carbs_g}g carbs / ${targets.fat_g}g fat.
REMAINING (${mode === 'full_day' ? 'whole day ahead' : 'left for the rest of today'}): ${remaining.calories} kcal / ${remaining.protein_g}g protein / ${remaining.carbs_g}g carbs / ${remaining.fat_g}g fat.
${goal ? `CLIENT GOAL: ${goal}.` : ''}

CONFIRMED INGREDIENTS (only use these${includeStaples ? ' plus basic staples: cooking oil, salt, pepper, and common dried herbs/spices' : ', no staples assumed'}):
${ingredients.map((i) => `- ${i}`).join('\n') || '- (none provided)'}

${foodsToAvoid.length ? `NEVER include these (allergies/dislikes): ${foodsToAvoid.join(', ')}.` : ''}
${favouriteFoods.length ? `They tend to enjoy: ${favouriteFoods.join(', ')}.` : ''}
${recentMeals.length ? `Avoid repeating what they ate recently: ${recentMeals.slice(0, 12).join('; ')}.` : ''}
${exclude.length ? `Do NOT suggest these (already shown): ${exclude.join('; ')}.` : ''}

${cravingBlock}

RULES:
- Only use the confirmed ingredients${includeStaples ? ' and the basic staples listed' : ''}. Never invent ingredients.
- At least one option must take under 15 minutes to prepare.
- Macros are estimates. Give realistic per-serving numbers for one person.
- Keep steps short and practical (3-7 steps).
- "whyThisOne" is one sentence tying the option to their macros/goal.

Return ONLY valid JSON (no other text), with EXACTLY ${count} meal(s):
{
  "meals": [
    {
      "name": "string",
      "description": "one line, mention any substitution",
      "whyThisOne": "one sentence tied to their remaining macros/goal",
      "prepTimeMinutes": number,
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "ingredients": [{ "name": "string", "quantity": "e.g. 100g / 1 cup" }],
      "steps": ["string"]
    }
  ]
}`;
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

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const body = (await req.json()) as RequestBody;
    const { client_id, meal_type, ingredients = [], include_staples = true, craving, exclude = [] } = body;
    const count = Math.max(1, Math.min(5, Number(body.count) || 5));

    if (!client_id) return json({ ok: false, error: 'Missing client_id.' }, 400);
    if (!meal_type) return json({ ok: false, error: 'Missing meal type.' }, 400);
    if (ingredients.length === 0) return json({ ok: false, error: 'No confirmed ingredients to work with.' });

    const authorized = await isAuthorized(adminClient, authData.user.id, authData.user.email ?? '', client_id);
    if (!authorized) return json({ ok: false, error: 'This login is not linked to that client. Log in as the client to continue.' });

    const [clientRow, nutritionDoc, todayRes, recentRes] = await Promise.all([
      adminClient.from('pt_clients').select('goals').eq('id', client_id).maybeSingle(),
      adminClient.from('pt_client_nutrition_doc').select('daily_targets, foods_to_avoid, favourite_foods').eq('client_id', client_id).maybeSingle(),
      adminClient.from('pt_nutrition_logs').select('calories, protein_g, carbs_g, fat_g, fibre_g').eq('client_id', client_id).gte('logged_at', startOfTodayISO()),
      adminClient.from('pt_nutrition_logs').select('meal_description, logged_at').eq('client_id', client_id).gte('logged_at', new Date(Date.now() - 3 * 86400000).toISOString()).order('logged_at', { ascending: false }).limit(20),
    ]);

    const rawTargets = (nutritionDoc.data?.daily_targets as Partial<Macros>) ?? {};
    const targets: Macros = { ...DEFAULT_TARGETS, ...rawTargets };
    const consumed = sumLogs((todayRes.data as Array<Record<string, number | null>>) ?? []);
    const remaining: Macros = {
      calories: Math.max(0, Math.round(targets.calories - consumed.calories)),
      protein_g: Math.max(0, Math.round(targets.protein_g - consumed.protein_g)),
      carbs_g: Math.max(0, Math.round(targets.carbs_g - consumed.carbs_g)),
      fat_g: Math.max(0, Math.round(targets.fat_g - consumed.fat_g)),
      fibre_g: Math.max(0, Math.round(targets.fibre_g - consumed.fibre_g)),
    };
    const mode: 'full_day' | 'gap_fill' = consumed.calories <= 0 ? 'full_day' : 'gap_fill';
    const recentMeals = ((recentRes.data as Array<{ meal_description: string | null }>) ?? [])
      .map((r) => r.meal_description).filter((d): d is string => !!d);

    const prompt = buildPrompt({
      mealType: meal_type,
      ingredients,
      includeStaples: include_staples,
      craving,
      exclude,
      count,
      goal: (clientRow.data?.goals as string) ?? null,
      foodsToAvoid: (nutritionDoc.data?.foods_to_avoid as string[]) ?? [],
      favouriteFoods: (nutritionDoc.data?.favourite_foods as string[]) ?? [],
      targets,
      remaining,
      mode,
      recentMeals,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (!objectMatch) return json({ ok: false, error: 'Could not build meal options. Please try again.' });

    let parsed: { meals?: unknown };
    try {
      parsed = JSON.parse(objectMatch[0]) as { meals?: unknown };
    } catch {
      return json({ ok: false, error: 'Could not build meal options. Please try again.' });
    }

    const rawMeals = Array.isArray(parsed.meals) ? parsed.meals : [];
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
    const meals = rawMeals.slice(0, count).map((m) => {
      const r = (m ?? {}) as Record<string, unknown>;
      return {
        name: typeof r.name === 'string' ? r.name : 'Meal',
        description: typeof r.description === 'string' ? r.description : '',
        whyThisOne: typeof r.whyThisOne === 'string' ? r.whyThisOne : '',
        prepTimeMinutes: num(r.prepTimeMinutes),
        calories: num(r.calories),
        protein: num(r.protein),
        carbs: num(r.carbs),
        fat: num(r.fat),
        ingredients: Array.isArray(r.ingredients)
          ? r.ingredients.map((it) => {
              const o = (it ?? {}) as Record<string, unknown>;
              return { name: typeof o.name === 'string' ? o.name : '', quantity: typeof o.quantity === 'string' ? o.quantity : '' };
            }).filter((it) => it.name)
          : [],
        steps: Array.isArray(r.steps) ? r.steps.filter((s): s is string => typeof s === 'string') : [],
      };
    }).filter((m) => m.name);

    if (meals.length === 0) return json({ ok: false, error: 'No meal options came back. Please try again.' });

    return json({ ok: true, meals, context: { mode, remaining, targets, consumed } });
  } catch (err) {
    console.error('suggest-next-meal error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
