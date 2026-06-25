import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];
const SECTIONS = ['Warm Up', 'Workout', 'MetCon', 'Stretches'] as const;

const BIG_5_ALIASES: Record<string, string[]> = {
  'BB Squat': ['squat', 'bb squat', 'barbell squat', 'back squat'],
  'BB Deadlift': ['deadlift', 'bb deadlift', 'barbell deadlift', 'conventional deadlift', 'romanian deadlift', 'rdl'],
  'BB Bench Press': ['bench press', 'bb bench', 'barbell bench', 'chest press', 'bb chest press'],
  'BB Shoulder Press': ['shoulder press', 'overhead press', 'ohp', 'bb shoulder press', 'barbell shoulder press', 'military press'],
  'Pull-up': ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup'],
};

const PATTERNS = [
  'horizontal_push',
  'horizontal_pull',
  'vertical_push',
  'vertical_pull',
  'squat',
  'hinge',
  'unilateral_lower',
  'bilateral_lower',
  'single_arm_push',
  'single_arm_pull',
  'two_arm_push',
  'two_arm_pull',
  'core',
  'corrective',
] as const;

const CHAT_SYSTEM = `You are Pedro Avila's phase rebuild chat agent inside Cerebro.

The coach is replacing ONE selected programme phase. Behave like a practical programming assistant:
- Read the client context, movement analysis, injuries, weak/tight muscles, recent training, 1RM data, and the active phase.
- Ask ONE short question at a time only when a critical decision is missing.
- If the coach gives enough information, return ready=true and summarize the captured plan.
- Default intelligently when details are safe: most clients train 3-4 days, occasionally 5.

Return valid JSON only:
{
  "ready": boolean,
  "assistant_message": string,
  "captured": {
    "days_requested": number | null,
    "split_selected": string | null,
    "duration_weeks": number | null,
    "day_intents": string[],
    "must_use_exercises": string[],
    "avoid": string[],
    "weekly_set_targets": string[],
    "client_needs": string[],
    "assumptions": string[]
  }
}

Ask about missing details in this priority:
1. number of training days if not inferable;
2. main lift/main intent for any day that is unclear;
3. important constraints that affect pain, injury, equipment, or phase progression.

Split rules:
- 2 days/week: full-body A/B.
- 3 days/week: full-body A/B/C.
- 4 days/week: Lower A / Upper A / Lower B / Upper B.
- 5 days/week: Lower A / Upper A / Full Body / Lower B / Upper B.
- Full body days should use contrast: two-leg lower with single-arm upper, or two-arm upper with single-leg lower, when useful.
- Upper/lower weeks should alternate two-arm vs single-arm upper emphasis and two-leg vs single-leg lower emphasis across A/B days.
- Superset rule: do not pair two big/main lifts in the same superset by default. Put squat, deadlift/hinge main lift, bench/chest press main lift, shoulder/overhead press main lift, pulldown/pull-up main lift, main row, hip thrust main lift, and leg press main lift in separate supersets or standalone unless Pedro explicitly asks otherwise.

If ready, assistant_message must be a concise plan summary, not another question.`;

