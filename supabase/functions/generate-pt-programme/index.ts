import OpenAI from 'npm:openai@4.104.0';

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

const SYSTEM = `You turn Pedro Avila's rough PT programme brain dumps into structured JSON.

Return only valid JSON. No markdown. No commentary.

Schema:
{
  "name": "Programme name",
  "goal": "Main goal",
  "programme": {
    "phases": [
      {
        "id": "phase_1",
        "title": "Phase title",
        "focus": "Training focus",
        "weeks": "Weeks 1-6",
        "progression": "What changes across the phase",
        "days": [
          {
            "id": "day_1",
            "title": "Day title",
            "focus": "Session focus",
            "exercises": [
              {
                "id": "exercise_1",
                "exercise_id": "library uuid or null",
                "name": "Exercise name",
                "sets": "2",
                "reps": "8-12",
                "rest": "60-90 sec",
                "notes": "Specific execution, superset, progression, or week note",
                "video_url": "url or null",
                "cues": ["Cue 1", "Cue 2", "Cue 3", "Cue 4"],
                "superset_id": null
              }
            ]
          }
        ]
      }
    ]
  }
}

Rules:
- Preserve Pedro's intended phases, weeks, progressions, supersets, and exercise choices.
- Prefer exercises from the supplied library. When using a library exercise, copy its id, cues, and video_url.
- Every exercise must have up to 4 simple client-facing cues.
- If Pedro says week 1-2 is 2 sets and week 3-6 is 3 sets, keep that detail in notes/progression.
- Keep output editable, practical, and specific.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { notes, exercises } = (await req.json()) as {
      notes?: string;
      exercises?: ExerciseInput[];
    };

    if (!notes?.trim()) {
      return json({ error: 'Missing programme notes.' }, 400);
    }

    const client = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });
    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            notes,
            exercise_library: (exercises ?? []).slice(0, 300),
          }),
        },
      ],
    });

    const raw = response.choices[0]?.message.content ?? '{}';
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
