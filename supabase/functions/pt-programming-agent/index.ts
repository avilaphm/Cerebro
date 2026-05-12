import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au'];
const MAX_DOCUMENT_CHARS = 45000;
const DEFAULT_PRINCIPLES = `# Pedro PT Programming Principles

## Role
- Build practical client programmes Pedro can review and adjust quickly.
- Preserve the client's goal, available schedule, injuries, dislikes, equipment, and training age.
- Treat client feedback and logged performance as stronger evidence than a generic template.
- Never claim a programme is final or saved. The output is a draft for Pedro.

## Programme Structure
- Use 2-4 phases unless Pedro asks for something different.
- Each phase needs a clear focus, duration, progression, days, and block progression where appropriate.
- Use week_blocks for phase-level progression blocks.
- A week_blocks item uses either sets or weight_pct, not both unless Pedro explicitly asks.
- Use weight_pct only when percentage loading makes sense for the exercise and goal.
- Use set progressions for general strength, hypertrophy, skill, return-to-training, or mixed programmes.

## Exercise Selection
- Prefer exercises from the supplied exercise library and copy their exercise_id, cues, and video URL.
- Choose exercises the client can perform with their available equipment.
- Avoid exercises the client dislikes unless Pedro explicitly wants to reintroduce them.
- Regress painful or risky exercises instead of removing the training pattern entirely where possible.
- Use sections such as Warm Up, Workout, MetCon, Stretches, and Cool Down when they improve clarity.

## Loading And Progression
- Keep early weeks conservative when the client is new, returning from injury, inconsistent, or feedback shows pain/fatigue.
- Progress one main variable at a time: sets, load percentage, reps, density, complexity, or range.
- Use exercise-specific overrides only when a single exercise needs different sets, reps, percentage, or notes from the phase block.
- If client logs show missed workouts or poor recovery, reduce complexity before increasing intensity.
- If client logs show consistent completion and stable load, progress gradually.

## Client-Facing Detail
- Every exercise needs concise cues that a client can understand mid-session.
- Notes should be actionable: tempo, range, setup, substitution, pain rule, or intent.
- Use simple language. Avoid long coaching essays inside exercise notes.
- Include rest times that match the goal and difficulty.

## Safety
- Respect injuries, pain, pregnancy, surgery, medication, illness, travel, and schedule changes.
- For pain signals, use a conservative substitution or note and flag the reason in the change summary.
- Do not give medical diagnosis. Programme around constraints and leave judgement to Pedro.`;

type AgentMode = 'new_programme' | 'revise_programme';

interface AgentRequest {
  client_id?: string;
  assignment_id?: string;
  mode?: AgentMode;
  instructions?: string;
}

interface ProgrammeWeekBlock {
  weeks: number;
  sets?: string;
  weight_pct?: string;
}

interface ProgrammeExercise {
  id: string;
  exercise_id: string | null;
  name: string;
  sets: string;
  reps: string;
  rest: string;
  notes: string;
  video_url: string | null;
  cues: string[];
  superset_id?: string | null;
  section_start?: string;
  week_overrides?: Array<{
    block_index: number;
    sets?: string;
    reps?: string;
    weight_pct?: string;
    notes?: string;
  }>;
}

interface ProgrammeDay {
  id: string;
  title: string;
  focus: string;
  exercises: ProgrammeExercise[];
}

interface ProgrammePhase {
  id: string;
  title: string;
  focus: string;
  weeks: string;
  progression: string;
  week_blocks?: ProgrammeWeekBlock[];
  days: ProgrammeDay[];
}

interface Programme {
  phases: ProgrammePhase[];
}