const WRITE_SYSTEM = `You are Pedro Avila's phase rebuild programme writer for Cerebro.

Replace ONE selected phase. Do not rewrite the full programme.

Return valid JSON only:
{
  "phase": {
    "title": string,
    "focus": string,
    "weeks": string,
    "progression": string,
    "week_blocks": [{"weeks": number, "sets": string, "weight_pct": string}],
    "days": [
      {
        "title": string,
        "focus": string,
        "exercises": [
          {
            "name": string,
            "section": "Warm Up" | "Workout" | "MetCon" | "Stretches",
            "sets": string,
            "reps": string,
            "rest": string,
            "superset_label": string,
            "notes": string,
            "weight_pct": string,
            "pattern": string
          }
        ]
      }
    ]
  },
  "split_selected": string,
  "weekly_set_volume": Record<string, number>,
  "movement_pattern_coverage": Record<string, number>,
  "questions_answered": string[],
  "assumptions": string[],
  "review_notes": string[],
  "web_research_used": boolean
}

Rules:
- Match the requested number of days exactly.
- Use Pedro's split rules: 2-3 days are full body; 4 days are 2 upper + 2 lower; 5 days are 2 upper + 2 lower + 1 full body.
- Build well-rounded training across horizontal push/pull, vertical push/pull, squat, hinge, core/corrective, and the client's specific needs.
- Use bilateral/unilateral contrast: two-leg lower work should be balanced with single-arm upper work where useful; two-arm upper work should be balanced with single-leg lower work where useful; upper/lower A/B days should alternate these emphases.
- Do not pair two big/main lifts in the same superset by default. Big/main lifts include squat, deadlift or main hinge, bench/chest press, shoulder/overhead press, pulldown/pull-up, main row, hip thrust, and leg press when used as main work. Put them in separate supersets or make one standalone, and pair each with a smaller accessory, core, corrective, mobility, or isolation movement unless Pedro explicitly asks for a big-lift pairing.
- Weekly set volume matters most. Choose conservative set targets from client level, injury status, recovery, and phase goal unless Pedro specified exact targets.
- Put Pedro's requested main lift/main movement near the top of each day's Workout section.
- Include Pedro's must-use exercises unless client history makes that inappropriate; explain in review_notes if changed.
- Consider client history: avoid needless recent repetition unless Pedro requested it, respect assessment/client constraints, and keep the phase coach-editable.
- Warm-up 2-4 items, workout main work plus useful accessories, optional MetCon/Stretches only if requested or clearly useful.
- If replacing Hypertrophy or Strength, preserve or create week_blocks with sets and weight_pct. Use the existing selected phase blocks when compatible.
- For Big 5-compatible lifts, set exercise weight_pct only when it should differ from the phase block. Otherwise leave it empty.
- Use only the four canonical sections.
- pattern must be one of: ${PATTERNS.join(', ')}.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json('ok');

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userSupa = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey);

    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = user.email?.toLowerCase() ?? '';
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
      return json({ error: 'Only Pedro can rebuild phases.' }, 403);
    }

    const body = await req.json() as PhaseRebuildRequest;
    const action = body.action ?? 'message';
    const assignmentId = body.assignment_id;
    const clientId = body.client_id;
    const phaseIndex = Number.isInteger(body.phase_index) ? body.phase_index! : -1;

    if (!assignmentId || !clientId || phaseIndex < 0) {
      return json({ error: 'Missing assignment, client, or phase.' }, 400);
    }

    const context = await loadContext(admin, assignmentId, clientId, phaseIndex);
    if (!context.assignment) return json({ error: 'Programme not found.' }, 404);
    if (!context.selectedPhase) return json({ error: 'Selected phase not found.' }, 404);

    const runId = await ensureRun(admin, {
      runId: body.run_id,
      userId: user.id,
      context,
    });

    if (action === 'start') {
      const messages = await loadChatMessages(admin, runId);
      await admin.from('pt_program_generation_runs').update({
        current_command: 'PHASE_REBUILD_CHAT_STARTED',
        status: 'running',
        updated_at: new Date().toISOString(),
      }).eq('id', runId);
      return json({
        ok: true,
        run_id: runId,
        messages,
        captured: {},
        one_rm_map: context.oneRmMap,
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    if (action === 'check' || action === 'message') {
      const message = (body.message ?? body.transcript ?? '').trim();
      if (message.length < 2) return json({ error: 'Type or dictate a message first.' }, 400);

      await appendStep(admin, runId, 'PHASE_CHAT_USER_MESSAGE', { message }, { role: 'user', content: message });
      const messages = await loadChatMessages(admin, runId);
      const check = await claudeJson<ChatResponse>(anthropic, {
        system: CHAT_SYSTEM,
        user: buildChatPrompt(context, messages),
        maxTokens: 1800,
      });
      if (!check?.assistant_message) return json({ error: 'Could not continue the phase-builder chat.' }, 502);

      const assistantMessage = check.assistant_message.trim();
      await appendStep(admin, runId, 'PHASE_CHAT_AGENT_QUESTION', {
        ready: Boolean(check.ready),
        captured: check.captured ?? {},
      }, {
        role: 'assistant',
        content: assistantMessage,
      });
      await admin.from('pt_program_generation_runs').update({
        current_command: Boolean(check.ready) ? 'PHASE_CHAT_READY' : 'PHASE_CHAT_AGENT_QUESTION',
        coaching_reasoning: {
          captured: check.captured ?? {},
          latest_assistant_message: assistantMessage,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', runId);

      const refreshedMessages = await loadChatMessages(admin, runId);
      return json({
        ok: true,
        run_id: runId,
        ready: Boolean(check.ready),
        assistant_message: assistantMessage,
        messages: refreshedMessages,
        missing_questions: Boolean(check.ready) ? [] : [assistantMessage],
        captured: check.captured ?? {},
        one_rm_map: context.oneRmMap,
      });
    }

    if (action !== 'generate') return json({ error: 'Unsupported action.' }, 400);

    const transcript = (body.transcript ?? '').trim();
    if (transcript.length > 0) {
      await appendStep(admin, runId, 'PHASE_CHAT_USER_MESSAGE', { message: transcript, source: 'legacy_transcript' }, { role: 'user', content: transcript });
    }
    const messages = await loadChatMessages(admin, runId);
    if (messages.filter((message) => message.role === 'user').length === 0) {
      return json({ error: 'Send at least one message before generating.' }, 400);
    }

    const contextStep = await appendStep(admin, runId, 'PHASE_CONTEXT_READER', {
      assignment_id: assignmentId,
      client_id: clientId,
      phase_index: phaseIndex,
    }, {
      client: context.client,
      exercise_doc: context.exerciseDoc,
      recent_workouts_count: context.recentWorkoutLogs.length,
      recent_sets_count: context.recentSetLogs.length,
      documents_count: context.documents.length,
    });

    const knowledgeContext = await retrieveKnowledgeContext(url, serviceKey, {
      runId,
      stepId: contextStep.id,
      taskType: 'phase_rebuild_chat',
      phaseType: String(context.selectedPhase?.title ?? ''),
      clientGoal: String(context.assignment.goal ?? context.client?.goals ?? ''),
      questionOrDecision: 'Build a client-specific phase using weekly set volume, movement-pattern coverage, injuries, movement analysis, and Pedro split rules.',
    });

    await admin.from('pt_program_generation_runs').update({
      current_command: 'PHASE_GENERATE_REPLACEMENT',
      status: 'running',
      updated_at: new Date().toISOString(),
    }).eq('id', runId);

    let written: WrittenPhase | null = null;
    try {
      written = await claudeJson<WrittenPhase>(anthropic, {
        system: WRITE_SYSTEM,
        user: buildWritePrompt(context, messages, knowledgeContext),
        maxTokens: 5200,
        timeoutMs: 55_000,
      });
    } catch (error) {
      const message = isAbortError(error)
        ? 'The phase builder timed out before finishing. I reduced the generation payload now; send the brief again and generate the phase.'
        : error instanceof Error
          ? error.message
          : 'Could not generate a replacement phase.';
      await markRunFailed(admin, runId, message);
      return json({ error: message, run_id: runId });
    }
    if (!written?.phase?.days || !Array.isArray(written.phase.days)) {
      await markRunFailed(admin, runId, 'Could not generate a replacement phase.');
      return json({ error: 'Could not generate a replacement phase.', run_id: runId });
    }

    await appendStep(admin, runId, 'PHASE_STRUCTURE_PLANNER', {
      messages,
      knowledge_context: knowledgeContext,
    }, {
      split_selected: written.split_selected ?? null,
      assumptions: written.assumptions ?? [],
      review_notes: written.review_notes ?? [],
    });

    const assembled = await assemblePhase(admin, written.phase, context);
    const resolvedLoads = resolveLoads(assembled, context.oneRmMap);
    const audit = auditPhase(assembled, context, written, runId);

    await appendStep(admin, runId, 'PHASE_VOLUME_PATTERN_AUDIT', {
      phase_id: assembled.id,
    }, audit);
    await appendStep(admin, runId, 'PHASE_GENERATE_REPLACEMENT', {
      phase_index: phaseIndex,
    }, {
      phase: assembled,
      resolved_loads: resolvedLoads,
      review_notes: written.review_notes ?? [],
    });

    await admin.from('pt_program_generation_runs').update({
      current_command: 'PHASE_REBUILD_READY_FOR_REVIEW',
      status: 'needs_review',
      programme_draft: { phases: [assembled] },
      validation_summary: audit,
      coaching_reasoning: {
        captured_chat: summarizeMessages(messages),
        questions_answered: written.questions_answered ?? [],
        assumptions: written.assumptions ?? [],
        review_notes: written.review_notes ?? [],
      },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', runId);

    return json({
      ok: true,
      run_id: runId,
      phase: assembled,
      one_rm_map: context.oneRmMap,
      resolved_loads: resolvedLoads,
      questions_answered: written.questions_answered ?? [],
      assumptions: written.assumptions ?? [],
      review_notes: written.review_notes ?? [],
      weekly_set_volume: audit.weekly_set_volume,
      movement_pattern_coverage: audit.movement_pattern_coverage,
      split_selected: audit.split_selected,
      unilateral_bilateral_balance: audit.unilateral_bilateral_balance,
      client_needs_applied: audit.client_needs_applied,
      web_research_used: Boolean(written.web_research_used),
      matched_count: assembled.days.flatMap((d) => d.exercises).filter((e) => e.exercise_id).length,
    });
  } catch (error) {
    console.error('rebuild-programme-phase error:', error);
    return json({ error: error instanceof Error ? error.message : 'Phase rebuild failed.' }, 500);
  }
});

interface PhaseRebuildRequest {
  action?: 'start' | 'message' | 'generate' | 'check';
  assignment_id?: string;
  client_id?: string;
  phase_index?: number;
  run_id?: string | null;
  message?: string;
  transcript?: string;
}
interface AssignmentRow {
  id: string;
  client_id: string;
  name: string;
  goal: string | null;
  programme: Programme;
}
interface Programme { phases?: Phase[] }
interface Phase {
  id?: string;
  title?: string;
  focus?: string;
  weeks?: string;
  progression?: string;
  week_blocks?: Array<{ weeks: number; sets?: string; weight_pct?: string }>;
  days?: Day[];
}
interface Day { id?: string; title?: string; focus?: string; exercises?: Exercise[] }
interface Exercise {
  id?: string;
  exercise_id?: string | null;
  name?: string;
  section?: string;
  section_start?: string;
  sets?: string;
  reps?: string;
  rest?: string;
  notes?: string;
  video_url?: string | null;
  cues?: string[];
  superset_label?: string;
  superset_id?: string | null;
  weight_pct?: string;
  pattern?: string | null;
  week_overrides?: Array<{ block_index: number; weight_pct?: string; [key: string]: unknown }>;
}
interface LibraryRow {
  id: string;
  name: string;
  video_url: string | null;
  cues: string[] | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  muscles: string[] | null;
  tags?: string[] | null;
}
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}
interface ChatResponse {
  ready?: boolean;
  assistant_message?: string;
  captured?: Record<string, unknown>;
}
interface WrittenPhase {
  phase?: Phase;
  split_selected?: string;
  weekly_set_volume?: Record<string, number>;
  movement_pattern_coverage?: Record<string, number>;
  questions_answered?: string[];
  assumptions?: string[];
  review_notes?: string[];
  web_research_used?: boolean;
}
interface Context {
  assignment: AssignmentRow | null;
  client: Record<string, unknown> | null;
  selectedPhase: Phase | null;
  phaseIndex: number;
  recentWorkoutLogs: unknown[];
  recentSetLogs: unknown[];
  notes: unknown[];
  messages: unknown[];
  documents: unknown[];
  exerciseDoc: Record<string, unknown> | null;
  brain: unknown;
  lifestyleDoc: unknown;
  nutritionDoc: unknown;
  oneRmMap: Record<string, number>;
  library: LibraryRow[];
}

async function loadContext(admin: ReturnType<typeof createClient>, assignmentId: string, clientId: string, phaseIndex: number): Promise<Context> {
  const [assignmentRes, clientRes, workoutRes, setRes, notesRes, messageRes, documentsRes, exerciseDocRes, brainRes, lifestyleRes, nutritionRes, oneRmRes, libraryRes] = await Promise.all([
    admin.from('pt_program_assignments').select('id, client_id, name, goal, programme').eq('id', assignmentId).eq('client_id', clientId).single(),
    admin.from('pt_clients').select('id, name, goals, notes, lifestyle_context, coaching_focus, event_goal, regular_training_slot').eq('id', clientId).maybeSingle(),
    admin.from('pt_workout_logs').select('phase_index, day_index, week_number, block_index, workout_title, notes, created_at, completed_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(30),
    admin.from('pt_set_logs').select('exercise_id, exercise_name, set_number, reps, weight, notes, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
    admin.from('pt_client_notes').select('title, body, context, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(20),
    admin.from('pt_messages').select('sender, content, context, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(20),
    admin.from('pt_client_documents').select('document_type, title, content_text, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(8),
    admin.from('pt_client_exercise_doc').select('current_1rm, movement_mind_map, movement_assessment_summary, strong_movements, weak_movements, disliked_exercises, injury_history, current_limitations, progression_strategy, notes').eq('client_id', clientId).maybeSingle(),
    admin.from('pt_client_brain').select('summary_current, summary_30d, summary_60d, coaching_reasoning, important_decisions').eq('client_id', clientId).maybeSingle(),
    admin.from('pt_client_lifestyle_doc').select('sleep_baseline, stress_patterns, schedule_notes, recurring_challenges, goals_context').eq('client_id', clientId).maybeSingle(),
    admin.from('pt_client_nutrition_doc').select('daily_targets, nutrition_obstacles, eating_habits, recurring_gaps').eq('client_id', clientId).maybeSingle(),
    admin.from('pt_client_1rm_results').select('exercise_name, tested_weight_kg, estimated_1rm_kg, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    admin.from('pt_exercises').select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles, tags').order('name'),
  ]);

  const assignment = assignmentRes.data as AssignmentRow | null;
  const phases = Array.isArray(assignment?.programme?.phases) ? assignment!.programme.phases! : [];
  return {
    assignment,
    client: clientRes.data as Record<string, unknown> | null,
    selectedPhase: phases[phaseIndex] ?? null,
    phaseIndex,
    recentWorkoutLogs: workoutRes.data ?? [],
    recentSetLogs: setRes.data ?? [],
    notes: notesRes.data ?? [],
    messages: messageRes.data ?? [],
    documents: documentsRes.data ?? [],
    exerciseDoc: exerciseDocRes.data as Record<string, unknown> | null,
    brain: brainRes.data ?? null,
    lifestyleDoc: lifestyleRes.data ?? null,
    nutritionDoc: nutritionRes.data ?? null,
    oneRmMap: buildOneRmMap(oneRmRes.data ?? []),
    library: (libraryRes.data ?? []) as LibraryRow[],
  };
}

async function ensureRun(admin: ReturnType<typeof createClient>, input: { runId?: string | null; userId: string; context: Context }): Promise<string> {
  if (input.runId) {
    const { data } = await admin
      .from('pt_program_generation_runs')
      .select('id')
      .eq('id', input.runId)
      .eq('assignment_id', input.context.assignment?.id)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  const { data, error } = await admin.from('pt_program_generation_runs').insert({
    client_id: input.context.assignment?.client_id,
    assignment_id: input.context.assignment?.id,
    task_type: 'phase_rebuild_chat',
    phase_type: input.context.selectedPhase?.title ?? null,
    client_goal: input.context.assignment?.goal ?? String(input.context.client?.goals ?? ''),
    current_command: 'PHASE_REBUILD_CHAT_STARTED',
    status: 'running',
    programme_draft: {},
    nutrition_draft: {},
    validation_summary: {},
    coaching_reasoning: {},
    phase_roadmap: {
      phase_index: input.context.phaseIndex,
      phase_title: input.context.selectedPhase?.title ?? null,
    },
    created_by: input.userId,
  }).select('id').single();
  if (error || !data?.id) throw new Error(`Could not create phase chat run: ${error?.message ?? 'unknown error'}`);
  return data.id as string;
}

async function appendStep(admin: ReturnType<typeof createClient>, runId: string, commandName: string, inputJson: Record<string, unknown>, outputJson: unknown) {
  const { data: latest } = await admin
    .from('pt_program_generation_steps')
    .select('step_order')
    .eq('run_id', runId)
    .order('step_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = Number(latest?.step_order ?? 0) + 1;
  const now = new Date().toISOString();
  const { data, error } = await admin.from('pt_program_generation_steps').insert({
    run_id: runId,
    step_order: nextOrder,
    command_name: commandName,
    input_json: inputJson,
    output_json: outputJson,
    validation_json: {},
    status: 'succeeded',
    started_at: now,
    completed_at: now,
  }).select('id, step_order').single();
  if (error || !data) throw new Error(`Could not append generation step: ${error?.message ?? 'unknown error'}`);
  return data as { id: string; step_order: number };
}

async function loadChatMessages(admin: ReturnType<typeof createClient>, runId: string): Promise<ChatMessage[]> {
  const { data } = await admin
    .from('pt_program_generation_steps')
    .select('created_at, command_name, output_json')
    .eq('run_id', runId)
    .in('command_name', ['PHASE_CHAT_USER_MESSAGE', 'PHASE_CHAT_AGENT_QUESTION'])
    .order('step_order', { ascending: true });

  return ((data ?? []) as Array<{ created_at?: string; output_json?: unknown }>).flatMap((row) => {
    const out = typeof row.output_json === 'object' && row.output_json !== null ? row.output_json as Record<string, unknown> : {};
    const role = out.role === 'assistant' ? 'assistant' : out.role === 'user' ? 'user' : null;
    const content = typeof out.content === 'string' ? out.content.trim() : '';
    return role && content ? [{ role, content, created_at: row.created_at }] : [];
  });
}

function buildChatPrompt(context: Context, messages: ChatMessage[]) {
  return JSON.stringify({
    chat_messages: messages,
    selected_phase_index: context.phaseIndex,
    selected_phase: compactPhase(context.selectedPhase),
    split_rules: {
      two_days: 'Full Body A/B',
      three_days: 'Full Body A/B/C',
      four_days: 'Lower A / Upper A / Lower B / Upper B',
      five_days: 'Lower A / Upper A / Full Body / Lower B / Upper B',
    },
    client_context: compactClientContext(context, 1800),
    recent_training_summary: compactTraining(context),
    one_rm_map: context.oneRmMap,
  });
}

function buildWritePrompt(context: Context, messages: ChatMessage[], knowledgeContext: Record<string, unknown>) {
  return JSON.stringify({
    chat_messages: messages,
    selected_phase_index: context.phaseIndex,
    selected_phase: compactPhase(context.selectedPhase),
    existing_programme_outline: compactProgramme(context),
    client_context: compactClientContext(context, 1200),
    recent_training_summary: compactTraining(context, 0),
    one_rm_map: context.oneRmMap,
    library_names: selectRelevantLibraryNames(context, messages),
    knowledge_context: knowledgeContext,
    programming_method: {
      weekly_set_volume: 'Use weekly sets per muscle group as the main volume control. Pick conservative default targets by client level, injury status, recovery, and phase goal unless Pedro gave exact targets.',
      movement_patterns: PATTERNS,
      split_rules: {
        two_days: 'Full Body A/B',
        three_days: 'Full Body A/B/C',
        four_days: 'Lower A / Upper A / Lower B / Upper B',
        five_days: 'Lower A / Upper A / Full Body / Lower B / Upper B',
      },
    },
  });
}

function compactPhase(phase: Phase | null) {
  if (!phase) return null;
  return {
    id: phase.id,
    title: phase.title,
    focus: phase.focus,
    weeks: phase.weeks,
    progression: phase.progression,
    week_blocks: phase.week_blocks,
    days: (phase.days ?? []).map((day) => ({
      title: day.title,
      focus: day.focus,
      exercise_count: day.exercises?.length ?? 0,
      exercises: (day.exercises ?? []).map((ex) => ({
        name: ex.name,
        section: ex.section_start ?? ex.section ?? null,
        sets: ex.sets,
        reps: ex.reps,
        rest: ex.rest,
        superset_id: ex.superset_id ?? null,
        pattern: ex.pattern ?? null,
      })),
    })),
  };
}

function compactProgramme(context: Context) {
  const phases = context.assignment?.programme?.phases ?? [];
  return phases.map((phase, index) => ({
    index,
    title: phase.title,
    weeks: phase.weeks,
    week_blocks: phase.week_blocks,
    days: (phase.days ?? []).map((day) => ({
      title: day.title,
      focus: day.focus,
      exercise_count: day.exercises?.length ?? 0,
      exercises: (day.exercises ?? []).slice(0, 14).map((ex) => ({ name: ex.name, pattern: ex.pattern ?? null })),
    })),
  }));
}

function compactClientContext(context: Context, documentChars = 1800) {
  return {
    client: context.client,
    exercise_doc: context.exerciseDoc,
    brain: context.brain,
    lifestyle_doc: context.lifestyleDoc,
    nutrition_doc: context.nutritionDoc,
    notes: context.notes,
    messages: context.messages,
    documents: context.documents.map((doc) => {
      const d = doc as { document_type?: string; title?: string; content_text?: string };
      return {
        document_type: d.document_type,
        title: d.title,
        content_text: String(d.content_text ?? '').slice(0, documentChars),
      };
    }),
  };
}

function compactTraining(context: Context, rawSetLimit = 30) {
  return {
    recent_workouts: context.recentWorkoutLogs.slice(0, 12),
    recent_sets: context.recentSetLogs.slice(0, rawSetLimit),
    exercise_history: summarizeExerciseHistory(context.recentSetLogs),
  };
}

function selectRelevantLibraryNames(context: Context, messages: ChatMessage[]) {
  const requestedText = [
    ...messages.map((message) => message.content),
    context.selectedPhase?.title ?? '',
    ...(context.selectedPhase?.days ?? []).flatMap((day) => (day.exercises ?? []).map((ex) => ex.name ?? '')),
  ].join(' ').toLowerCase();
  const terms = new Set(normalise(requestedText).split(' ').filter((term) => term.length >= 4));
  const picked: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined) => {
    const clean = String(name ?? '').trim();
    const key = normalise(clean);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    picked.push(clean);
  };

  for (const day of context.selectedPhase?.days ?? []) {
    for (const ex of day.exercises ?? []) add(ex.name);
  }
  for (const row of context.library) {
    const norm = normalise(row.name);
    const words = norm.split(' ');
    if (requestedText.includes(norm) || words.some((word) => terms.has(word))) add(row.name);
    if (picked.length >= 550) break;
  }
  for (const row of context.library) {
    if (picked.length >= 650) break;
    add(row.name);
  }
  return picked;
}

function summarizeExerciseHistory(setLogs: unknown[]) {
  const summary = new Map<string, { sessions: number; latest_weight: number | null; best_weight: number | null; latest_reps: number | null }>();
  for (const item of setLogs) {
    const row = item as { exercise_name?: string; weight?: number | null; reps?: number | null };
    const name = String(row.exercise_name ?? '').trim();
    if (!name) continue;
    const current = summary.get(name) ?? { sessions: 0, latest_weight: null, best_weight: null, latest_reps: null };
    current.sessions += 1;
    if (current.latest_weight === null && row.weight !== undefined) current.latest_weight = Number(row.weight);
    if (current.latest_reps === null && row.reps !== undefined) current.latest_reps = Number(row.reps);
    const weight = Number(row.weight ?? 0);
    if (Number.isFinite(weight) && weight > 0) current.best_weight = Math.max(current.best_weight ?? 0, weight);
    summary.set(name, current);
  }
  return Array.from(summary.entries()).slice(0, 60).map(([name, data]) => ({ name, ...data }));
}

async function retrieveKnowledgeContext(
  supabaseUrl: string,
  serviceKey: string,
  body: {
    runId: string;
    stepId: string;
    taskType: string;
    phaseType: string;
    clientGoal: string;
    questionOrDecision: string;
  },
): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/retrieve-knowledge-context`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, ...payload };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Knowledge retrieval failed.' };
  }
}

