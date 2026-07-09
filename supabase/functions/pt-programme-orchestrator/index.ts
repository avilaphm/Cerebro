import { createClient } from 'npm:@supabase/supabase-js@2';

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

const STEP_NAMES = [
  'CLIENT_ANALYSIS',
  'MOVEMENT_ANALYSIS',
  'EXERCISE_INTELLIGENCE',
  'METHODOLOGY_PLAN',
  'PROGRAMME_CROSS_CHECK',
  'VALIDATION',
] as const;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Constraints = {
  equipment?: 'full_gym' | 'home_minimal' | 'bodyweight' | 'bands' | 'travel';
  location?: string;
  focus_areas?: string[];
  exercises_per_day?: number;
  session_length_min?: number;
  avoid?: string[];
};

type OrchestratorBody = {
  client_id: string;
  phase_weeks: { foundation: number; hypertrophy: number; strength: number };
  days_per_week?: 3 | 4 | 5;
  intake_text?: string;
  // The coach's request, structured. All optional: absent = today's behavior exactly.
  constraints?: Constraints;
  intent?: 'journey' | 'one_off';
};

// The coach's request as one text block: the free-form brief plus any structured constraints.
// Threaded to every agent so the request is honored end to end, not dropped after analysis.
function buildCoachDirective(body: OrchestratorBody): string {
  const parts: string[] = [];
  const t = (body.intake_text ?? '').trim();
  if (t) parts.push(t);
  const c = body.constraints;
  if (c) {
    const cons: string[] = [];
    if (c.equipment) cons.push(`equipment: ${c.equipment.replace(/_/g, ' ')}`);
    if (c.location) cons.push(`location: ${c.location}`);
    if (c.focus_areas?.length) cons.push(`focus areas: ${c.focus_areas.join(', ')}`);
    if (typeof c.exercises_per_day === 'number') cons.push(`exercises per day: ${c.exercises_per_day}`);
    if (typeof c.session_length_min === 'number') cons.push(`session length: ${c.session_length_min} min`);
    if (c.avoid?.length) cons.push(`avoid: ${c.avoid.join(', ')}`);
    if (cons.length) parts.push(`COACH CONSTRAINTS - ${cons.join('; ')}.`);
  }
  return parts.join('\n\n');
}

// Pipeline stages. Supabase edge workers (including EdgeRuntime.waitUntil background
// tasks) are killed at a ~150s wall-clock limit. Running the whole pipeline (4+ sequential
// Claude agent calls + synthesis + validation) in one worker reliably exceeded that and
// zombied the run in 'running'. We split the work into stages that each chain to the next
// via a self-invocation, so every stage starts with a fresh ~150s budget. The sub-agent
// calls, their inputs, and their order are unchanged — only the control flow is split.
const STAGE_ANALYZE = 'analyze_client_movement'; // client analysis -> movement analysis
const STAGE_EXERCISE = 'exercise_methodology';    // exercise intelligence -> methodology plan
const STAGE_SYNTHESIZE = 'synthesize';            // synthesis -> cross-check -> validation -> finalize

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const payload = await req.json() as OrchestratorBody & { run_id?: string; stage?: string };

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // RESUME path: the orchestrator chaining to its own next stage. These calls carry the
    // internal secret so they cannot be triggered by external callers.
    if (payload.run_id && payload.stage) {
      const authHeader = req.headers.get('Authorization') ?? '';
      if (authHeader !== `Bearer ${internalSecret}`) return json({ error: 'Unauthorized' }, 401);
      const ctx: StageCtx = { runId: payload.run_id, body: payload, admin, supabaseUrl, serviceKey, internalSecret };
      EdgeRuntime.waitUntil(runStage(payload.stage, ctx));
      return json({ ok: true, run_id: payload.run_id, status: 'running', stage: payload.stage });
    }

    // INITIAL path: kicked by the wizard. Creates the run and starts the first stage.
    if (!payload.client_id || !payload.phase_weeks) return json({ error: 'client_id and phase_weeks required' }, 400);

    const { data: clientRow } = await admin.from('pt_clients').select('id, goals').eq('id', payload.client_id).maybeSingle();

    const { data: runRow, error: runError } = await admin
      .from('pt_program_generation_runs')
      .insert({
        client_id: payload.client_id,
        task_type: 'full_program',
        client_goal: clientRow?.goals ?? null,
        status: 'running',
        current_command: STEP_NAMES[0],
      })
      .select('id')
      .single();
    if (runError || !runRow) return json({ error: `Failed to create run: ${runError?.message}` }, 500);
    const runId = runRow.id;

    const ctx: StageCtx = { runId, body: payload, admin, supabaseUrl, serviceKey, internalSecret };
    EdgeRuntime.waitUntil(runStage(STAGE_ANALYZE, ctx));

    return json({ ok: true, run_id: runId, status: 'running' });
  } catch (error) {
    console.error('pt-programme-orchestrator error:', error);
    return json({ error: error instanceof Error ? error.message : 'Orchestration failed' }, 500);
  }
});