const SYSTEM_PROMPT = `You are Pedro Avila's PT Programming Agent.

You create draft training programmes for Pedro to review. You do not save anything. Pedro is the final decision maker.

Return only valid JSON. No markdown. No commentary.

Schema:
{
  "name": "Programme name",
  "goal": "Main goal",
  "change_summary": "Short summary of the draft and why it fits the client",
  "programme": {
    "phases": [
      {
        "id": "phase_1",
        "title": "Phase title",
        "focus": "Training focus",
        "weeks": "4",
        "progression": "How this phase progresses",
        "week_blocks": [
          { "weeks": 2, "sets": "2" },
          { "weeks": 2, "sets": "3" }
        ],
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
                "notes": "Specific execution note",
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

Rules:
- For a new programme, create the complete programme from the client context.
- For a revision, preserve useful parts of the current programme and change only what client feedback, logs, or Pedro's instruction justify.
- Use phase-level week_blocks for set progressions or percentage progressions.
- A week block should use "sets" for set progressions or "weight_pct" for percentage progressions.
- Use exercise week_overrides only when a specific exercise needs to differ from the phase block.
- Prefer supplied exercise library IDs. Copy library cues and video URLs when available.
- Respect injuries, pain, dislikes, schedule, equipment, and recent performance.
- Include warm up, main work, conditioning, stretches, or cool down sections where useful.
- Keep the result directly editable in the existing Cerebro programme editor.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(url, serviceKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = authData.user.email?.toLowerCase() ?? '';
    const { data: requesterProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (requesterProfile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
      return json({ error: 'Only Pedro can use the programming agent.' }, 403);
    }

    const body = (await req.json()) as AgentRequest;
    const clientId = body.client_id;
    const mode = body.mode;
    const instructions = body.instructions?.trim() ?? '';

    if (!clientId) return json({ error: 'Missing client_id.' }, 400);
    if (mode !== 'new_programme' && mode !== 'revise_programme') {
      return json({ error: 'Invalid mode.' }, 400);
    }

    const context = await buildContext(adminClient, clientId, body.assignment_id, mode, instructions);
    if ('error' in context) return json({ error: context.error }, context.status);

    const principles = await loadPrinciples();
    const document = await loadClientDocument(adminClient, context.client.document_url, openaiKey);

    let result: Record<string, unknown>;
    if (document.fileId) {
      result = await generateWithFile(openaiKey, document.fileId, context, principles);
      await deleteOpenAIFile(openaiKey, document.fileId);
    } else {
      result = await generateWithText(openaiKey, context, principles, document.text);
    }

    if (typeof result.error === 'string') return json({ error: result.error }, 500);

    const programme = safeProgramme(result.programme);
    return json({
      ok: true,
      mode,
      client_id: clientId,
      assignment_id: context.active_assignment?.id ?? null,
      name: text(result.name, mode === 'new_programme' ? `${context.client.name} Programme` : context.active_assignment?.name ?? `${context.client.name} Programme`),
      goal: text(result.goal, context.active_assignment?.goal ?? context.client.goals ?? ''),
      change_summary: text(result.change_summary, mode === 'new_programme' ? 'Draft programme created for Pedro to review.' : 'Draft revision created for Pedro to review.'),
      programme,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Programming agent failed.' }, 500);
  }
});

async function buildContext(
  adminClient: ReturnType<typeof createClient>,
  clientId: string,
  assignmentId: string | undefined,
  mode: AgentMode,
  instructions: string,
): Promise<Record<string, unknown> | { error: string; status: number }> {
  const { data: client, error: clientError } = await adminClient
    .from('pt_clients')
    .select('id, name, email, status, goals, notes, sessions_remaining, document_url')
    .eq('id', clientId)
    .single();

  if (clientError || !client) return { error: 'Client not found.', status: 404 };

  const [assignmentsRes, notesRes, messagesRes, workoutsRes, setsRes, exercisesRes] = await Promise.all([
    adminClient
      .from('pt_program_assignments')
      .select('id, name, goal, duration_weeks, phase_count, status, programme, current_week, current_block_index, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5),
    adminClient
      .from('pt_client_notes')
      .select('id, content, context, created_at')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(30),
    adminClient
      .from('pt_messages')
      .select('sender, content, context, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(40),
    adminClient
      .from('pt_workout_logs')
      .select('id, assignment_id, phase_index, week_number, day_index, block_index, workout_title, notes, completed_at, is_quick_done')
      .eq('client_id', clientId)
      .order('completed_at', { ascending: false })
      .limit(30),
    adminClient
      .from('pt_set_logs')
      .select('exercise_id, exercise_name, set_number, reps, weight, notes, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(160),
    adminClient
      .from('pt_exercises')
      .select('id, name, muscles, purpose, equipment, video_url, cues, tags')
      .order('name')
      .limit(350),
  ]);

  const assignments = Array.isArray(assignmentsRes.data) ? assignmentsRes.data : [];
  const activeAssignment = assignmentId
    ? assignments.find((item) => recordString(item, 'id') === assignmentId) ?? null
    : assignments.find((item) => recordString(item, 'status') === 'active') ?? null;

  if (mode === 'revise_programme' && !activeAssignment) {
    return { error: 'No active programme found to revise.', status: 400 };
  }

  return {
    mode,
    pedro_instruction: instructions || null,
    client,
    active_assignment: activeAssignment,
    recent_assignments: assignments,
    active_feedback_notes: notesRes.data ?? [],
    recent_messages: messagesRes.data ?? [],
    recent_workouts: workoutsRes.data ?? [],
    recent_sets: setsRes.data ?? [],
    exercise_library: exercisesRes.data ?? [],
  };
}

async function loadClientDocument(
  adminClient: ReturnType<typeof createClient>,
  documentPath: unknown,
  openaiKey: string,
): Promise<{ text: string | null; fileId: string | null }> {
  if (typeof documentPath !== 'string' || !documentPath) return { text: null, fileId: null };

  const { data: signedData, error } = await adminClient.storage
    .from('pt-client-docs')
    .createSignedUrl(documentPath, 300);

  if (error || !signedData?.signedUrl) return { text: null, fileId: null };

  const fileRes = await fetch(signedData.signedUrl);
  if (!fileRes.ok) return { text: null, fileId: null };

  const contentType = fileRes.headers.get('content-type') ?? '';
  const isPdf = contentType.includes('pdf') || documentPath.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const fileBytes = await fileRes.arrayBuffer();
    const form = new FormData();
    form.append('purpose', 'user_data');
    form.append('file', new Blob([fileBytes], { type: 'application/pdf' }), 'client-profile.pdf');

    const uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });

    if (!uploadRes.ok) return { text: null, fileId: null };
    const uploadJson = (await uploadRes.json()) as { id?: string };
    return { text: null, fileId: uploadJson.id ?? null };
  }

  const textContent = await fileRes.text();
  return { text: textContent.slice(0, MAX_DOCUMENT_CHARS), fileId: null };
}

async function generateWithFile(
  openaiKey: string,
  fileId: string,
  context: Record<string, unknown>,
  principles: string,
): Promise<Record<string, unknown>> {
  const responseRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      instructions: `${SYSTEM_PROMPT}\n\nPedro programming principles:\n${principles}`,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_id: fileId },
            {
              type: 'input_text',
              text: `Use this client profile document plus the JSON context below to create the requested draft.\n\n${JSON.stringify(context)}`,
            },
          ],
        },
      ],
    }),
  });

  if (!responseRes.ok) return { error: await responseRes.text().catch(() => 'OpenAI response error') };
  const responseJson = (await responseRes.json()) as { output?: Array<{ content?: Array<{ text?: string }> }> };
  const rawText = responseJson.output?.[0]?.content?.[0]?.text ?? '{}';
  return parseJsonResult(rawText);
}

async function generateWithText(
  openaiKey: string,
  context: Record<string, unknown>,
  principles: string,
  documentText: string | null,
): Promise<Record<string, unknown>> {
  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nPedro programming principles:\n${principles}` },
        {
          role: 'user',
          content: JSON.stringify({
            client_profile_document: documentText,
            context,
          }),
        },
      ],
    }),
  });

  if (!chatRes.ok) return { error: await chatRes.text().catch(() => 'OpenAI chat error') };
  const chatJson = (await chatRes.json()) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
  if (chatJson.error) return { error: chatJson.error.message };
  return parseJsonResult(chatJson.choices?.[0]?.message.content ?? '{}');
}