async function assemblePhase(admin: ReturnType<typeof createClient>, parsed: Phase, context: Context): Promise<Phase> {
  const byNorm = new Map<string, LibraryRow>();
  for (const row of context.library) byNorm.set(normalise(row.name), row);

  const names = [...new Set((parsed.days ?? [])
    .flatMap((d) => d.exercises ?? [])
    .map((e) => String(e.name ?? '').trim())
    .filter(Boolean))];
  const resolved = new Map<string, LibraryRow>();
  const missing: string[] = [];

  for (const name of names) {
    const hit = matchLibrary(name, byNorm, context.library);
    if (hit) resolved.set(name, hit);
    else missing.push(name);
  }

  if (missing.length > 0) {
    const toInsert = missing.map((name) => ({
      name,
      primary_muscles: [] as string[],
      secondary_muscles: [] as string[],
      muscles: [] as string[],
      equipment: null,
      video_url: null,
      cues: [] as string[],
      setup_cues: [] as string[],
      tags: [] as string[],
      conditions: [] as string[],
      progression_ids: [] as string[],
      regression_ids: [] as string[],
      purpose: null,
      source: 'ai',
    }));
    const { data: inserted, error } = await admin
      .from('pt_exercises')
      .insert(toInsert)
      .select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles, tags');
    if (error) throw new Error(`Could not create missing exercise cards: ${error.message}`);
    for (const row of (inserted ?? []) as LibraryRow[]) {
      resolved.set(row.name, row);
      byNorm.set(normalise(row.name), row);
    }
  }

  const old = context.selectedPhase;
  const weekBlocks = sanitiseWeekBlocks(parsed.week_blocks, old);
  const days = (parsed.days ?? []).map((day, dayIndex) => {
    let lastSection = '';
    const supersetMainLiftSeen = new Set<string>();
    const exercises = (day.exercises ?? []).map((ex, exIndex) => {
      const name = String(ex.name ?? '').trim();
      const row = resolved.get(name) ?? matchLibrary(name, byNorm, context.library);
      const section = SECTIONS.includes(ex.section as typeof SECTIONS[number]) ? ex.section! : 'Workout';
      const sectionStart = section !== lastSection ? section : undefined;
      lastSection = section;
      const pattern = sanitizePattern(ex.pattern) ?? inferPattern(row?.name ?? name, row);
      const proposedSupersetId = ex.superset_label ? `ss-${dayIndex + 1}-${slug(String(ex.superset_label))}` : null;
      const isMainLift = isBigMainLift(row?.name ?? name, pattern);
      let supersetId = proposedSupersetId;
      if (proposedSupersetId && isMainLift) {
        if (supersetMainLiftSeen.has(proposedSupersetId)) {
          supersetId = `ss-${dayIndex + 1}-main-${slug(row?.name ?? name)}`;
        } else {
          supersetMainLiftSeen.add(proposedSupersetId);
        }
      }
      const exercise: Exercise = {
        id: `ex-${dayIndex + 1}-${exIndex + 1}-${slug(row?.name ?? name)}`,
        exercise_id: row?.id ?? null,
        name: row?.name ?? name,
        sets: String(ex.sets ?? '3'),
        reps: String(ex.reps ?? '8-12'),
        rest: String(ex.rest ?? ''),
        notes: String(ex.notes ?? ''),
        video_url: row?.video_url ?? null,
        cues: row?.cues ?? [],
        superset_id: supersetId,
        section_start: sectionStart,
        pattern,
      };
      if (ex.weight_pct && matchCanonical(exercise.name ?? '')) {
        exercise.week_overrides = [{ block_index: 0, weight_pct: String(ex.weight_pct) }];
      }
      return exercise;
    });
    return {
      id: day.id ?? `day-${dayIndex + 1}-${slug(String(day.title ?? 'day'))}`,
      title: String(day.title ?? `Day ${dayIndex + 1}`),
      focus: String(day.focus ?? ''),
      exercises,
    };
  });

  return {
    id: old?.id ?? `phase-rebuild-${Date.now()}`,
    title: String(parsed.title ?? old?.title ?? 'Rebuilt phase'),
    focus: String(parsed.focus ?? old?.focus ?? ''),
    weeks: String(parsed.weeks ?? old?.weeks ?? totalWeeks(weekBlocks)),
    progression: String(parsed.progression ?? 'Rebuilt from Pedro voice/text chat.'),
    week_blocks: weekBlocks,
    days,
  };
}

