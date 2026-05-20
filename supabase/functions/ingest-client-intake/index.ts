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

const SYSTEM_PROMPT = `You are the Client Intake Distributor inside Pedro Avila's Cerebro coaching system.
You receive raw text from up to three uploaded documents, plus coach notes and voice transcript about one client.
Your job: produce a single JSON object that fills the four client "brain" docs without inventing facts.

OUTPUT FORMAT (JSON only, no prose, no markdown fences):
{
  "master": {
    "summary_current": string,                 // 2-4 sentence snapshot: who they are, what they want
    "personality_notes": object,               // 1-4 short keyed observations, e.g. { "communication": "direct" }
    "key_phrases": string[],                   // 3-8 short phrases the client used in their own words
    "milestones": { "id": string, "label": string, "timeframe": string }[],
    "open_loops": string[],                    // things the coach said they want to revisit / unresolved questions
    "important_decisions": string[]            // coach decisions worth remembering long-term
  },
  "nutrition": {
    "typical_meals": { "name": string, "notes": string }[],
    "favourite_foods": string[],
    "foods_to_avoid": string[],
    "nutrition_obstacles": string,
    "eating_habits": object,                   // patterns: snacking, late meals, alcohol, etc
    "recent_wins": string[],
    "recurring_gaps": string[]
  },
  "exercise": {
    "strong_movements": string[],
    "weak_movements": string[],
    "disliked_exercises": string[],
    "injury_history": { "area": string, "status": "active"|"resolved"|"managed", "notes": string }[],
    "current_limitations": string,
    "movement_assessment_summary": object,     // asymmetries, posture, mobility, instability findings
    "progression_strategy": object             // short coach intent for the first phase
  },
  "lifestyle": {
    "sleep_baseline": object,                  // hours, quality, consistency
    "stress_patterns": string,
    "schedule_notes": string,                  // training windows, work, family
    "social_context": string,
    "recurring_challenges": string[],
    "wins": string[],
    "goals_context": string                    // long-term context behind training goals
  }
}

RULES:
- DO NOT invent facts. If a field has no source evidence, return an empty string / empty array / empty object.
- Quote phrases the client actually used inside key_phrases.
- Route nutrition content to nutrition, training to exercise, sleep/stress/schedule to lifestyle, identity/goals/motivation to master.
- Output minified JSON.`;