async function loadPrinciples() {
  try {
    return await Deno.readTextFile(new URL('./programming-principles.md', import.meta.url));
  } catch {
    return DEFAULT_PRINCIPLES;
  }
}

async function deleteOpenAIFile(openaiKey: string, fileId: string) {
  await fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${openaiKey}` },
  }).catch(() => {});
}

function safeProgramme(value: unknown): Programme {
  if (!isRecord(value)) return { phases: [] };
  const phases = Array.isArray(value.phases) ? value.phases : [];
  return {
    phases: phases.map((phase, phaseIndex) => {
      const p = isRecord(phase) ? phase : {};
      const days = Array.isArray(p.days) ? p.days : [];
      return {
        id: text(p.id, `phase_${phaseIndex + 1}`),
        title: text(p.title, `Phase ${phaseIndex + 1}`),
        focus: text(p.focus, ''),
        weeks: text(p.weeks, ''),
        progression: text(p.progression, ''),
        week_blocks: safeWeekBlocks(p.week_blocks),
        days: days.map((day, dayIndex) => safeDay(day, dayIndex)),
      };
    }),
  };
}

function safeDay(value: unknown, dayIndex: number): ProgrammeDay {
  const d = isRecord(value) ? value : {};
  const exercises = Array.isArray(d.exercises) ? d.exercises : [];
  return {
    id: text(d.id, `day_${dayIndex + 1}`),
    title: text(d.title, `Day ${dayIndex + 1}`),
    focus: text(d.focus, ''),
    exercises: exercises.map((exercise, exerciseIndex) => safeExercise(exercise, exerciseIndex)),
  };
}

function safeExercise(value: unknown, exerciseIndex: number): ProgrammeExercise {
  const e = isRecord(value) ? value : {};
  return {
    id: text(e.id, `exercise_${exerciseIndex + 1}`),
    exercise_id: typeof e.exercise_id === 'string' ? e.exercise_id : null,
    name: text(e.name, `Exercise ${exerciseIndex + 1}`),
    sets: text(e.sets, ''),
    reps: text(e.reps, ''),
    rest: text(e.rest, ''),
    notes: text(e.notes, ''),
    video_url: typeof e.video_url === 'string' ? e.video_url : null,
    cues: Array.isArray(e.cues) ? e.cues.map((cue) => String(cue)).slice(0, 5) : [],
    superset_id: typeof e.superset_id === 'string' ? e.superset_id : null,
    section_start: typeof e.section_start === 'string' && e.section_start ? e.section_start : undefined,
    week_overrides: safeOverrides(e.week_overrides),
  };
}

function safeWeekBlocks(value: unknown): ProgrammeWeekBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value
    .map((block): ProgrammeWeekBlock | null => {
      const b = isRecord(block) ? block : {};
      const weeks = typeof b.weeks === 'number' ? b.weeks : Number.parseInt(String(b.weeks ?? ''), 10);
      if (!Number.isFinite(weeks) || weeks <= 0) return null;
      const sets = text(b.sets, '');
      const weightPct = normalizeWeightPct(b.weight_pct);
      if (!sets && !weightPct) return null;
      return { weeks, sets: sets || undefined, weight_pct: weightPct || undefined };
    })
    .filter((block): block is ProgrammeWeekBlock => block !== null);
  return blocks.length > 0 ? blocks : undefined;
}

function safeOverrides(value: unknown): ProgrammeExercise['week_overrides'] {
  if (!Array.isArray(value)) return undefined;
  const overrides = value
    .map((override) => {
      const o = isRecord(override) ? override : {};
      const blockIndex = typeof o.block_index === 'number' ? o.block_index : Number.parseInt(String(o.block_index ?? ''), 10);
      if (!Number.isFinite(blockIndex)) return null;
      return {
        block_index: blockIndex,
        sets: text(o.sets, '') || undefined,
        reps: text(o.reps, '') || undefined,
        weight_pct: normalizeWeightPct(o.weight_pct) || undefined,
        notes: text(o.notes, '') || undefined,
      };
    })
    .filter((override): override is NonNullable<ProgrammeExercise['week_overrides']>[number] => override !== null);
  return overrides.length > 0 ? overrides : undefined;
}

function normalizeWeightPct(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.includes('%') ? raw : `${raw}%`;
}

function parseJsonResult(raw: string): Record<string, unknown> {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { error: 'Could not parse AI response as JSON.' };
  }
}

function recordString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : '';
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