function auditPhase(phase: Phase, context: Context, written: WrittenPhase, runId: string) {
  const weeklySetVolume = calculateWeeklySetVolume(phase, context.library);
  const patternCoverage = calculatePatternCoverage(phase);
  const splitSelected = written.split_selected || inferSplit(phase.days?.length ?? 0);
  const balance = auditBalance(phase);
  const clientNeedsApplied = extractClientNeeds(context);
  return {
    phase_rebuild_chat_run_id: runId,
    weekly_set_volume: weeklySetVolume,
    movement_pattern_coverage: patternCoverage,
    split_selected: splitSelected,
    unilateral_bilateral_balance: balance,
    client_needs_applied: clientNeedsApplied,
    web_research_used: Boolean(written.web_research_used),
    llm_weekly_set_volume: written.weekly_set_volume ?? {},
    llm_movement_pattern_coverage: written.movement_pattern_coverage ?? {},
    assumptions: written.assumptions ?? [],
    review_notes: written.review_notes ?? [],
  };
}

function calculatePatternCoverage(phase: Phase): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of phase.days ?? []) {
    for (const ex of day.exercises ?? []) {
      if (sectionOf(ex) !== 'Workout') continue;
      const pattern = sanitizePattern(ex.pattern) ?? inferPattern(ex.name ?? '', null);
      out[pattern] = (out[pattern] ?? 0) + 1;
    }
  }
  return out;
}

