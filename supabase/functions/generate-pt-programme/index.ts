import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ExerciseInput {
  id: string;
  name: string;
  muscles?: string[];
  purpose?: string | null;
  equipment?: string | null;
  video_url?: string | null;
  cues?: string[];
}

interface PhaseTemplate {
  id: string;
  title: string;
  focus: string;
  weeks: string;
}

function buildSystemPrompt(phaseTemplate: PhaseTemplate[]): string {
  const phaseList = phaseTemplate
    .map((p, i) => `  ${i + 1}. "${p.title}" — ${p.weeks} weeks — focus: ${p.focus}`)
    .join('\n');

  return `You are Pedro Avila's AI programming assistant. You populate structured workout days into a fixed training programme template.

CRITICAL RULES:
- The phase structure below is FIXED. Do not add, remove, rename, or reorder phases.
- Do not change "title" or "weeks" values for any phase. Copy them exactly as given.
- Populate the "days" array for each phase with appropriate workout days.
- Each workout day must have sections in this exact order: Warm Up, Workout, MetCon (if applicable), Stretches.
- Mark each section start using "section_start" on the first exercise of that section.
- Every exercise must have up to 4 simple client-facing cues.

FIXED PHASE STRUCTURE:
${phaseList}

EXERCISE SECTION SCHEMA (for each day's exercises array):
- First exercise of Warm Up section: set section_start = "Warm Up"
- First exercise of Workout section: set section_start = "Workout"
- First exercise of MetCon section: set section_start = "MetCon" (omit if not applicable)
- First exercise of Stretches section: set section_start = "Stretches"
- All other exercises in a section: omit section_start

PROGRAMME JSON SCHEMA:
{
  "name": "Programme name",
  "goal": "Main goal",
  "programme": {
    "phases": [
      {
        "id": "<copy from template>",
        "title": "<copy from template exactly>",
        "focus": "<copy from template>",
        "weeks": "<copy from template exactly>",
        "progression": "What changes across the phase",
        "days": [
          {
            "id": "day_1",
            "title": "Day 1 - Full Body",
            "focus": "Session focus",
            "exercises": [
              {
                "id": "exercise_1",
                "exercise_id": "library uuid or null",
                "name": "Exercise name",
                "sets": "3",
                "reps": "8-12",
                "rest": "60 sec",
                "notes": "Specific cue or progression note",
                "video_url": "url or null",
                "cues": ["Cue 1", "Cue 2", "Cue 3", "Cue 4"],
                "superset_id": null,
                "section_start": "Warm Up"
              }
            ]
          }
        ]
      }
    ]
  }
}

Return only valid JSON. No markdown. No commentary.`;
}

async function getQueryEmbedding(query: string, openaiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function searchKnowledgeBase(
  query: string,
  openaiKey: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string> {
  const embedding = await getQueryEmbedding(query, openaiKey);
  if (!embedding) return '';

  const db = createClient(supabaseUrl, serviceKey);
  const { data } = await db.rpc('match_knowledge_chunks', {
    query_embedding: embedding,
    match_count: 6,
    match_threshold: 0.4,
  });

  if (!data || data.length === 0) return '';

  const formatted = (data as Array<{ document_title: string; chunk_text: string; similarity: number }>)
    .map((r) => `[From: ${r.document_title}]\n${r.chunk_text}`)
    .join('\n\n---\n\n');

  return formatted;
}

async function searchWeb(query: string, openaiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-search-preview',
        messages: [
          {
            role: 'user',
            content: `Research and summarise the best evidence-based training methods for: ${query}. Focus on exercise selection, progression strategies, and periodisation. Be concise — 3 short paragraphs max.`,
          },
        ],
      }),
    });
    if (!res.ok) return '';
    const json = (await res.json()) as { choices?: Array<{ message: { content: string } }> };
    return json.choices?.[0]?.message.content ?? '';
  } catch {
    return '';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const { notes, exercises, phase_template } = (await req.json()) as {
      notes?: string;
      exercises?: ExerciseInput[];
      phase_template?: PhaseTemplate[];
    };

    if (!notes?.trim()) {
      return json({ error: 'Missing programme notes.' }, 400);
    }

    const template: PhaseTemplate[] = phase_template ?? [];
    const searchQuery = notes.slice(0, 500);

    const [knowledgeContext, webContext] = await Promise.all([
      searchKnowledgeBase(searchQuery, openaiKey, supabaseUrl, serviceKey),
      searchWeb(searchQuery, openaiKey),
    ]);

    const contextSections: string[] = [];
    if (knowledgeContext) {
      contextSections.push(`KNOWLEDGE BASE EXCERPTS:\n${knowledgeContext}`);
    }
    if (webContext) {
      contextSections.push(`WEB RESEARCH:\n${webContext}`);
    }

    const userContent: Record<string, unknown> = {
      coach_notes: notes,
      exercise_library: (exercises ?? []).slice(0, 300),
      phase_template: template,
    };

    if (contextSections.length > 0) {
      userContent.context = contextSections.join('\n\n===\n\n');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(template) },
          { role: 'user', content: JSON.stringify(userContent) },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown error');
      return json({ error: `OpenAI error: ${errText}` }, 500);
    }

    const completion = (await res.json()) as {
      choices?: Array<{ message: { content: string } }>;
      error?: { message: string };
    };

    if (completion.error) return json({ error: completion.error.message }, 500);

    const raw = completion.choices?.[0]?.message.content ?? '{}';
    return json(JSON.parse(raw));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Programme generation failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
