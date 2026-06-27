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

const WARMUP_ONLY_NAMES = [
  'Dead Bug',
  'Bird Dog',
  'Cobra to Child Pose',
  'Downward Dog',
  'Spiderman Lunge with Thoracic Rotation',
  'Glute Bridge',
  'Hip Airplanes',
  'Clamshells',
  'Active Thoracic Extension',
  '90/90 Hip Switch',
  'Cat Cow',
];

const EXERCISE_SELECT = 'id, name, video_url, cues, primary_muscles, secondary_muscles, muscles, equipment, tags';

const PREFERRED_WARMUPS: Array<{ names: string[]; patterns: string[]; reps: string; notes: string }> = [
  { names: ['Cobra to Child Pose', 'Cobra Child Pose'], patterns: ['horizontal_push', 'vertical_push', 'vertical_pull', 'horizontal_pull', 'corrective'], reps: '8-10', notes: 'Spine, shoulder, and lat preparation.' },
  { names: ['Downward Dog'], patterns: ['hinge', 'squat', 'vertical_push', 'vertical_pull', 'corrective'], reps: '30 sec', notes: 'Posterior chain and shoulder preparation.' },
  { names: ['Spiderman Lunge with Thoracic Rotation', 'Spiderman Lunges Thoracic Rotations', 'Spiderman Lunge Thoracic Rotations'], patterns: ['squat', 'hinge', 'unilateral_lower', 'horizontal_push', 'vertical_pull', 'corrective'], reps: '8 each side', notes: 'Hip and thoracic preparation.' },
  { names: ['Glute Bridge', 'Glute Bridges'], patterns: ['hinge', 'squat', 'unilateral_lower', 'bilateral_lower'], reps: '10-12', notes: 'Glute activation before lower-body work.' },
  { names: ['Dead Bug'], patterns: ['core', 'squat', 'hinge', 'unilateral_lower'], reps: '8 each side', notes: 'Trunk control before loading.' },
  { names: ['Bird Dog'], patterns: ['core', 'hinge', 'horizontal_pull', 'unilateral_lower'], reps: '8 each side', notes: 'Posterior-chain and trunk sequencing.' },
  { names: ['Hip Airplanes'], patterns: ['unilateral_lower', 'hinge', 'squat', 'bilateral_lower'], reps: '6 each side', notes: 'Hip control and single-leg stability.' },
  { names: ['Clamshells', 'Clamshell'], patterns: ['unilateral_lower', 'squat', 'hinge', 'bilateral_lower'], reps: '10-12 each side', notes: 'Glute med and knee-control preparation.' },
];