function calculateWeeklySetVolume(phase: Phase, library: LibraryRow[]): Record<string, number> {
  const byNorm = new Map(library.map((row) => [normalise(row.name), row]));
  const out: Record<string, number> = {};
  for (const day of phase.days ?? []) {
    for (const ex of day.exercises ?? []) {
      if (sectionOf(ex) !== 'Workout') continue;
      const sets = Number.parseInt(String(ex.sets ?? '0'), 10);
      if (!Number.isFinite(sets) || sets <= 0) continue;
      const row = byNorm.get(normalise(ex.name ?? '')) ?? null;
      const muscles = musclesFor(ex, row);
      for (const muscle of muscles) out[muscle] = (out[muscle] ?? 0) + sets;
    }
  }
  return out;
}

function musclesFor(ex: Exercise, row: LibraryRow | null): string[] {
  const direct = [...(row?.primary_muscles ?? []), ...(row?.muscles ?? [])].map((m) => normalMuscle(m)).filter(Boolean);
  if (direct.length > 0) return [...new Set(direct)];
  const pattern = sanitizePattern(ex.pattern) ?? inferPattern(ex.name ?? '', row);
  if (pattern.includes('push')) return ['chest', 'shoulders', 'triceps'];
  if (pattern.includes('pull')) return ['back', 'biceps'];
  if (pattern === 'squat' || pattern === 'unilateral_lower' || pattern === 'bilateral_lower') return ['quads', 'glutes'];
  if (pattern === 'hinge') return ['hamstrings', 'glutes', 'back'];
  if (pattern === 'core') return ['core'];
  if (pattern === 'corrective') return ['corrective'];
  return ['other'];
}