interface StageCtx {
  runId: string;
  body: OrchestratorBody;
  admin: ReturnType<typeof createClient>;
  supabaseUrl: string;
  serviceKey: string;
  internalSecret: string;
}

async function callAgent(
  ctx: StageCtx,
  path: string,
  input: Record<string, unknown>,
  timeoutMs = 80_000,
): Promise<{ ok: boolean; output: Record<string, unknown>; error?: string }> {
  const controller = new AbortController();
  let timeoutId: number | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(`${path} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    });
    // Read the full response (headers AND body) inside the race. Racing only fetch() (header
    // arrival) lets a stalled body stream hang the orchestrator; reading the body inside the
    // raced task means the timeout always wins after timeoutMs.
    const requestWithBody = (async (): Promise<{ ok: boolean; output: Record<string, unknown>; error?: string }> => {
      const res = await fetch(`${ctx.supabaseUrl}/functions/v1/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.internalSecret}`,
          apikey: ctx.serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const raw = await res.text();
      let data: Record<string, unknown>;
      try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
      catch { return { ok: false, output: {}, error: `${path} returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 200)}` }; }
      if (!res.ok || data.error) return { ok: false, output: data, error: (data.error as string) ?? `HTTP ${res.status}` };
      return { ok: true, output: data };
    })();
    return await Promise.race([requestWithBody, timeout]);
  } catch (e) {
    const errorMessage = e instanceof DOMException && e.name === 'AbortError'
      ? `${path} timed out after ${Math.round(timeoutMs / 1000)}s`
      : e instanceof Error ? e.message : String(e);
    return { ok: false, output: {}, error: errorMessage };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function recordStep(
  ctx: StageCtx, order: number, name: string, input: unknown, output: unknown,
  status: 'succeeded' | 'failed', failureReason?: string,
) {
  await ctx.admin.from('pt_program_generation_steps').insert({
    run_id: ctx.runId,
    step_order: order,
    command_name: name,
    input_json: input as Record<string, unknown>,
    output_json: output as Record<string, unknown>,
    status,
    failure_reason: failureReason ?? null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
}

async function failRun(ctx: StageCtx, reason: string) {
  await ctx.admin.from('pt_program_generation_runs').update({
    status: 'failed',
    failure_reason: reason,
    completed_at: new Date().toISOString(),
  }).eq('id', ctx.runId);
}

async function setCommand(ctx: StageCtx, command: string) {
  await ctx.admin.from('pt_program_generation_runs').update({ current_command: command }).eq('id', ctx.runId);
}

// Stage hand-off state is stashed under coaching_reasoning._scratch between stages. The final
// stage overwrites coaching_reasoning with the clean output, dropping the scratch entirely.
async function loadScratch(ctx: StageCtx): Promise<Record<string, unknown>> {
  const { data } = await ctx.admin.from('pt_program_generation_runs').select('coaching_reasoning').eq('id', ctx.runId).maybeSingle();
  const cr = (data?.coaching_reasoning ?? {}) as Record<string, unknown>;
  return (cr._scratch ?? {}) as Record<string, unknown>;
}

async function saveScratch(ctx: StageCtx, patch: Record<string, unknown>) {
  const { data } = await ctx.admin.from('pt_program_generation_runs').select('coaching_reasoning').eq('id', ctx.runId).maybeSingle();
  const cr = (data?.coaching_reasoning ?? {}) as Record<string, unknown>;
  const scratch = { ...((cr._scratch ?? {}) as Record<string, unknown>), ...patch };
  await ctx.admin.from('pt_program_generation_runs').update({ coaching_reasoning: { ...cr, _scratch: scratch } }).eq('id', ctx.runId);
}

// Fire the next stage as a fresh self-invocation. The target handler kicks its own
// background task and returns immediately, so this await only waits for dispatch.
async function chainToStage(ctx: StageCtx, stage: string) {
  const res = await fetch(`${ctx.supabaseUrl}/functions/v1/pt-programme-orchestrator`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.internalSecret}`,
      apikey: ctx.serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...ctx.body, run_id: ctx.runId, stage }),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(`Failed to start stage ${stage}: HTTP ${res.status} ${raw.slice(0, 200)}`);
  }
}