const CHAT_SYSTEM = `You are Pedro Avila's phase rebuild chat agent inside Cerebro.

The coach is replacing ONE selected programme phase. Behave like a practical programming assistant:
- Read the client context, movement analysis, injuries, weak/tight muscles, recent training, 1RM data, and the active phase.
- Ask ONE short question at a time only when a critical decision is missing.
- If the coach gives enough information, return ready=true and summarize the captured plan.
- Detect scope: if the coach says adapt, adjust, modify, current programme, current phase, equipment access, or make this work with available equipment, preserve the current phase structure and change only what is needed. If the coach says redo, rebuild, from scratch, new programme, new phase, or whole programme, rebuild the selected phase.
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
    "change_scope": "adapt_current" | "rebuild_phase" | null,
    "assumptions": string[]
  }
}

Ask about missing details in this priority:
1. number of training days if not inferable;
2. main lift/main intent for any day that is unclear;
3. important constraints that affect pain, injury, equipment, or phase progression. If the coach gives a limited equipment list, treat that list as strict.

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
- Respect Pedro's equipment restrictions exactly. If he gives a limited equipment list, do not use machines or tools outside it. Hamstring Curl / Leg Curl requires an explicit hamstring curl or leg curl machine; do not use it just because it is a common posterior-chain accessory.
- Build the Workout section first. Then select exactly 3 Warm Up exercises based on the day's workout muscles, movement patterns, injuries, and client needs.
- Use Pedro's preferred warm-up pool first: Cobra to Child Pose, Downward Dog, Spiderman Lunge with Thoracic Rotation, Glute Bridge, Dead Bug, Bird Dog, Hip Airplanes, Clamshells.
- Dead Bug, Bird Dog, Cobra to Child Pose, Downward Dog, Spiderman Lunge with Thoracic Rotation, Glute Bridge, Hip Airplanes, and Clamshells belong in Warm Up, not Workout, unless Pedro explicitly says otherwise.
- Weekly set volume matters most. Choose conservative set targets from client level, injury status, recovery, and phase goal unless Pedro specified exact targets.
- Put Pedro's requested main lift/main movement near the top of each day's Workout section.
- Include Pedro's must-use exercises unless client history makes that inappropriate; explain in review_notes if changed.
- Consider client history: avoid needless recent repetition unless Pedro requested it, respect assessment/client constraints, and keep the phase coach-editable.
- Warm Up exactly 3 items, then Workout main work plus useful accessories. Optional MetCon/Stretches only if requested or clearly useful.
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
    const captured = await loadChatCaptured(admin, runId);
    const requestedDayCount = inferRequestedDayCount(messages, context.selectedPhase, captured);
    const constraints = inferGenerationConstraints(context, messages);
    const generationMode = inferGenerationMode(messages, constraints);

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
      questionOrDecision: generationMode === 'adapt_current'
        ? 'Adapt the current selected phase to Pedro instructions while preserving the existing programme structure where possible.'
        : 'Build a client-specific phase using weekly set volume, movement-pattern coverage, injuries, movement analysis, and Pedro split rules.',
    });

    await admin.from('pt_program_generation_runs').update({
      current_command: generationMode === 'adapt_current' ? 'PHASE_ADAPT_CURRENT' : 'PHASE_GENERATE_REPLACEMENT',
      status: 'running',
      updated_at: new Date().toISOString(),
    }).eq('id', runId);

    let written: WrittenPhase | null = null;
    if (generationMode === 'adapt_current') {
      written = buildAdaptedCurrentPhase(context, messages, constraints);
      await appendStep(admin, runId, 'PHASE_ADAPT_CURRENT', {
        mode: generationMode,
        equipment_constraints: constraints,
      }, {
        phase: written.phase,
        assumptions: written.assumptions ?? [],
        review_notes: written.review_notes ?? [],
      });
    } else {
      try {
        written = await claudeJson<WrittenPhase>(anthropic, {
          system: WRITE_SYSTEM,
          user: buildWritePrompt(context, messages, knowledgeContext, constraints, captured, requestedDayCount),
          maxTokens: 4200,
          timeoutMs: 32_000,
        });
      } catch (error) {
        const fallbackReason = isAbortError(error)
          ? 'AI writer timed out; deterministic fallback phase was created.'
          : error instanceof Error
            ? `AI writer failed: ${error.message}. Deterministic fallback phase was created.`
            : 'AI writer failed; deterministic fallback phase was created.';
        written = buildDeterministicPhase(context, messages, fallbackReason, constraints, requestedDayCount);
        await appendStep(admin, runId, 'PHASE_WRITER_FALLBACK', {
          reason: fallbackReason,
          requested_day_count: requestedDayCount,
        }, {
          phase: written.phase,
          assumptions: written.assumptions ?? [],
          review_notes: written.review_notes ?? [],
        });
      }
    }
    if (!written?.phase?.days || !Array.isArray(written.phase.days)) {
      written = buildDeterministicPhase(
        context,
        messages,
        'AI writer returned an incomplete phase; deterministic fallback phase was created.',
        constraints,
        requestedDayCount,
      );
      await appendStep(admin, runId, 'PHASE_WRITER_FALLBACK', {
        reason: 'AI writer returned an incomplete phase.',
        requested_day_count: requestedDayCount,
      }, {
        phase: written.phase,
        assumptions: written.assumptions ?? [],
        review_notes: written.review_notes ?? [],
      });
    }
    if (
      generationMode === 'rebuild_phase'
      && written.phase.days.length !== requestedDayCount
    ) {
      const returnedDayCount = written.phase.days.length;
      written = buildDeterministicPhase(
        context,
        messages,
        `Generated ${returnedDayCount} days, but Pedro requested ${requestedDayCount}. A corrected deterministic phase was created.`,
        constraints,
        requestedDayCount,
      );
      await appendStep(admin, runId, 'PHASE_DAY_COUNT_CORRECTION', {
        requested_day_count: requestedDayCount,
        returned_day_count: returnedDayCount,
        captured_days_requested: captured.days_requested ?? null,
      }, {
        phase: written.phase,
        assumptions: written.assumptions ?? [],
        review_notes: written.review_notes ?? [],
      });
    }

    await appendStep(admin, runId, 'PHASE_STRUCTURE_PLANNER', {
      messages,
      captured,
      requested_day_count: requestedDayCount,
      knowledge_context: knowledgeContext,
      equipment_constraints: constraints,
      generation_mode: generationMode,
    }, {
      split_selected: written.split_selected ?? null,
      assumptions: written.assumptions ?? [],
      review_notes: written.review_notes ?? [],
    });

    try {
      const assembled = await assemblePhase(admin, written.phase, context, constraints);
      const resolvedLoads = resolveLoads(assembled, context.oneRmMap);
      const audit = auditPhase(assembled, context, written, runId);

      await appendStep(admin, runId, 'PHASE_VOLUME_PATTERN_AUDIT', {
        phase_id: assembled.id,
      }, audit);
      await appendStep(admin, runId, 'PHASE_GENERATE_REPLACEMENT', {
        phase_index: phaseIndex,
        generation_mode: generationMode,
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
          generation_mode: generationMode,
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
        generation_mode: generationMode,
        split_selected: audit.split_selected,
        unilateral_bilateral_balance: audit.unilateral_bilateral_balance,
        client_needs_applied: audit.client_needs_applied,
        web_research_used: Boolean(written.web_research_used),
        matched_count: assembled.days.flatMap((d) => d.exercises).filter((e) => e.exercise_id).length,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not assemble the adapted phase.';
      await markRunFailed(admin, runId, reason);
      return json({ error: reason }, 500);
    }
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
  equipment?: string | null;
  tags?: string[] | null;
}
interface GenerationConstraints {
  limitedEquipment: boolean;
  allowedEquipment: string[];
  notes: string[];
}
type GenerationMode = 'adapt_current' | 'rebuild_phase';
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
    admin.from('pt_exercises').select(EXERCISE_SELECT).order('name'),
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

async function loadChatCaptured(admin: ReturnType<typeof createClient>, runId: string): Promise<Record<string, unknown>> {
  const { data } = await admin
    .from('pt_program_generation_steps')
    .select('input_json')
    .eq('run_id', runId)
    .eq('command_name', 'PHASE_CHAT_AGENT_QUESTION')
    .order('step_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const input = typeof data?.input_json === 'object' && data.input_json !== null
    ? data.input_json as Record<string, unknown>
    : {};
  return typeof input.captured === 'object' && input.captured !== null
    ? input.captured as Record<string, unknown>
    : {};
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

function buildWritePrompt(
  context: Context,
  messages: ChatMessage[],
  knowledgeContext: Record<string, unknown>,
  constraints: GenerationConstraints,
  captured: Record<string, unknown>,
  requestedDayCount: number,
) {
  return JSON.stringify({
    chat_messages: messages,
    captured_plan: captured,
    requested_day_count: requestedDayCount,
    hard_output_contract: {
      exact_day_count: requestedDayCount,
      reject_other_day_counts: true,
    },
    selected_phase_index: context.phaseIndex,
    selected_phase: compactPhase(context.selectedPhase),
    existing_programme_outline: compactProgramme(context),
    client_context: compactClientContext(context, 1200),
    recent_training_summary: compactTraining(context, 0),
    one_rm_map: context.oneRmMap,
    library_names: selectRelevantLibraryNames(context, messages),
    equipment_constraints: constraints,
    warmup_rules: {
      timing: 'Build Workout first, then select exactly 3 Warm Up exercises for each day.',
      preferred_pool: PREFERRED_WARMUPS.map((item) => item.names[0]),
      warmup_only: WARMUP_ONLY_NAMES,
    },
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

function buildDeterministicPhase(
  context: Context,
  messages: ChatMessage[],
  reason: string,
  constraints: GenerationConstraints,
  requestedDayCount?: number,
): WrittenPhase {
  const dayCount = requestedDayCount ?? inferRequestedDayCount(messages, context.selectedPhase);
  const phaseTitle = context.selectedPhase?.title ?? `${dayCount}-day rebuilt phase`;
  const phaseFocus = context.selectedPhase?.focus || `${inferSplit(dayCount)} with main lifts separated into their own supersets.`;
  const days = dayCount <= 3
    ? buildFullBodyFallbackDays(context, dayCount, constraints)
    : dayCount === 4
      ? buildUpperLowerFallbackDays(context, constraints)
      : buildFiveDayFallbackDays(context, constraints);

  return {
    phase: {
      id: context.selectedPhase?.id,
      title: phaseTitle,
      focus: phaseFocus,
      weeks: context.selectedPhase?.weeks ?? '4',
      progression: context.selectedPhase?.progression ?? 'Deterministic fallback draft created from Pedro chat, client context, and selected phase structure.',
      week_blocks: context.selectedPhase?.week_blocks,
      days,
    },
    split_selected: inferSplit(dayCount),
    weekly_set_volume: {},
    movement_pattern_coverage: {},
    questions_answered: messages.filter((message) => message.role === 'user').map((message) => message.content).slice(-3),
    assumptions: [
      `Requested ${dayCount} training day${dayCount === 1 ? '' : 's'} from the chat, or carried over from the selected phase.`,
      'Main lifts are separated by default and paired with smaller core, corrective, mobility, or accessory work.',
      constraints.limitedEquipment
        ? `Exercise choices are restricted to available equipment: ${constraints.allowedEquipment.join(', ')}.`
        : 'Equipment was not restricted by Pedro, so gym access was assumed.',
      'Review exercise selection manually before saving.',
    ],
    review_notes: [
      reason,
      'Fallback draft prioritises reliability, Big 5 spread, no two main lifts in the same superset, and coach-editable structure.',
    ],
    web_research_used: false,
  };
}

function buildAdaptedCurrentPhase(context: Context, messages: ChatMessage[], constraints: GenerationConstraints): WrittenPhase {
  const selected = context.selectedPhase;
  const phase = clonePhase(selected) ?? {
    id: `phase-adapt-${Date.now()}`,
    title: 'Adapted phase',
    focus: 'Adapted from current phase.',
    weeks: '4',
    days: [],
  };
  return {
    phase,
    split_selected: inferSplit(phase.days?.length ?? 0),
    weekly_set_volume: {},
    movement_pattern_coverage: {},
    questions_answered: messages.filter((message) => message.role === 'user').map((message) => message.content).slice(-4),
    assumptions: [
      'Pedro asked to adapt the current phase, so the existing day structure, allowed exercises, sets, reps, rest, and phase blocks were preserved where possible.',
      constraints.limitedEquipment
        ? `Only exercises compatible with available equipment were kept: ${constraints.allowedEquipment.join(', ')}.`
        : 'No strict equipment list was detected, so gym access was assumed.',
      'Unavailable exercises are replaced by same-pattern alternatives before Pedro reviews the draft.',
    ],
    review_notes: [
      'Adapt-current mode was used. This is not a full re-programme.',
      'Warm-ups were regenerated after the existing Workout sections were checked.',
    ],
    web_research_used: false,
  };
}

function clonePhase(phase: Phase | null): Phase | null {
  if (!phase) return null;
  return JSON.parse(JSON.stringify(phase)) as Phase;
}

function inferRequestedDayCount(
  messages: ChatMessage[],
  selectedPhase: Phase | null,
  captured: Record<string, unknown> = {},
): number {
  const userMessages = messages.filter((message) => message.role === 'user').reverse();
  for (const message of userMessages) {
    const text = normaliseCountWords(message.content.toLowerCase());
    const patterns = [
      /\b(?:only\s+)?([2-5])\s*(?:days?|workouts?|sessions?)\s*(?:per|a)\s*week\b/,
      /\b(?:only\s+)?([2-5])\s*(?:x|times)\s*(?:per|a)?\s*week\b/,
      /\b(?:only\s+)?([2-5])[-\s]*(?:day|days)\s*(?:workout|training|programme|program)?\s*(?:week)?\b/,
      /\b(?:only\s+)?([2-5])\s+(?:full[-\s]?body\s+)?days?\b/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return clampDayCount(Number(match[1]));
    }
  }
  const capturedCount = Number(captured.days_requested);
  if (Number.isFinite(capturedCount) && capturedCount >= 2 && capturedCount <= 5) {
    return clampDayCount(capturedCount);
  }
  const selectedCount = selectedPhase?.days?.length ?? 0;
  return clampDayCount(selectedCount || 3);
}

function normaliseCountWords(value: string): string {
  const numbers: Record<string, string> = {
    two: '2',
    three: '3',
    four: '4',
    five: '5',
  };
  return value.replace(/\b(two|three|four|five)\b/g, (word) => numbers[word] ?? word);
}

function clampDayCount(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(2, Math.round(value)));
}

function buildFullBodyFallbackDays(context: Context, dayCount: number, constraints: GenerationConstraints): Day[] {
  const templates = [
    {
      title: 'Day 1 - Full Body A',
      focus: 'Squat main lift, horizontal push, single-arm pull, core and stability.',
      workout: [
        mainExercise(context, ['Back Squat', 'BB Back Squat', 'Barbell Back Squat', 'Leg Press'], 'squat', 'A', constraints),
        smallExercise(context, ['Pallof Press', 'Side Plank', 'Plank'], 'core', 'A', constraints),
        mainExercise(context, ['Barbell Bench Press', 'BB Bench Press', 'Chest Press'], 'horizontal_push', 'B', constraints),
        smallExercise(context, ['Single Leg RDL', 'DB Single-Leg RDL', 'Barbell Hip Thrust', 'Leg Press'], 'hinge', 'B', constraints),
        smallExercise(context, ['Single Arm DB Row', 'Single-Arm DB Row', 'Row Machine'], 'single_arm_pull', 'C', constraints),
        smallExercise(context, ['Cossack Squat', 'Split Squat', 'Reverse Lunge'], 'unilateral_lower', 'C', constraints),
        smallExercise(context, ['Hanging Knee Raise', 'Side Plank', 'Plank'], 'core', 'D', constraints),
      ],
    },
    {
      title: 'Day 2 - Full Body B',
      focus: 'Deadlift main lift, vertical push, vertical pull, unilateral lower support.',
      workout: [
        mainExercise(context, ['Conventional Deadlift', 'BB Deadlift', 'Barbell Deadlift', 'Barbell Hip Thrust'], 'hinge', 'A', constraints),
        smallExercise(context, ['Side Plank', 'Plank', 'Pallof Press'], 'core', 'A', constraints),
        mainExercise(context, ['Overhead Press', 'BB Shoulder Press', 'Shoulder Press', 'DB Shoulder Press'], 'vertical_push', 'B', constraints),
        smallExercise(context, ['Split Squat', 'Rear Foot Elevated Split Squat', 'Reverse Lunge'], 'unilateral_lower', 'B', constraints),
        mainExercise(context, ['Lat Pulldown', 'Pull-up', 'Pull Up'], 'vertical_pull', 'C', constraints),
        smallExercise(context, ['Rear Delt Fly', 'Face Pull', 'Pec Fly'], 'horizontal_pull', 'C', constraints),
        smallExercise(context, ['Hanging Knee Raise', 'Side Plank', 'Plank'], 'core', 'D', constraints),
      ],
    },
    {
      title: 'Day 3 - Full Body C',
      focus: 'Hip thrust or pull main lift, lower accessory, posterior chain and trunk.',
      workout: [
        mainExercise(context, ['Barbell Hip Thrust', 'BB Hip Thrust', 'Hip Thrust'], 'hinge', 'A', constraints),
        smallExercise(context, ['Side Plank', 'Pallof Press', 'Plank'], 'core', 'A', constraints),
        mainExercise(context, ['Pull-up', 'Pull Up', 'Lat Pulldown'], 'vertical_pull', 'B', constraints),
        smallExercise(context, ['Leg Press', 'Goblet Squat', 'Bodyweight Squat'], 'squat', 'C', constraints),
        smallExercise(context, ['Single Leg RDL', 'DB Single-Leg RDL', 'Single Leg Romanian Deadlift'], 'unilateral_lower', 'D', constraints),
        smallExercise(context, ['Rear Delt Fly', 'Face Pull', 'Pec Fly'], 'horizontal_pull', 'D', constraints),
        smallExercise(context, ['Hanging Knee Raise', 'Side Plank', 'Plank'], 'core', 'E', constraints),
      ],
    },
  ];
  return templates.slice(0, dayCount).map((template, index) => fallbackDay(context, template, index, constraints));
}

function buildUpperLowerFallbackDays(context: Context, constraints: GenerationConstraints): Day[] {
  return [
    fallbackDay(context, {
      title: 'Day 1 - Lower A',
      focus: 'Squat main lift with unilateral and trunk support.',
      workout: [
        mainExercise(context, ['Back Squat', 'BB Back Squat', 'Barbell Back Squat', 'Leg Press'], 'squat', 'A', constraints),
        smallExercise(context, ['Pallof Press', 'Side Plank', 'Plank'], 'core', 'A', constraints),
        smallExercise(context, ['Split Squat', 'Reverse Lunge'], 'unilateral_lower', 'B', constraints),
        smallExercise(context, ['Single Leg RDL', 'DB Single-Leg RDL', 'Barbell Hip Thrust'], 'hinge', 'B', constraints),
        smallExercise(context, ['Hanging Knee Raise', 'Side Plank', 'Plank'], 'core', 'C', constraints),
      ],
    }, 0, constraints),
    fallbackDay(context, {
      title: 'Day 2 - Upper A',
      focus: 'Horizontal push and pull with shoulder support.',
      workout: [
        mainExercise(context, ['Barbell Bench Press', 'BB Bench Press', 'Chest Press'], 'horizontal_push', 'A', constraints),
        smallExercise(context, ['Face Pull', 'Rear Delt Fly'], 'horizontal_pull', 'A', constraints),
        mainExercise(context, ['Lat Pulldown', 'Pull-up'], 'vertical_pull', 'B', constraints),
        smallExercise(context, ['Tricep Extension', 'Cable Tricep Extension', 'Dumbbell Tricep Extension'], 'vertical_push', 'B', constraints),
        smallExercise(context, ['Bicep Curl', 'Cable Bicep Curl', 'Dumbbell Bicep Curl'], 'single_arm_pull', 'C', constraints),
      ],
    }, 1, constraints),
    fallbackDay(context, {
      title: 'Day 3 - Lower B',
      focus: 'Deadlift or hip thrust main lift with single-leg work.',
      workout: [
        mainExercise(context, ['Conventional Deadlift', 'BB Deadlift', 'Barbell Deadlift', 'Barbell Hip Thrust'], 'hinge', 'A', constraints),
        smallExercise(context, ['Side Plank', 'Plank', 'Pallof Press'], 'core', 'A', constraints),
        mainExercise(context, ['Barbell Hip Thrust', 'Hip Thrust', 'Leg Press'], 'hinge', 'B', constraints),
        smallExercise(context, ['Cossack Squat', 'Split Squat'], 'unilateral_lower', 'C', constraints),
        smallExercise(context, ['Pallof Press', 'Hanging Knee Raise', 'Side Plank'], 'core', 'D', constraints),
      ],
    }, 2, constraints),
    fallbackDay(context, {
      title: 'Day 4 - Upper B',
      focus: 'Vertical push with row and single-arm support.',
      workout: [
        mainExercise(context, ['Overhead Press', 'BB Shoulder Press', 'Shoulder Press'], 'vertical_push', 'A', constraints),
        smallExercise(context, ['Calf Raise', 'Side Plank', 'Plank'], 'hinge', 'A', constraints),
        mainExercise(context, ['Row Machine', 'Seated Row', 'Chest Supported Row'], 'horizontal_pull', 'B', constraints),
        smallExercise(context, ['Single Arm DB Bench Press', 'DB Bench Press', 'Chest Press'], 'single_arm_push', 'C', constraints),
        smallExercise(context, ['Face Pull', 'Rear Delt Fly'], 'horizontal_pull', 'D', constraints),
      ],
    }, 3, constraints),
  ];
}

function buildFiveDayFallbackDays(context: Context, constraints: GenerationConstraints): Day[] {
  const days = buildUpperLowerFallbackDays(context, constraints);
  days.splice(2, 0, fallbackDay(context, {
    title: 'Day 3 - Full Body',
    focus: 'Efficient full-body stability day with no paired main lifts.',
    workout: [
      mainExercise(context, ['Leg Press', 'Goblet Squat', 'Bodyweight Squat'], 'squat', 'A', constraints),
      smallExercise(context, ['Pallof Press', 'Side Plank', 'Plank'], 'core', 'A', constraints),
      mainExercise(context, ['Lat Pulldown', 'Pull-up'], 'vertical_pull', 'B', constraints),
      smallExercise(context, ['Single Leg RDL', 'Reverse Lunge'], 'unilateral_lower', 'C', constraints),
      smallExercise(context, ['Hanging Knee Raise', 'Side Plank', 'Plank'], 'core', 'D', constraints),
    ],
  }, 2, constraints));
  return days.slice(0, 5).map((day, index) => ({ ...day, id: `fallback-day-${index + 1}-${slug(day.title ?? 'day')}` }));
}

function fallbackDay(
  context: Context,
  template: { title: string; focus: string; workout: Exercise[] },
  index: number,
  constraints: GenerationConstraints,
): Day {
  const warmups = buildWarmupExercises(context, template.workout, index, constraints);
  return {
    id: `fallback-day-${index + 1}-${slug(template.title)}`,
    title: template.title,
    focus: template.focus,
    exercises: [
      ...warmups,
      ...template.workout,
    ].map((exercise, exerciseIndex) => ({
      ...exercise,
      id: `fallback-ex-${index + 1}-${exerciseIndex + 1}-${slug(exercise.name ?? 'exercise')}`,
      section: exerciseIndex < warmups.length ? 'Warm Up' : 'Workout',
      section_start: exerciseIndex === 0 ? 'Warm Up' : exerciseIndex === warmups.length ? 'Workout' : undefined,
    })),
  };
}

function mainExercise(context: Context, names: string[], pattern: string, supersetLabel: string, constraints?: GenerationConstraints): Exercise {
  const name = resolveExerciseName(context, names, constraints);
  return {
    name,
    section: 'Workout',
    sets: '3',
    reps: pattern === 'squat' || pattern === 'hinge' ? '5-8' : '6-10',
    rest: '90 sec',
    notes: 'Main lift. Use RPE and the phase percentage tag when available.',
    superset_label: `Main ${supersetLabel}`,
    pattern,
  };
}

function smallExercise(context: Context, names: string[], pattern: string, supersetLabel: string, constraints?: GenerationConstraints): Exercise {
  const name = resolveExerciseName(context, names, constraints);
  return {
    name,
    section: 'Workout',
    sets: '2',
    reps: pattern === 'core' || pattern === 'corrective' ? '10-12' : '8-12',
    rest: '45-60 sec',
    notes: pattern === 'core' || pattern === 'corrective' ? 'Control and quality.' : 'Accessory support work.',
    superset_label: supersetLabel ? `Main ${supersetLabel}` : '',
    pattern,
  };
}

function resolveExerciseName(context: Context, candidates: string[], constraints?: GenerationConstraints) {
  const byNorm = new Map<string, LibraryRow>();
  for (const row of context.library) byNorm.set(normalise(row.name), row);
  for (const candidate of candidates) {
    const hit = matchLibrary(candidate, byNorm, context.library);
    if (hit?.name && isExerciseAllowed(hit.name, hit, constraints)) return hit.name;
    if (!hit && isExerciseAllowed(candidate, null, constraints)) return candidate;
  }
  return candidates.find((candidate) => !isWarmupOnlyName(candidate)) ?? candidates[0];
}

function inferGenerationMode(messages: ChatMessage[], constraints: GenerationConstraints): GenerationMode {
  const text = messages.map((message) => message.content).join('\n').toLowerCase();
  const rebuildRequested = /\b(re-?do|rebuild|recreate|start over|from scratch|whole programme|whole program|new programme|new program|new phase|replace the whole|redo the whole|build a new|create a new)\b/.test(text);
  if (rebuildRequested) return 'rebuild_phase';
  const adaptRequested = /\b(adapt|adjust|modify|tweak|edit|keep the current|current programme|current program|current phase|same programme|same program|fit|make it work|equipment|access to|available)\b/.test(text);
  if (adaptRequested || constraints.limitedEquipment) return 'adapt_current';
  return 'rebuild_phase';
}

function inferGenerationConstraints(context: Context, messages: ChatMessage[]): GenerationConstraints {
  const userText = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n');
  const contextText = [
    collectText(context.client, 1500),
    collectText(context.exerciseDoc, 2500),
    collectText(context.documents, 2500),
    collectText(context.notes, 1500),
  ].join('\n');
  const sourceText = [userText, contextText].join('\n');
  const lower = sourceText.toLowerCase();
  const userLower = userText.toLowerCase();
  const equipmentLower = /\bequipment\b|\baccess\b|\bmachine\b|\bavailable\b|\bhas\b|\bhave\b/.test(userLower)
    ? userLower
    : lower;
  const allowed = new Set<string>(['bodyweight', 'mat']);
  const add = (...items: string[]) => items.forEach((item) => allowed.add(item));

  if (/\bfree weights?\b/.test(equipmentLower)) add('free weights', 'dumbbell', 'barbell', 'kettlebell');
  if (/\bdumbbells?\b|\bdb\b/.test(equipmentLower)) add('free weights', 'dumbbell');
  if (/\bbarbells?\b|\bbb\b|\bsquat rack\b/.test(equipmentLower)) add('free weights', 'barbell');
  if (/\bkettlebells?\b|\bkb\b/.test(equipmentLower)) add('free weights', 'kettlebell');
  if (equipmentLower.includes('squat rack')) add('squat rack', 'barbell');
  if (equipmentLower.includes('bench')) add('bench');
  if (equipmentLower.includes('leg press')) add('leg press');
  if (equipmentLower.includes('chest press')) add('chest press');
  if (equipmentLower.includes('shoulder press')) add('shoulder press');
  if (equipmentLower.includes('rear delt') || equipmentLower.includes('pec fly')) add('rear delt/pec fly');
  if (equipmentLower.includes('pull down') || equipmentLower.includes('pulldown')) add('pull down');
  if (equipmentLower.includes('row machine') || equipmentLower.includes('seated row')) add('row machine');
  if (equipmentLower.includes('hanging leg raise') || equipmentLower.includes('hanging knee raise')) add('hanging leg raise');
  const cableDenied = /(?:no|without|not|wasnt|wasn't|isn'?t|doesn'?t have|dont have|don't have|unavailable)[^.]{0,50}\bcable\b|\bcable\b[^.]{0,50}(?:wasnt|wasn't|not|unavailable|isn'?t|doesn'?t have|dont have|don't have|no access)/.test(equipmentLower);
  const bandDenied = /(?:no|without|not|wasnt|wasn't|isn'?t|doesn'?t have|dont have|don't have|unavailable)[^.]{0,50}\bband\b|\bband\b[^.]{0,50}(?:wasnt|wasn't|not|unavailable|isn'?t|doesn'?t have|dont have|don't have|no access)/.test(equipmentLower);
  if (!cableDenied && equipmentLower.includes('cable')) add('cable');
  if (!bandDenied && equipmentLower.includes('band')) add('band');
  const hamCurlDenied = /(?:no|without|not|wasnt|wasn't|isn'?t|doesn'?t have|dont have|don't have|unavailable)[^.]{0,50}(?:hamstring curl|leg curl)|(?:hamstring curl|leg curl)[^.]{0,50}(?:wasnt|wasn't|not|unavailable|isn'?t|doesn'?t have|dont have|don't have)/.test(lower);
  if (!hamCurlDenied && (equipmentLower.includes('hamstring curl machine') || equipmentLower.includes('leg curl machine'))) add('hamstring curl');

  const equipmentMentioned = /\bequipment\b|\baccess\b|\bmachine\b|\bavailable\b|\bhas\b|\bhad\b|\bhave\b/.test(equipmentLower);
  const limitedEquipment = /(?:only|limited|restricted|access to|available equipment|no access|doesn'?t have|dont have|don't have)/.test(equipmentLower) && allowed.size > 2 && equipmentMentioned;
  const notes = limitedEquipment
    ? [`Strict equipment list inferred: ${Array.from(allowed).join(', ')}`]
    : ['No strict limited-equipment instruction detected; default gym access applies.'];
  return { limitedEquipment, allowedEquipment: Array.from(allowed), notes };
}

function collectText(value: unknown, maxChars: number): string {
  const seen = new Set<unknown>();
  const walk = (item: unknown): string => {
    if (item === null || item === undefined) return '';
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
    if (typeof item !== 'object') return '';
    if (seen.has(item)) return '';
    seen.add(item);
    if (Array.isArray(item)) return item.map(walk).join(' ');
    return Object.entries(item as Record<string, unknown>).map(([key, val]) => `${key}: ${walk(val)}`).join(' ');
  };
  return walk(value).slice(0, maxChars);
}

function buildWarmupExercises(context: Context, workoutExercises: Exercise[], dayIndex: number, constraints?: GenerationConstraints): Exercise[] {
  const byNorm = new Map<string, LibraryRow>();
  for (const row of context.library) byNorm.set(normalise(row.name), row);
  const selected = selectWarmupNames(workoutExercises, dayIndex);
  return selected.map((item, index) => {
    const name = resolveExerciseName(context, item.names, constraints);
    const row = matchLibrary(name, byNorm, context.library);
    return {
      id: `warmup-${dayIndex + 1}-${index + 1}-${slug(name)}`,
      exercise_id: row?.id ?? null,
      name: row?.name ?? name,
      section: 'Warm Up',
      section_start: index === 0 ? 'Warm Up' : undefined,
      sets: '1',
      reps: item.reps,
      rest: '30 sec',
      notes: item.notes,
      video_url: row?.video_url ?? null,
      cues: row?.cues ?? [],
      superset_id: null,
      pattern: sanitizePattern(inferPattern(row?.name ?? name, row)) ?? 'corrective',
    };
  });
}

function normalizeSectionStarts(exercises: Exercise[]): Exercise[] {
  let lastSection = '';
  return exercises.map((exercise, index) => {
    const section = SECTIONS.includes(exercise.section as typeof SECTIONS[number])
      ? exercise.section!
      : index < 3
        ? 'Warm Up'
        : 'Workout';
    const sectionStart = section !== lastSection ? section : undefined;
    lastSection = section;
    return {
      ...exercise,
      section,
      section_start: sectionStart,
    };
  });
}

function selectWarmupNames(workoutExercises: Exercise[], dayIndex: number) {
  const patterns = new Set(workoutExercises.map((exercise) => sanitizePattern(exercise.pattern) ?? inferPattern(exercise.name ?? '', null)));
  const scored = PREFERRED_WARMUPS.map((item, index) => {
    const patternScore = item.patterns.reduce((score, pattern) => score + (patterns.has(pattern) ? 4 : 0), 0);
    const rotationScore = (index + dayIndex) % PREFERRED_WARMUPS.length;
    return { item, score: patternScore - rotationScore * 0.05 };
  }).sort((a, b) => b.score - a.score);
  const selected: typeof PREFERRED_WARMUPS = [];
  const seen = new Set<string>();
  for (const candidate of scored) {
    const key = normalise(candidate.item.names[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(candidate.item);
    if (selected.length === 3) break;
  }
  return selected.length === 3 ? selected : PREFERRED_WARMUPS.slice(0, 3);
}

function isWarmupOnlyName(name: string): boolean {
  const norm = normalise(name);
  return WARMUP_ONLY_NAMES.some((warmup) => {
    const wn = normalise(warmup);
    return norm === wn || norm.includes(wn) || wn.includes(norm);
  });
}

function isExerciseAllowed(name: string, row: LibraryRow | null, constraints?: GenerationConstraints): boolean {
  if (!constraints?.limitedEquipment) return true;
  const required = requiredEquipmentForExercise(name, row);
  if (required.length === 0) return true;
  return required.every((need) => isEquipmentAvailable(need, constraints.allowedEquipment));
}

function requiredEquipmentForExercise(name: string, row: LibraryRow | null): string[] {
  const lower = normalise(`${name} ${row?.equipment ?? ''}`);
  const required = new Set<string>();
  if (isWarmupOnlyName(name)) return [];
  if (lower.includes('hamstring curl') || lower.includes('leg curl')) required.add('hamstring curl');
  if (lower.includes('cable') || lower.includes('pallof') || lower.includes('face pull')) required.add('cable');
  if (lower.includes('lat pull') || lower.includes('pulldown') || lower.includes('pull down')) required.add('pull down');
  if (lower.includes('row machine') || lower.includes('seated row') || lower.includes('machine row')) required.add('row machine');
  if (lower.includes('leg press')) required.add('leg press');
  if (lower.includes('chest press')) required.add('chest press');
  if (lower.includes('shoulder press') && lower.includes('machine')) required.add('shoulder press');
  if (lower.includes('rear delt') || lower.includes('pec fly')) required.add('rear delt/pec fly');
  if (lower.includes('hanging knee raise') || lower.includes('hanging leg raise')) required.add('hanging leg raise');
  if (lower.includes('dumbbell') || lower.includes('single arm dumbbell')) required.add('dumbbell');
  if (lower.includes('barbell') || lower.includes('back squat') || lower.includes('deadlift') || lower.includes('bench press') || lower.includes('hip thrust')) required.add('barbell');
  if (lower.includes('kettlebell')) required.add('kettlebell');
  if (lower.includes('band')) required.add('band');
  return Array.from(required);
}

function isEquipmentAvailable(need: string, allowedEquipment: string[]): boolean {
  const allowed = new Set(allowedEquipment.map(normalise));
  const has = (term: string) => allowed.has(normalise(term)) || Array.from(allowed).some((item) => item.includes(normalise(term)));
  if (need === 'dumbbell' || need === 'kettlebell') return has(need) || has('free weights');
  if (need === 'barbell') return has('barbell') || has('squat rack') || has('free weights');
  if (need === 'hamstring curl') return has('hamstring curl') || has('leg curl');
  return has(need);
}

function replacementCandidates(ex: Exercise): string[] {
  const pattern = sanitizePattern(ex.pattern) ?? inferPattern(ex.name ?? '', null);
  if (pattern === 'hinge') return ['Single Leg RDL', 'DB Single-Leg RDL', 'Barbell Hip Thrust', 'Back Extension', 'Cable Pull Through'];
  if (pattern === 'squat' || pattern === 'bilateral_lower') return ['Leg Press', 'Back Squat', 'Goblet Squat', 'Bodyweight Squat'];
  if (pattern === 'unilateral_lower') return ['Reverse Lunge', 'Split Squat', 'Cossack Squat', 'Single Leg RDL'];
  if (pattern === 'horizontal_push' || pattern === 'single_arm_push' || pattern === 'two_arm_push') return ['Chest Press', 'DB Bench Press', 'Push Up'];
  if (pattern === 'vertical_push') return ['Shoulder Press', 'DB Shoulder Press', 'Overhead Press'];
  if (pattern === 'horizontal_pull' || pattern === 'single_arm_pull' || pattern === 'two_arm_pull') return ['Row Machine', 'Single Arm DB Row', 'Chest Supported Row'];
  if (pattern === 'vertical_pull') return ['Lat Pulldown', 'Pull-up', 'Pull Up'];
  if (pattern === 'core') return ['Hanging Knee Raise', 'Side Plank', 'Plank'];
  return ['Side Plank', 'Plank', 'Bodyweight Squat'];
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

async function resolveOrCreateExercise(admin: ReturnType<typeof createClient>, name: string): Promise<LibraryRow | null> {
  const existing = await findExerciseByExactName(admin, name);
  if (existing) return existing;

  const insertPayload = {
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
  };
  const { data, error } = await admin
    .from('pt_exercises')
    .insert(insertPayload)
    .select(EXERCISE_SELECT)
    .maybeSingle();

  if (!error && data) return data as LibraryRow;

  const duplicate = error?.message?.includes('duplicate key') || error?.code === '23505';
  const retried = await findExerciseByExactName(admin, name);
  if (retried) return retried;

  console.warn('Could not create/link generated exercise card; continuing with unlinked exercise.', {
    name,
    duplicate,
    error: error?.message,
  });
  return null;
}

async function findExerciseByExactName(admin: ReturnType<typeof createClient>, name: string): Promise<LibraryRow | null> {
  const { data, error } = await admin
    .from('pt_exercises')
    .select(EXERCISE_SELECT)
    .ilike('name', name)
    .limit(10);
  if (error) {
    console.warn('Could not look up exercise by name.', { name, error: error.message });
    return null;
  }
  const rows = (data ?? []) as LibraryRow[];
  return rows.find((row) => row.name.trim().toLowerCase() === name.trim().toLowerCase())
    ?? matchLibrary(name, new Map(rows.map((row) => [normalise(row.name), row])), rows);
}

async function assemblePhase(admin: ReturnType<typeof createClient>, parsed: Phase, context: Context, constraints: GenerationConstraints): Promise<Phase> {
  const byNorm = new Map<string, LibraryRow>();
  for (const row of context.library) byNorm.set(normalise(row.name), row);
  const byLowerName = new Map<string, LibraryRow>();
  for (const row of context.library) byLowerName.set(row.name.trim().toLowerCase(), row);

  const names = [...new Set((parsed.days ?? [])
    .flatMap((d) => d.exercises ?? [])
    .map((e) => String(e.name ?? '').trim())
    .filter(Boolean))];
  const resolved = new Map<string, LibraryRow>();
  const missing: string[] = [];
  const missingLowerNames = new Set<string>();

  for (const name of names) {
    const hit = matchLibrary(name, byNorm, context.library);
    if (hit) resolved.set(name, hit);
    else if (isExerciseAllowed(name, null, constraints)) {
      const lowerName = name.trim().toLowerCase();
      const existing = byLowerName.get(lowerName);
      if (existing) {
        resolved.set(name, existing);
        byNorm.set(normalise(existing.name), existing);
      } else if (!missingLowerNames.has(lowerName)) {
        missingLowerNames.add(lowerName);
        missing.push(name);
      }
    }
  }

  if (missing.length > 0) {
    for (const name of missing) {
      const row = await resolveOrCreateExercise(admin, name);
      if (!row) continue;
      resolved.set(name, row);
      byNorm.set(normalise(row.name), row);
      byLowerName.set(row.name.trim().toLowerCase(), row);
    }
  }

  const old = context.selectedPhase;
  const weekBlocks = sanitiseWeekBlocks(parsed.week_blocks, old);
  const days = (parsed.days ?? []).map((day, dayIndex) => {
    let lastSection = '';
    let currentInputSection = '';
    const supersetMainLiftSeen = new Set<string>();
    const mappedExercises = (day.exercises ?? []).map((ex, exIndex) => {
      const originalName = String(ex.name ?? '').trim();
      let name = originalName;
      let row = resolved.get(name) ?? matchLibrary(name, byNorm, context.library);
      const declaredSection = SECTIONS.includes(ex.section_start as typeof SECTIONS[number])
        ? ex.section_start!
        : SECTIONS.includes(ex.section as typeof SECTIONS[number])
          ? ex.section!
          : '';
      if (declaredSection) currentInputSection = declaredSection;
      const rawSection = currentInputSection || 'Workout';
      const shouldBeWorkout = rawSection === 'Workout' || (!isWarmupOnlyName(name) && rawSection !== 'Warm Up');
      if (shouldBeWorkout && (isWarmupOnlyName(name) || !isExerciseAllowed(name, row, constraints))) {
        name = resolveExerciseName(context, replacementCandidates(ex), constraints);
        row = resolved.get(name) ?? matchLibrary(name, byNorm, context.library);
      }
      const section = SECTIONS.includes(rawSection as typeof SECTIONS[number]) ? rawSection : 'Workout';
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
        section,
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
    const workoutExercises = mappedExercises.filter((exercise) => {
      if (sectionOf(exercise) !== 'Workout') return false;
      if (isWarmupOnlyName(exercise.name ?? '')) return false;
      const row = matchLibrary(exercise.name ?? '', byNorm, context.library);
      return isExerciseAllowed(exercise.name ?? '', row, constraints);
    });
    const exercises = normalizeSectionStarts([
      ...buildWarmupExercises(context, workoutExercises, dayIndex, constraints),
      ...workoutExercises,
    ]);
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
  const direct = [...asStringArray(row?.primary_muscles), ...asStringArray(row?.muscles)].map((m) => normalMuscle(m)).filter(Boolean);
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
  const lower = String(muscle ?? '').toLowerCase();
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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '')).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function inferPattern(name: string, row: LibraryRow | null): string {
  const lower = name.toLowerCase();
  const tags = [
    ...asStringArray(row?.tags),
    ...asStringArray(row?.primary_muscles),
    ...asStringArray(row?.secondary_muscles),
    ...asStringArray(row?.muscles),
  ].join(' ').toLowerCase();
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