function normalMuscle(muscle: string): string {
  const lower = muscle.toLowerCase();
  if (lower.includes('quad')) return 'quads';
  if (lower.includes('ham')) return 'hamstrings';
  if (lower.includes('glute')) return 'glutes';
  if (lower.includes('chest') || lower.includes('pec')) return 'chest';
  if (lower.includes('lat') || lower.includes('back') || lower.includes('trap') || lower.includes('rhomboid')) return 'back';
  if (lower.includes('shoulder') || lower.includes('delt')) return 'shoulders';
  if (lower.includes('core') || lower.includes('ab') || lower.includes('oblique')) return 'core';
  if (lower.includes('bicep')) return 'biceps';
  if (lower.includes('tricep')) return 'triceps';
  if (lower.includes('calf')) return 'calves';
  return lower.trim();
}

function auditBalance(phase: Phase) {
  return (phase.days ?? []).map((day) => {
    const patterns = (day.exercises ?? []).filter((ex) => sectionOf(ex) === 'Workout').map((ex) => sanitizePattern(ex.pattern) ?? inferPattern(ex.name ?? '', null));
    return {
      day_title: day.title,
      has_single_arm: patterns.some((p) => p === 'single_arm_push' || p === 'single_arm_pull'),
      has_two_arm: patterns.some((p) => p === 'two_arm_push' || p === 'two_arm_pull' || p === 'horizontal_push' || p === 'horizontal_pull' || p === 'vertical_push' || p === 'vertical_pull'),
      has_single_leg: patterns.includes('unilateral_lower'),
      has_two_leg: patterns.includes('bilateral_lower') || patterns.includes('squat') || patterns.includes('hinge'),
      patterns,
    };
  });
}