interface IngestInput {
  client_id?: string;
  notes_text?: string;
  voice_transcript?: string;
  files?: Array<{ name?: string; document_type?: string; content_text?: string }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as IngestInput;
    if (!body.client_id) return json({ error: 'client_id required' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const files = (body.files ?? []).filter((f) => (f.content_text ?? '').trim().length > 0).slice(0, 3);
    const trimmedNotes = (body.notes_text ?? '').trim();
    const trimmedVoice = (body.voice_transcript ?? '').trim();

    if (files.length === 0 && !trimmedNotes && !trimmedVoice) {
      return json({ error: 'Need at least one file, note, or voice transcript' }, 400);
    }

    const allowedDocType = (t: string | undefined): 'intake' | 'movement_assessment' | 'profile' | 'other' => {
      if (t === 'intake' || t === 'movement_assessment' || t === 'profile' || t === 'other') return t;
      return 'intake';
    };

    const storedDocs: { id: string; document_type: string }[] = [];
    for (const file of files) {
      const { data, error } = await admin
        .from('pt_client_documents')
        .insert({
          client_id: body.client_id,
          document_type: allowedDocType(file.document_type),
          title: file.name ?? 'Intake document',
          content_text: file.content_text,
          status: 'analysed',
        })
        .select('id, document_type')
        .single();
      if (error) {
        console.warn('pt_client_documents insert failed:', error.message);
        continue;
      }
      storedDocs.push(data);
    }

    if (trimmedNotes) {
      await admin
        .from('pt_client_documents')
        .insert({
          client_id: body.client_id,
          document_type: 'other',
          title: 'Coach intake notes',
          content_text: trimmedNotes,
          status: 'analysed',
        });
    }
    if (trimmedVoice) {
      await admin
        .from('pt_client_documents')
        .insert({
          client_id: body.client_id,
          document_type: 'other',
          title: 'Coach voice notes',
          content_text: trimmedVoice,
          status: 'analysed',
        });
    }

    const fileBlock = files
      .map((f, i) => `# Uploaded document ${i + 1}: ${f.name ?? 'untitled'} (${f.document_type ?? 'intake'})\n${(f.content_text ?? '').slice(0, 12000)}`)
      .join('\n\n');
    const noteBlock = trimmedNotes ? `# Coach notes\n${trimmedNotes.slice(0, 8000)}` : '';
    const voiceBlock = trimmedVoice ? `# Coach voice transcript\n${trimmedVoice.slice(0, 8000)}` : '';

    const userMessage = [fileBlock, noteBlock, voiceBlock].filter(Boolean).join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (msg.content[0] as { text: string }).text;
    const distribution = parseJson(text);
    if (!distribution) return json({ error: 'Intake distributor did not return valid JSON', raw: text }, 502);

    const master = (distribution.master ?? {}) as Record<string, unknown>;
    const nutrition = (distribution.nutrition ?? {}) as Record<string, unknown>;
    const exercise = (distribution.exercise ?? {}) as Record<string, unknown>;
    const lifestyle = (distribution.lifestyle ?? {}) as Record<string, unknown>;

    const writes = await Promise.all([
      admin.from('pt_client_brain').upsert({
        client_id: body.client_id,
        summary_current: asString(master.summary_current),
        personality_notes: asJsonb(master.personality_notes, {}),
        key_phrases: asTextArray(master.key_phrases),
        milestones: asJsonb(master.milestones, []),
        open_loops: asJsonb(master.open_loops, []),
        important_decisions: asJsonb(master.important_decisions, []),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' }),
      admin.from('pt_client_nutrition_doc').upsert({
        client_id: body.client_id,
        typical_meals: asJsonb(nutrition.typical_meals, []),
        favourite_foods: asTextArray(nutrition.favourite_foods),
        foods_to_avoid: asTextArray(nutrition.foods_to_avoid),
        nutrition_obstacles: asString(nutrition.nutrition_obstacles),
        eating_habits: asJsonb(nutrition.eating_habits, {}),
        recent_wins: asTextArray(nutrition.recent_wins),
        recurring_gaps: asTextArray(nutrition.recurring_gaps),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' }),
      admin.from('pt_client_exercise_doc').upsert({
        client_id: body.client_id,
        strong_movements: asTextArray(exercise.strong_movements),
        weak_movements: asTextArray(exercise.weak_movements),
        disliked_exercises: asTextArray(exercise.disliked_exercises),
        injury_history: asJsonb(exercise.injury_history, []),
        current_limitations: asString(exercise.current_limitations),
        movement_assessment_summary: asJsonb(exercise.movement_assessment_summary, {}),
        progression_strategy: asJsonb(exercise.progression_strategy, {}),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' }),
      admin.from('pt_client_lifestyle_doc').upsert({
        client_id: body.client_id,
        sleep_baseline: asJsonb(lifestyle.sleep_baseline, {}),
        stress_patterns: asString(lifestyle.stress_patterns),
        schedule_notes: asString(lifestyle.schedule_notes),
        social_context: asString(lifestyle.social_context),
        recurring_challenges: asTextArray(lifestyle.recurring_challenges),
        wins: asJsonb(lifestyle.wins, []),
        goals_context: asString(lifestyle.goals_context),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' }),
    ]);

    const writeErrors = writes.filter((w) => w.error).map((w) => w.error!.message);
    if (writeErrors.length > 0) {
      return json({ error: 'Brain doc upsert errors', details: writeErrors }, 500);
    }

    queueEmbed(supabaseUrl, serviceKey, body.client_id);

    return json({
      ok: true,
      client_id: body.client_id,
      distributed_into: ['master', 'nutrition', 'exercise', 'lifestyle'],
      documents_stored: storedDocs.length + (trimmedNotes ? 1 : 0) + (trimmedVoice ? 1 : 0),
    });
  } catch (error) {
    console.error('ingest-client-intake error:', error);
    return json({ error: error instanceof Error ? error.message : 'Ingest failed' }, 500);
  }
});

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  return null;
}

function asTextArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function asJsonb(v: unknown, fallback: unknown): unknown {
  if (v === null || v === undefined) return fallback;
  return v;
}

function parseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* noop */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* noop */ } }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* noop */ } }
  return null;
}

function queueEmbed(supabaseUrl: string, serviceKey: string, clientId: string) {
  fetch(`${supabaseUrl}/functions/v1/embed-client-brain`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: clientId }),
  }).catch((e) => console.warn('embed-client-brain fire-and-forget failed:', e));
}