async function runStage(stage: string, ctx: StageCtx) {
  try {
    if (stage === STAGE_ANALYZE) return await stageAnalyze(ctx);
    if (stage === STAGE_EXERCISE) return await stageExerciseMethodology(ctx);
    if (stage === STAGE_SYNTHESIZE) return await stageSynthesize(ctx);
    await failRun(ctx, `Unknown pipeline stage: ${stage}`);
  } catch (error) {
    console.error(`pt-programme-orchestrator stage ${stage} error:`, error);
    await failRun(ctx, error instanceof Error ? error.message : `Pipeline crashed in stage ${stage}`);
  }
}

// STAGE 1: client analysis -> movement analysis.
async function stageAnalyze(ctx: StageCtx) {
  const { body } = ctx;

  await setCommand(ctx, STEP_NAMES[0]);
  const step1 = await callAgent(ctx, 'client-analysis-agent', { client_id: body.client_id, intake_text: body.intake_text }, 75_000);
  await recordStep(ctx, 1, STEP_NAMES[0], { client_id: body.client_id }, step1.output, step1.ok ? 'succeeded' : 'failed', step1.error);
  if (!step1.ok) { await failRun(ctx, `Client analysis failed: ${step1.error}`); return; }
  const clientAnalysis = step1.output.analysis as Record<string, unknown>;

  await setCommand(ctx, STEP_NAMES[1]);
  const step2 = await callAgent(ctx, 'movement-analysis-agent', {
    client_id: body.client_id,
    client_analysis: clientAnalysis,
    intake_text: body.intake_text,
  }, 80_000);
  await recordStep(ctx, 2, STEP_NAMES[1], { client_id: body.client_id }, step2.output, step2.ok ? 'succeeded' : 'failed', step2.error);
  if (!step2.ok) { await failRun(ctx, `Movement analysis failed: ${step2.error}`); return; }
  const muscleMindMap = step2.output.muscle_mind_map as Record<string, unknown>;
  const primaryIssues = Array.isArray(muscleMindMap.primary_issues) ? muscleMindMap.primary_issues : [];
  if (primaryIssues.length === 0) {
    await failRun(ctx, 'Movement analysis returned no primary issues or muscle mind map.');
    return;
  }
  await persistMovementMindMap(ctx.admin, body.client_id, muscleMindMap);

  // physio_brief (from the movement agent) and coach_directive (the coach's request) are
  // derived here and stashed so every downstream stage can honor them.
  const physioBrief = typeof step2.output.physio_brief === 'string' ? step2.output.physio_brief : '';
  const coachDirective = buildCoachDirective(body);

  await saveScratch(ctx, { clientAnalysis, muscleMindMap, coachDirective, physioBrief, constraints: body.constraints ?? null });
  await chainToStage(ctx, STAGE_EXERCISE);
}