function extractClientNeeds(context: Context): string[] {
  const doc = context.exerciseDoc ?? {};
  const needs = [
    doc.injury_history,
    doc.current_limitations,
    doc.weak_movements,
    doc.movement_mind_map,
    doc.movement_assessment_summary,
    context.client?.coaching_focus,
    context.client?.goals,
  ].filter(Boolean);
  return needs.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).map((item) => item.slice(0, 700));
}

function sectionOf(ex: Exercise): string {
  return ex.section_start ?? ex.section ?? 'Workout';
}

function inferSplit(dayCount: number) {
  if (dayCount === 2) return 'Full Body A/B';
  if (dayCount === 3) return 'Full Body A/B/C';
  if (dayCount === 4) return 'Lower A / Upper A / Lower B / Upper B';
  if (dayCount === 5) return 'Lower A / Upper A / Full Body / Lower B / Upper B';
  return `${dayCount} day custom split`;
}

function sanitizePattern(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return (PATTERNS as readonly string[]).includes(text) ? text : null;
}

function inferPattern(name: string, row: LibraryRow | null): string {
  const lower = name.toLowerCase();
  const tags = [...(row?.tags ?? []), ...(row?.primary_muscles ?? []), ...(row?.secondary_muscles ?? []), ...(row?.muscles ?? [])].join(' ').toLowerCase();
  const haystack = `${lower} ${tags}`;
  if (haystack.includes('single arm') || haystack.includes('single-arm') || haystack.includes('one arm')) {
    if (haystack.includes('row') || haystack.includes('pull')) return 'single_arm_pull';
    return 'single_arm_push';
  }
  if (haystack.includes('single leg') || haystack.includes('single-leg') || haystack.includes('split squat') || haystack.includes('lunge') || haystack.includes('step up')) return 'unilateral_lower';
  if (haystack.includes('bench') || haystack.includes('chest press') || haystack.includes('push up') || haystack.includes('push-up')) return 'horizontal_push';
  if (haystack.includes('row') || haystack.includes('face pull')) return 'horizontal_pull';
  if (haystack.includes('shoulder press') || haystack.includes('overhead press') || haystack.includes('ohp')) return 'vertical_push';
  if (haystack.includes('pull-up') || haystack.includes('pullup') || haystack.includes('pull down') || haystack.includes('pulldown')) return 'vertical_pull';
  if (haystack.includes('deadlift') || haystack.includes('rdl') || haystack.includes('hinge') || haystack.includes('hip thrust')) return 'hinge';
  if (haystack.includes('squat') || haystack.includes('leg press') || haystack.includes('knee extension')) return 'squat';
  if (haystack.includes('core') || haystack.includes('crunch') || haystack.includes('plank') || haystack.includes('dead bug') || haystack.includes('pallof')) return 'core';
  if (haystack.includes('mobility') || haystack.includes('cars') || haystack.includes('stretch') || haystack.includes('corrective')) return 'corrective';
  return 'corrective';
}

function isBigMainLift(name: string, pattern?: string | null): boolean {
  const lower = normalise(name);
  const mainPatterns = new Set(['squat', 'hinge', 'horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull']);
  if (pattern && !mainPatterns.has(pattern)) return false;
  return [
    'back squat',
    'front squat',
    'barbell squat',
    'goblet squat',
    'deadlift',
    'romanian deadlift',
    'hip thrust',
    'bench press',
    'chest press',
    'shoulder press',
    'overhead press',
    'pull up',
    'pullup',
    'pull down',
    'pulldown',
    'barbell row',
    'machine row',
    'seated row',
    'chest supported row',
    'leg press',
  ].some((term) => lower.includes(term));
}

