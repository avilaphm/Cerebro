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
  photos?: PhotoInput[];
}

const CATEGORIES = ['protein', 'vegetables', 'fruit', 'carbs', 'dairy', 'condiments', 'other'] as const;
type Category = typeof CATEGORIES[number];

interface DetectedIngredient {
  name: string;
  category: Category;
  confidence: 'high' | 'medium' | 'low';
}

const PROMPT = `You are a kitchen-inventory assistant. The attached photos show the inside of a client's fridge, freezer, and/or pantry.

Task: list the distinct FOOD ingredients you can actually see that could be cooked with. This is an inventory, not a recipe.

Rules:
- Only list items you can genuinely see. Never invent or assume items that are not visible.
- One entry per distinct ingredient. Merge duplicates across photos (if eggs appear twice, list "eggs" once).
- Use short, common ingredient names ("chicken breast", "cheddar", "baby spinach"), not brands or full product marketing names.
- Do NOT list basic staples (cooking oil, salt, pepper, common dried spices) — those are assumed separately.
- Ignore clearly non-food items, cleaning products, and drinks with no cooking use (plain water, soft drink).
- category must be exactly one of: ${CATEGORIES.join(', ')}.
- confidence: "high" if the item is clearly identifiable, "medium" if likely but partly obscured, "low" if you are guessing from a glimpse or a label.

Return ONLY valid JSON (no other text):
{
  "ingredients": [
    { "name": "chicken breast", "category": "protein", "confidence": "high" }
  ]
}

Return {"ingredients": []} if no food can be identified.`;

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
    const { client_id, photos = [] } = body;

    if (!client_id) return json({ error: 'Missing client_id.' }, 400);
    if (photos.length === 0) return json({ error: 'Add at least one photo of your fridge or pantry.' }, 400);

    // Verify the caller owns this client record.
    const { data: clientRow } = await adminClient
      .from('pt_clients')
      .select('id')
      .eq('id', client_id)
      .eq('user_id', authData.user.id)
      .single();
    if (!clientRow) return json({ error: 'Client not found.' }, 404);

    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
    type ValidMime = typeof validMimes[number];

    const contentBlocks: Anthropic.MessageParam['content'] = [
      ...photos.slice(0, 5).map((p): Anthropic.Messages.ImageBlockParam => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: (validMimes as readonly string[]).includes(p.mime_type)
            ? (p.mime_type as ValidMime)
            : 'image/jpeg',
          data: p.base64,
        },
      })),
      { type: 'text', text: PROMPT },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (!objectMatch) return json({ ok: false, error: 'Could not read the photos. Try clearer, well-lit shots.' });

    let parsed: { ingredients?: unknown };
    try {
      parsed = JSON.parse(objectMatch[0]) as { ingredients?: unknown };
    } catch {
      return json({ ok: false, error: 'Could not read the photos. Try clearer, well-lit shots.' });
    }

    const rawList = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
    const seen = new Set<string>();
    const ingredients: DetectedIngredient[] = [];
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const category = CATEGORIES.includes(record.category as Category)
        ? (record.category as Category)
        : 'other';
      const confidence = record.confidence === 'high' || record.confidence === 'low' ? record.confidence : 'medium';
      ingredients.push({ name, category, confidence });
    }

    return json({ ok: true, ingredients });
  } catch (err) {
    console.error('detect-fridge-ingredients error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