// STAGE 2: exercise intelligence -> methodology plan.
async function stageExerciseMethodology(ctx: StageCtx) {
  const { body } = ctx;
  const scratch = await loadScratch(ctx);
  const clientAnalysis = scratch.clientAnalysis as Record<string, unknown>;
  const muscleMindMap = scratch.muscleMindMap as Record<string, unknown>;
  const coachDirective = (scratch.coachDirective as string) ?? '';
  const physioBrief = (scratch.physioBrief as string) ?? '';
  const constraints = (scratch.constraints ?? null) as Constraints | null;
  if (!clientAnalysis || !muscleMindMap) { await failRun(ctx, 'Pipeline state missing after analysis stage.'); return; }

  await setCommand(ctx, STEP_NAMES[2]);
  const step3 = await callAgent(ctx, 'exercise-intelligence-agent', {
    client_id: body.client_id,
    muscle_mind_map: muscleMindMap,
    coach_directive: coachDirective,
    client_analysis: clientAnalysis,
    physio_brief: physioBrief,
    constraints,
  }, 80_000);
  await recordStep(ctx, 3, STEP_NAMES[2], { client_id: body.client_id, muscle_mind_map: muscleMindMap }, step3.output, step3.ok ? 'succeeded' : 'failed', step3.error);
  if (!step3.ok) { await failRun(ctx, `Exercise intelligence failed: ${step3.error}`); return; }
  let exerciseMasterList = Array.isArray(step3.output.exercise_master_list)
    ? step3.output.exercise_master_list as Array<Record<string, unknown>>
    : [];
  if (exerciseMasterList.length === 0) {
    await failRun(ctx, 'Exercise intelligence returned an empty exercise master list.');
    return;
  }
  exerciseMasterList = await ensureExerciseCardsForMasterList(ctx.admin, exerciseMasterList);
  const staplesByPhase = step3.output.staples_by_phase as Record<string, unknown> | undefined;
  await persistExerciseIntelligence(ctx.admin, body.client_id, { ...step3.output, exercise_master_list: exerciseMasterList });
  await persistProgrammeStaples(ctx.admin, body.client_id, ctx.runId, staplesByPhase);

  await setCommand(ctx, STEP_NAMES[3]);
  const step4 = await callAgent(ctx, 'methodology-plan-agent', {
    client_analysis: clientAnalysis,
    phase_weeks: body.phase_weeks,
    days_per_week: body.days_per_week ?? 3,
    coach_directive: coachDirective,
    constraints,
    run_id: ctx.runId,
  }, 80_000);
  await recordStep(ctx, 4, STEP_NAMES[3], { phase_weeks: body.phase_weeks }, step4.output, step4.ok ? 'succeeded' : 'failed', step4.error);
  if (!step4.ok) { await failRun(ctx, `Methodology planning failed: ${step4.error}`); return; }
  const methodologyPlan = step4.output.methodology_plan as Record<string, unknown>;

  await saveScratch(ctx, {
    exerciseMasterList,
    methodologyPlan,
    staplesByPhase: staplesByPhase ?? null,
    exerciseIntelligenceMissing: Array.isArray(step3.output.missing_exercises) ? step3.output.missing_exercises : [],
  });
  await chainToStage(ctx, STAGE_SYNTHESIZE);
}