function sanitiseWeekBlocks(blocks: Phase['week_blocks'], old: Phase | null): Phase['week_blocks'] {
  const cleaned = (blocks ?? [])
    .map((block) => ({
      weeks: Number(block.weeks),
      sets: block.sets ? String(block.sets) : undefined,
      weight_pct: block.weight_pct ? String(block.weight_pct) : undefined,
    }))
    .filter((block) => Number.isFinite(block.weeks) && block.weeks > 0 && (block.sets || block.weight_pct));
  if (cleaned.length > 0) return cleaned;
  if (old?.week_blocks && old.week_blocks.length > 0) return old.week_blocks;
  return [{ weeks: Number.parseInt(old?.weeks ?? '4', 10) || 4, sets: '3', weight_pct: inferDefaultPct(old?.title ?? '') }];
}

function inferDefaultPct(title: string): string | undefined {
  const lower = title.toLowerCase();
  if (lower.includes('hypertrophy')) return '65%';
  if (lower.includes('strength')) return '77%';
  return undefined;
}

function totalWeeks(blocks: Phase['week_blocks']) {
  return String((blocks ?? []).reduce((sum, block) => sum + (Number(block.weeks) || 0), 0) || 4);
}

function buildOneRmMap(rows: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const r = row as { exercise_name?: string; estimated_1rm_kg?: number | null; tested_weight_kg?: number | null };
    const canonical = matchCanonical(r.exercise_name ?? '');
    const value = Number(r.estimated_1rm_kg ?? r.tested_weight_kg ?? 0);
    if (!canonical || !Number.isFinite(value) || value <= 0) continue;
    out[canonical] = Math.max(out[canonical] ?? 0, value);
  }
  return out;
}

function resolveLoads(phase: Phase, oneRmMap: Record<string, number>) {
  const out: Array<Record<string, unknown>> = [];
  for (const day of phase.days ?? []) {
    for (const exercise of day.exercises ?? []) {
      const canonical = matchCanonical(exercise.name ?? '');
      const oneRm = canonical ? oneRmMap[canonical] : null;
      if (!canonical || !oneRm) continue;
      for (const [blockIndex, block] of (phase.week_blocks ?? []).entries()) {
        const override = exercise.week_overrides?.find((item) => item.block_index === blockIndex);
        const pct = override?.weight_pct ?? block.weight_pct;
        if (!pct) continue;
        const kg = resolveKgFromPct(String(pct), oneRm);
        if (kg === null) continue;
        out.push({
          exercise_name: exercise.name,
          canonical_exercise: canonical,
          day_title: day.title,
          block_index: blockIndex,
          weight_pct: pct,
          one_rm_kg: oneRm,
          resolved_kg: kg,
        });
      }
    }
  }
  return out;
}

function matchCanonical(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [canonical, aliases] of Object.entries(BIG_5_ALIASES)) {
    if (aliases.some((alias) => lower.includes(alias))) return canonical;
  }
  return null;
}

function resolveKgFromPct(pctStr: string, oneRmKg: number): number | null {
  const pct = Number.parseFloat(pctStr.replace('%', '').trim());
  if (!Number.isFinite(pct) || pct <= 0 || pct > 200) return null;
  return Math.round(oneRmKg * (pct / 100) * 4) / 4;
}

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bbb\b/g, 'barbell')
    .replace(/\bdb\b/g, 'dumbbell')
    .replace(/\bkb\b/g, 'kettlebell')
    .replace(/\brdl\b/g, 'romanian deadlift')
    .replace(/\bohp\b/g, 'overhead press')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchLibrary(name: string, byNorm: Map<string, LibraryRow>, library: LibraryRow[]): LibraryRow | null {
  const norm = normalise(name);
  if (!norm) return null;
  const exact = byNorm.get(norm);
  if (exact) return exact;
  let best: LibraryRow | null = null;
  let bestLen = 0;
  for (const row of library) {
    const rn = normalise(row.name);
    if ((norm.includes(rn) || rn.includes(norm)) && rn.length > bestLen) {
      best = row;
      bestLen = rn.length;
    }
  }
  return best;
}

function summarizeMessages(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role}: ${message.content}`).join('\n').slice(0, 5000);
}

async function markRunFailed(admin: ReturnType<typeof createClient>, runId: string, reason: string) {
  await admin.from('pt_program_generation_runs').update({
    status: 'failed',
    current_command: 'PHASE_REBUILD_FAILED',
    failure_reason: reason,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', runId);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'item';
}

async function claudeText(
  anthropic: Anthropic,
  opts: { system: string; user: string; maxTokens: number; timeoutMs?: number; webSearch?: boolean },
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  const tools = opts.webSearch ? [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 2,
    },
  ] : undefined;
  try {
    const msg = await anthropic.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: opts.maxTokens,
        system: opts.system,
        ...(tools ? { tools } : {}),
        messages: [{ role: 'user', content: opts.user }],
      } as any,
      { signal: ctrl.signal },
    );
    return extractTextFromBlocks(msg.content as unknown[]);
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromBlocks(blocks: unknown[]): string {
  return blocks.map((block) => {
    const b = block as { type?: string; text?: string };
    return b.type === 'text' && typeof b.text === 'string' ? b.text : '';
  }).join('\n').trim();
}

async function claudeJson<T>(
  anthropic: Anthropic,
  opts: { system: string; user: string; maxTokens: number; timeoutMs?: number; webSearch?: boolean },
): Promise<T | null> {
  const text = (await claudeText(anthropic, opts)).trim();
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as T;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || /abort|timeout/i.test(error.message));
}

function jsonCandidates(text: string): string[] {
  const out = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) out.push(fenced[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) out.push(text.slice(start, end + 1));
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
