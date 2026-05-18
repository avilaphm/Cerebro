import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import OpenAI from 'npm:openai@4';

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

interface RequestBody {
  client_id: string;
  input_type: 'photo' | 'voice' | 'text';
  content: string;
  file_base64?: string;
  file_mime_type?: string;
  source_message_id?: string;
}

interface NutritionResult {
  meal_description: string;
  food_items: Array<{ name: string; quantity: string; unit: string }>;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  calories: number | null;
  meal_type: string | null;
  confidence: 'high' | 'medium' | 'low';
}

const NUTRITION_PARSE_PROMPT = `You are a nutrition tracking assistant. Parse the food description and estimate macros.

Be realistic and conservative in estimates. If the portion size is unclear, assume a standard serving.

Return ONLY valid JSON:
{
  "meal_description": "concise description of the meal",
  "food_items": [{"name": "food name", "quantity": "amount", "unit": "g/cup/piece/etc"}],
  "protein_g": number or null,
  "carbs_g": number or null,
  "fat_g": number or null,
  "fibre_g": number or null,
  "calories": number or null,
  "meal_type": "breakfast" | "lunch" | "dinner" | "snack" | null,
  "confidence": "high" | "medium" | "low"
}

confidence is "high" when specific amounts are given, "medium" for typical servings, "low" for vague descriptions.`;

async function parseTextNutrition(text: string, anthropic: Anthropic): Promise<NutritionResult | null> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `${NUTRITION_PARSE_PROMPT}\n\nFood description: "${text}"`,
        },
      ],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as NutritionResult;
  } catch {
    return null;
  }
}

async function parsePhotoNutrition(
  imageBase64: string,
  mimeType: string,
  anthropic: Anthropic,
): Promise<NutritionResult | null> {
  try {
    const validMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
    type ValidMime = typeof validMime[number];
    const safeMediaType = (validMime as readonly string[]).includes(mimeType)
      ? (mimeType as ValidMime)
      : 'image/jpeg';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: safeMediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `${NUTRITION_PARSE_PROMPT}\n\nDescribe the food in this image and estimate the macros.`,
            },
          ],
        },
      ],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as NutritionResult;
  } catch {
    return null;
  }
}

async function transcribeVoice(audioBase64: string, mimeType: string, openai: OpenAI): Promise<string | null> {
  try {
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
    const buffer = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([buffer], { type: mimeType });
    const file = new File([blob], `audio.${ext}`, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });
    return transcription.text;
  } catch {
    return null;
  }
}

async function storeFile(
  base64: string,
  mimeType: string,
  clientId: string,
  inputType: 'photo' | 'voice',
  adminClient: ReturnType<typeof createClient>,
): Promise<string | null> {
  try {
    const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
    const path = `${clientId}/${inputType}/${Date.now()}.${ext}`;
    const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const { error } = await adminClient.storage
      .from('pt-nutrition-logs')
      .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (error) return null;
    return path;
  } catch {
    return null;
  }
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
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const openai = new OpenAI({ apiKey: openaiKey });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const body = (await req.json()) as RequestBody;
    const { client_id, input_type, content, file_base64, file_mime_type, source_message_id } = body;

    if (!client_id || !input_type) return json({ error: 'Missing required fields.' }, 400);

    // Verify client ownership
    const { data: clientRow } = await adminClient
      .from('pt_clients')
      .select('id')
      .eq('id', client_id)
      .eq('user_id', authData.user.id)
      .single();

    if (!clientRow) return json({ error: 'Client not found.' }, 404);

    let rawInputUrl: string | null = null;
    let rawTranscript: string | null = null;
    let nutrition: NutritionResult | null = null;

    if (input_type === 'photo' && file_base64 && file_mime_type) {
      [rawInputUrl, nutrition] = await Promise.all([
        storeFile(file_base64, file_mime_type, client_id, 'photo', adminClient),
        parsePhotoNutrition(file_base64, file_mime_type, anthropic),
      ]);
    } else if (input_type === 'voice' && file_base64 && file_mime_type) {
      rawTranscript = await transcribeVoice(file_base64, file_mime_type, openai);
      const [storedPath, parsedNutrition] = await Promise.all([
        storeFile(file_base64, file_mime_type, client_id, 'voice', adminClient),
        rawTranscript ? parseTextNutrition(rawTranscript, anthropic) : Promise.resolve(null),
      ]);
      rawInputUrl = storedPath;
      nutrition = parsedNutrition;
    } else {
      // text
      rawTranscript = content;
      nutrition = await parseTextNutrition(content, anthropic);
    }

    if (!nutrition) {
      return json({ ok: false, error: 'Could not parse nutrition from this input.' });
    }

    // Insert nutrition log
    const { data: logRow, error: insertError } = await adminClient
      .from('pt_nutrition_logs')
      .insert({
        client_id,
        input_type,
        raw_input_url: rawInputUrl,
        raw_transcript: rawTranscript,
        meal_description: nutrition.meal_description,
        food_items: nutrition.food_items,
        protein_g: nutrition.protein_g,
        carbs_g: nutrition.carbs_g,
        fat_g: nutrition.fat_g,
        fibre_g: nutrition.fibre_g,
        calories: nutrition.calories,
        confidence: nutrition.confidence,
        meal_type: nutrition.meal_type,
        source_message_id: source_message_id ?? null,
      })
      .select('id')
      .single();

    // 4-week rolling window: purge entries older than 28 days
    const purgeDate = new Date();
    purgeDate.setDate(purgeDate.getDate() - 28);
    void adminClient
      .from('pt_nutrition_logs')
      .delete()
      .eq('client_id', client_id)
      .lt('logged_at', purgeDate.toISOString());

    if (insertError) {
      console.error('log-nutrition insert error:', insertError);
      return json({ error: 'Failed to save nutrition log.' }, 500);
    }

    // Update nutrition doc averages (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentLogs } = await adminClient
      .from('pt_nutrition_logs')
      .select('protein_g, carbs_g, fat_g, fibre_g, calories')
      .eq('client_id', client_id)
      .gte('logged_at', sevenDaysAgo.toISOString())
      .not('calories', 'is', null);

    if (recentLogs && recentLogs.length > 0) {
      const logs = recentLogs as Array<{ protein_g: number | null; carbs_g: number | null; fat_g: number | null; fibre_g: number | null; calories: number | null }>;
      const avg = {
        protein_g: Math.round(logs.reduce((s, l) => s + (l.protein_g ?? 0), 0) / logs.length),
        carbs_g: Math.round(logs.reduce((s, l) => s + (l.carbs_g ?? 0), 0) / logs.length),
        fat_g: Math.round(logs.reduce((s, l) => s + (l.fat_g ?? 0), 0) / logs.length),
        fibre_g: Math.round(logs.reduce((s, l) => s + (l.fibre_g ?? 0), 0) / logs.length),
        calories: Math.round(logs.reduce((s, l) => s + (l.calories ?? 0), 0) / logs.length),
        entries: logs.length,
      };

      await adminClient
        .from('pt_client_nutrition_doc')
        .update({ current_week_avg: avg, updated_at: new Date().toISOString() })
        .eq('client_id', client_id);
    }

    return json({
      ok: true,
      log_id: (logRow as { id: string }).id,
      nutrition,
    });
  } catch (err) {
    console.error('log-nutrition error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