// STAGE 3: programme synthesis (one phase at a time) -> cross-check -> validation -> finalize.
async function stageSynthesize(ctx: StageCtx) {
  const { body } = ctx;
  const scratch = await loadScratch(ctx);
  const clientAnalysis = scratch.clientAnalysis as Record<string, unknown>;
  const muscleMindMap = scratch.muscleMindMap as Record<string, unknown>;
  const exerciseMasterList = (scratch.exerciseMasterList ?? []) as Array<Record<string, unknown>>;
  const methodologyPlan = scratch.methodologyPlan as Record<string, unknown>;
  const staplesByPhase = (scratch.staplesByPhase ?? null) as Record<string, unknown> | null;
  const exerciseIntelligenceMissing = Array.isArray(scratch.exerciseIntelligenceMissing) ? scratch.exerciseIntelligenceMissing as string[] : [];
  const coachDirective = (scratch.coachDirective as string) ?? '';
  const physioBrief = (scratch.physioBrief as string) ?? '';
  const constraints = (scratch.constraints ?? null) as Constraints | null;
  if (!clientAnalysis || !methodologyPlan) { await failRun(ctx, 'Pipeline state missing after exercise/methodology stage.'); return; }

  const methodologyPhases = (methodologyPlan.phases ?? []) as Array<Record<string, unknown>>;
  if (methodologyPhases.length === 0) {
    await failRun(ctx, 'Methodology plan returned no phases.');
    return;
  }

  // 1RM test/retest phases are always identical (Big 5, 5x1). Build them inline so the
  // synthesis agent spends zero tokens on them.
  const BIG5_IDS = [
    '3b551e61-9b4c-412d-82f5-a5a34c44c770', // Back Squat
    '743c5231-e1e4-4d45-aee6-b7d0d3c17723', // Conventional Deadlift
    '7baa12b2-9949-4e0c-8f72-1f7a801050fa', // Barbell Bench Press
    'a85f183d-2b6b-47a1-b5ff-5881bb15cb3f', // Overhead Press
    '4e4392c7-b6f0-4bd2-94fa-fae97e360e22', // Pull Up
  ];
  const BIG5_LABELS = ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up'];
  const { data: big5Rows } = await ctx.admin.from('pt_exercises').select('id, video_url, cues').in('id', BIG5_IDS);
  const big5Map = new Map((big5Rows ?? []).map((e: { id: string; video_url: string | null; cues: unknown }) => [e.id, e]));

  const phases: Record<string, unknown>[] = [];
  let programmeName = '';
  let programmeGoal = '';
  const allMissing: string[] = [];

  for (let i = 0; i < methodologyPhases.length; i++) {
    const commandName = synthesisCommandName(methodologyPhases[i], i);
    await setCommand(ctx, commandName);

    const phaseType = String(methodologyPhases[i].type ?? '').toLowerCase();
    const is1rm = phaseType === '1rm_test' || phaseType === '1rm_retest' ||
      (phaseType.includes('1rm') && (phaseType.includes('test') || phaseType.includes('retest')));

    if (is1rm) {
      const isRetest = phaseType.includes('retest');
      const phaseId = isRetest ? 'phase-1rm-retest' : 'phase-1rm-test';
      const phaseTitle = isRetest ? '1RM Retest' : '1RM Test';
      const phase = {
        id: phaseId,
        title: phaseTitle,
        focus: 'Measure baseline strength across the Big 5 lifts.',
        weeks: String(methodologyPhases[i].weeks ?? '1'),
        progression: 'One testing week. Load to a true 1RM on each lift.',
        week_blocks: [],
        days: [{
          id: 'day-1',
          title: `Day 1 - ${phaseTitle}`,
          focus: 'Big 5 strength testing',
          exercises: BIG5_IDS.map((id, idx) => ({
            id: `ex-${BIG5_LABELS[idx].toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx + 1}`,
            exercise_id: id,
            name: BIG5_LABELS[idx],
            sets: '5',
            reps: '1',
            rest: '3-5 min',
            notes: 'Ramp up: empty bar, 50%, 65%, 75%, 85%, then 100% 1RM attempt.',
            section_start: idx === 0 ? 'Workout' : null,
            superset_id: null,
            video_url: (big5Map.get(id) as { video_url?: string | null } | undefined)?.video_url ?? null,
            cues: (big5Map.get(id) as { cues?: unknown } | undefined)?.cues ?? [],
          })),
        }],
      };
      const stepOrder = 5 + i;
      await recordStep(ctx, stepOrder, commandName, { phase_index: i }, { ok: true, phase }, 'succeeded');
      phases.push(phase);
      if (i === 0) {
        programmeName = phaseTitle;
        programmeGoal = 'Establish 1RM baseline for percentage-based programming.';
      }
      continue;
    }

    const step = await callAgent(ctx, 'programme-synthesis-agent', {
      client_analysis: clientAnalysis,
      muscle_mind_map: muscleMindMap,
      methodology_plan_phase: methodologyPhases[i],
      phase_index: i,
      programme_name: programmeName,
      programme_goal: programmeGoal,
      exercise_master_list: exerciseMasterList,
      coach_directive: coachDirective,
      physio_brief: physioBrief,
      constraints,
      intent: body.intent,
    });

    const stepOrder = 5 + i;
    await recordStep(
      ctx,
      stepOrder,
      commandName,
      { phase_index: i, methodology_plan_phase: methodologyPhases[i] },
      step.output,
      step.ok ? 'succeeded' : 'failed',
      step.error,
    );
    if (!step.ok) {
      await failRun(ctx, `Programme synthesis failed at phase ${i + 1}: ${step.error}`);
      return;
    }

    phases.push(step.output.phase as Record<string, unknown>);
    if (i === 0) {
      programmeName = (step.output.name as string | undefined) ?? '';
      programmeGoal = (step.output.goal as string | undefined) ?? '';
    }
    allMissing.push(...((step.output.missing_exercises as string[] | undefined) ?? []));
  }

  const programme = { phases };
  const missingExercises = Array.from(new Set([...allMissing, ...exerciseIntelligenceMissing]));

  // Programme B/modifier pass: re-check the programme against the client brain-derived
  // movement map and exercise intelligence before validation.
  await setCommand(ctx, STEP_NAMES[4]);
  const crossCheck = buildProgrammeCrossCheck(programme, clientAnalysis, muscleMindMap, exerciseMasterList);
  await recordStep(ctx, 5 + methodologyPhases.length, STEP_NAMES[4], {
    client_id: body.client_id,
    programme_a_phase_count: phases.length,
  }, crossCheck, 'succeeded');

  // Final validation step.
  await setCommand(ctx, STEP_NAMES[5]);
  const emphasis = (clientAnalysis.emphasis ?? {}) as { needs_cardio_block?: boolean; needs_mobility_block?: boolean };
  const validationStep = await callAgent(ctx, 'programme-validation-agent', { programme, emphasis, constraints, coach_directive: coachDirective, intent: body.intent });
  await recordStep(ctx, 6 + methodologyPhases.length, STEP_NAMES[5], {}, validationStep.output, validationStep.ok ? 'succeeded' : 'failed', validationStep.error);
  if (!validationStep.ok) { await failRun(ctx, `Validation failed: ${validationStep.error}`); return; }
  const validation = validationStep.output as { passed: boolean; hard_failures: string[]; findings: string[] };

  await ctx.admin.from('pt_program_generation_runs').update({
    status: 'needs_review',
    current_command: null,
    programme_draft: programme,
    coaching_reasoning: {
      client_analysis: clientAnalysis,
      methodology_plan: methodologyPlan,
      muscle_mind_map: muscleMindMap,
      exercise_master_list: exerciseMasterList,
      staples_by_phase: staplesByPhase ?? null,
      programme_cross_check: crossCheck,
    },
    validation_summary: {
      name: programmeName,
      goal: programmeGoal,
      passed: validation.passed,
      hard_failures: validation.hard_failures,
      findings: [...validation.findings, ...crossCheck.findings],
      missing_exercises: missingExercises,
      modifications_applied: crossCheck.modifications_applied,
    },
    completed_at: new Date().toISOString(),
  }).eq('id', ctx.runId);

  if (validation.hard_failures.length || validation.findings.length) {
    await ctx.admin.from('pt_program_review_outputs').insert({
      run_id: ctx.runId,
      client_id: body.client_id,
      review_type: 'system',
      status: validation.passed ? 'needs_review' : 'failed',
      hard_rule_failures: validation.hard_failures,
      findings: validation.findings,
    });
  }
}

function synthesisCommandName(phase: Record<string, unknown>, index: number): string {
  const raw = String(phase.type ?? phase.title ?? `phase_${index + 1}`);
  const slug = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `PROGRAMME_SYNTHESIS_${slug || `PHASE_${index + 1}`}`;
}

async function persistExerciseIntelligence(
  admin: ReturnType<typeof createClient>,
  clientId: string,
  exerciseIntelligence: Record<string, unknown>,
) {
  const { data } = await admin
    .from('pt_client_exercise_doc')
    .select('progression_strategy')
    .eq('client_id', clientId)
    .maybeSingle();
  const current = typeof data?.progression_strategy === 'object' && data.progression_strategy !== null && !Array.isArray(data.progression_strategy)
    ? data.progression_strategy as Record<string, unknown>
    : {};
  await admin.from('pt_client_exercise_doc').upsert({
    client_id: clientId,
    progression_strategy: {
      ...current,
      exercise_intelligence: exerciseIntelligence,
      updated_by: 'pt-programme-orchestrator',
      updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' });
}

async function persistMovementMindMap(
  admin: ReturnType<typeof createClient>,
  clientId: string,
  muscleMindMap: Record<string, unknown>,
) {
  const { error } = await admin.from('pt_client_exercise_doc').upsert({
    client_id: clientId,
    movement_assessment_summary: muscleMindMap,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' });
  if (error) throw new Error(`Failed to persist movement mind map: ${error.message}`);
}

async function ensureExerciseCardsForMasterList(
  admin: ReturnType<typeof createClient>,
  masterList: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const rows = masterList.filter((exercise) => typeof exercise.exercise_id !== 'string' && text(exercise.name, ''));
  if (rows.length === 0) return masterList;

  const names = Array.from(new Set(rows.map((exercise) => text(exercise.name, '')).filter(Boolean)));
  const { data: existing } = await admin
    .from('pt_exercises')
    .select('id, name')
    .in('name', names);
  const byName = new Map((existing ?? []).map((row: { id: string; name: string }) => [row.name.toLowerCase(), row.id]));

  const inserts = rows
    .filter((exercise) => !byName.has(text(exercise.name, '').toLowerCase()))
    .map((exercise) => {
      const primary = asTextArray(exercise.primary_muscles);
      const secondary = asTextArray(exercise.secondary_muscles);
      const problems = asTextArray(exercise.problems_solved);
      const treatments = asTextArray(exercise.treatment_types);
      return {
        name: text(exercise.name, ''),
        muscles: Array.from(new Set([...primary, ...secondary])),
        primary_muscles: primary,
        secondary_muscles: secondary,
        purpose: problems.join('; ') || null,
        equipment: null,
        video_url: null,
        cues: [],
        setup_cues: [],
        tags: Array.from(new Set([
          'ai-generated',
          'needs-video',
          ...treatments,
          ...(exercise.double_duty === true ? ['double-duty'] : []),
        ])),
        conditions: problems,
        source: 'ai',
      };
    });

  if (inserts.length > 0) {
    const { data: created, error } = await admin
      .from('pt_exercises')
      .upsert(inserts, { onConflict: 'name' })
      .select('id, name');
    if (!error) {
      (created ?? []).forEach((row: { id: string; name: string }) => byName.set(row.name.toLowerCase(), row.id));
    }
  }

  return masterList.map((exercise) => {
    if (typeof exercise.exercise_id === 'string') return exercise;
    const id = byName.get(text(exercise.name, '').toLowerCase()) ?? null;
    return { ...exercise, exercise_id: id };
  });
}

async function persistProgrammeStaples(
  admin: ReturnType<typeof createClient>,
  clientId: string,
  runId: string,
  staplesByPhase: Record<string, unknown> | undefined,
) {
  if (!staplesByPhase) return;
  const rows: Array<{
    client_id: string;
    generation_run_id: string;
    phase_type: string;
    exercise_name: string;
    reason: string | null;
    muscles: string[];
    source: 'standard' | 'exercise_intelligence';
  }> = [];

  const addNames = (phaseType: string, value: unknown, source: 'standard' | 'exercise_intelligence' = 'exercise_intelligence') => {
    asTextArray(value).forEach((exerciseName) => rows.push({
      client_id: clientId,
      generation_run_id: runId,
      phase_type: phaseType,
      exercise_name: exerciseName,
      reason: null,
      muscles: [],
      source,
    }));
  };

  const foundation = isRecord(staplesByPhase.foundation) ? staplesByPhase.foundation : {};
  addNames('foundation_weeks_1_4', foundation.weeks_1_4, 'standard');
  addNames('foundation_weeks_5_7', foundation.weeks_5_7, 'standard');
  addNames('hypertrophy', staplesByPhase.hypertrophy, 'standard');
  addNames('strength', staplesByPhase.strength, 'standard');

  const additions = Array.isArray(staplesByPhase.client_specific_additions) ? staplesByPhase.client_specific_additions : [];
  additions.forEach((item) => {
    if (!isRecord(item)) return;
    const exerciseName = text(item.exercise, '');
    if (!exerciseName) return;
    const phases = asTextArray(item.phases);
    const targetPhases = phases.length > 0 ? phases : ['client_specific'];
    targetPhases.forEach((phaseType) => rows.push({
      client_id: clientId,
      generation_run_id: runId,
      phase_type: phaseType,
      exercise_name: exerciseName,
      reason: text(item.reason, '') || null,
      muscles: [],
      source: 'exercise_intelligence',
    }));
  });

  const deduped = Array.from(rows.reduce((map, row) => {
    const key = `${row.client_id}::${row.phase_type}::${row.exercise_name.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      return map;
    }
    map.set(key, {
      ...existing,
      reason: existing.reason ?? row.reason,
      muscles: Array.from(new Set([...existing.muscles, ...row.muscles])),
      source: existing.source === 'exercise_intelligence' || row.source === 'exercise_intelligence'
        ? 'exercise_intelligence'
        : 'standard',
    });
    return map;
  }, new Map<string, typeof rows[number]>()).values());

  if (deduped.length === 0) return;
  const { error } = await admin
    .from('pt_programme_staples')
    .upsert(deduped.map((row) => ({ ...row, updated_at: new Date().toISOString() })), {
      onConflict: 'client_id,phase_type,exercise_name',
    });
  if (error) throw new Error(`Failed to persist programme staples: ${error.message}`);
}

function buildProgrammeCrossCheck(
  programme: { phases: Record<string, unknown>[] },
  clientAnalysis: Record<string, unknown>,
  muscleMindMap: Record<string, unknown>,
  exerciseMasterList: Array<Record<string, unknown>>,
): { programme_b_modifiers: string[]; modifications_applied: string[]; findings: string[] } {
  const programmeText = JSON.stringify(programme).toLowerCase();
  const modifiers: string[] = [];
  const findings: string[] = [];
  const applied: string[] = [];

  const primaryIssues = Array.isArray(muscleMindMap.primary_issues) ? muscleMindMap.primary_issues : [];
  for (const issue of primaryIssues) {
    if (!isRecord(issue)) continue;
    const issueName = text(issue.issue, 'movement issue');
    const muscles = Array.isArray(issue.muscles) ? issue.muscles : [];
    for (const muscle of muscles) {
      if (!isRecord(muscle)) continue;
      const muscleName = text(muscle.name, '');
      if (!muscleName) continue;
      const treatment = text(muscle.treatment, '');
      const priority = text(muscle.priority, 'medium');
      const matchingExercises = exerciseMasterList
        .filter((exercise) => JSON.stringify(exercise).toLowerCase().includes(muscleName.toLowerCase()))
        .map((exercise) => text(exercise.name, ''))
        .filter(Boolean);
      const hasProgrammeCoverage = matchingExercises.some((name) => programmeText.includes(name.toLowerCase()));
      const modifier = `${priority} priority ${muscleName}: ${issueName}${treatment ? ` - ${treatment}` : ''}`;
      modifiers.push(modifier);
      if (hasProgrammeCoverage) {
        applied.push(`Programme includes exercise coverage for ${muscleName}.`);
      } else {
        findings.push(`Cross-check: ${muscleName} appears in the mind map but no direct exercise-intelligence match was found in the draft.`);
      }
    }
  }

  const flags = isRecord(muscleMindMap.programme_flags) ? muscleMindMap.programme_flags : {};
  if (flags.avoid_overhead_pressing_initially === true && /bb shoulder press|overhead press|shoulder press/.test(programmeText)) {
    findings.push('Cross-check: mind map flags cautious overhead loading; review shoulder press exposure before publishing.');
  }
  if (flags.prioritise_posterior_chain === true && !/hip thrust|glute bridge|rdl|deadlift|hamstring curl|back extension/.test(programmeText)) {
    findings.push('Cross-check: posterior-chain priority is flagged but draft has weak posterior-chain coverage.');
  }
  const emphasis = isRecord(clientAnalysis.emphasis) ? clientAnalysis.emphasis : {};
  if (emphasis.needs_mobility_block === true && !/mobility|stretch|car|adductor|thoracic|hip/.test(programmeText)) {
    findings.push('Cross-check: client needs mobility work but draft has limited visible mobility coverage.');
  }

  return {
    programme_b_modifiers: Array.from(new Set(modifiers)),
    modifications_applied: Array.from(new Set(applied)),
    findings: Array.from(new Set(findings)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
