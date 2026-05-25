import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];
const MAX_DOCUMENT_CHARS = 45000;
const DEFAULT_PRINCIPLES = `# Cerebro PT Programming Rules

## Programme Arc (New Clients)
Every new programme MUST use this exact phase order: Foundations (7w), 1RM Testing (1w), Hypertrophy (12w), Strength (12w), Retesting (1w), Taper.

## Phase 1 Foundations
ALWAYS exactly 3 workout days. Full body every session.
week_blocks MANDATORY: [{"weeks":2,"sets":"2"},{"weeks":5,"sets":"3"}]
Weeks 1-2: 2 sets. Slow tempo. Movement quality. Weeks 3-7: 3 sets. Weeks 3-4: Controlled tempo. Weeks 5-7: Introduce Big 5 compounds (BB Squat, BB Deadlift, BB Bench Press, BB Shoulder Press, Pull-up) so client is familiar before 1RM testing.

Equipment access: infer from client documents and Pedro instructions. If not stated, assume gym. For gym Foundation, do not use banded exercises; use DB/KB/cable/machine/bodyweight options. Never use banded deadlifts for gym Foundation.
Foundation day balance: pain and movement restrictions outrank performance goals. Day 1 and Day 3 bias single-arm and single-leg work. Day 2 biases bilateral/two-arm/two-leg work. Every Foundation Workout day needs 1 pull, 1 push, 1 anterior lower, 1 posterior lower, and hip/core corrective coverage. Do not repeat multiple variations of the same exercise family in one day. Generated Foundation days only contain Warm Up and Workout. Every Foundation exercise note must include tempo or controlled execution intent.
Preferred Foundation staples: Hip flexor cable pull, standing hip flexor KB pull, half kneeling adductor slides sideways/front, single-leg glute bridge/hip thrust, single-arm cable pull, DB push, single-leg step-up, cable crunch, back extension, QL extension, leg press, knee extension, hamstring curl, single-leg DB RDL, seated shoulder press, Hip CARs.

## Warm-Up (every day)
Exactly 4 warm-up exercises. 1 set each. 10-12 reps. Use section_start "Warm Up" on first warm-up only.

## Workout Structure
6 main exercises standard in 3 supersets. Max 9 exercises. 45 min session. Use section_start "Workout" on first main exercise.

## Compound Tempos
BB Squat: 3s down, 2-3s pause. Deadlift: 2-3s controlled descent. Shoulder Press: 3s eccentric, pause overhead. Pull-up: 3s eccentric. Bench Press: 3s eccentric, 2s pause at chest.

## Hypertrophy Phase (MANDATORY week_blocks - both sets AND weight_pct required in every block)
65-75% 1RM. 8-15 reps. 3-5 sets.
week_blocks MANDATORY: [{"weeks":3,"sets":"3","weight_pct":"65%"},{"weeks":3,"sets":"4","weight_pct":"68%"},{"weeks":3,"sets":"4","weight_pct":"72%"},{"weeks":3,"sets":"5","weight_pct":"75%"}]
Include supersets, progression, nutrition sync (higher carbs, protein support).

## Strength Phase (MANDATORY week_blocks - both sets AND weight_pct required in every block)
75-90% 1RM. 3-8 reps. 4-6 sets.
week_blocks MANDATORY: [{"weeks":3,"sets":"4","weight_pct":"77%"},{"weeks":3,"sets":"4","weight_pct":"80%"},{"weeks":3,"sets":"5","weight_pct":"85%"},{"weeks":3,"sets":"6","weight_pct":"88%"}]
Include heavier loading progression, nutrition sync (nervous system, sleep, hydration).

## Nutrition Sync
Phase 1: habits, hydration, protein consistency. Hypertrophy: higher carbs, protein support, slight surplus (Nutrition Pyramid reference). Strength: nervous system recovery, sleep, hydration. Taper: maintain protein, recovery focus. Use LEAST restrictive strategy.

## Knowledge Base (ALL documents must be referenced)
Reference every indexed document: Cerebro architecture, Training Pyramid, Nutrition Pyramid, ACSM physiology, sports nutrition, exercise prescription, chronic disease, shoulder/rotator cuff, musculoskeletal fitness, Precision Nutrition, preventive therapy, Pedro coaching voice notes.

## Core Rules
Movement quality before load. Full ROM. Longevity over ego. Unilateral weekly. Prefer library exercise_id, cues, video_url. Every exercise needs 3-5 cues and a tempo/intent note. Output is always a draft for Pedro.`;

type AgentMode = 'new_programme' | 'revise_programme';

interface AgentRequest {
  client_id?: string;
  assignment_id?: string;
  mode?: AgentMode;
  instructions?: string;
}

interface GenerationStep {
  id: string;
  command_name: string;
  step_order: number;
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

const COMMANDS = [
  'LOAD_CLIENT_CARD',
  'PARSE_CLIENT_DOCUMENTS',
  'UPDATE_CLIENT_BRAIN',
  'RETRIEVE_KNOWLEDGE_CONTEXT',
  'CREATE_PHASE_ROADMAP',
  'GENERATE_FOUNDATIONS_PHASE',
  'GENERATE_WORKOUT_WARMUPS',
  'GENERATE_1RM_TEST_SESSION',
  'GENERATE_HYPERTROPHY_PHASE',
  'GENERATE_STRENGTH_PHASE',
  'GENERATE_RETEST_SESSION',
  'GENERATE_TAPER_PHASE',
  'GENERATE_PHASE_NUTRITION',
  'PROGRAM_REVIEW_AGENT',
  'NUTRITION_REVIEW_AGENT',
  'SYSTEM_VALIDATION_AGENT',
  'VALIDATE_FULL_PROGRAM',
  'OPEN_COACH_REVIEW',
] as const;

const SYSTEM_PROMPT = `You are Pedro Avila's PT Programming Agent.

You create draft training programmes for Pedro to review. The system records every command step for audit, but Pedro is the final decision maker.

Return only valid JSON. No markdown. No commentary.

Schema:
{
  "name": "Programme name",
  "goal": "Main goal",
  "change_summary": "Short summary of the draft and why it fits the client",
  "coaching_reasoning": {
    "summary": "Why this client needs this programme",
    "movement_priorities": ["Priority 1"],
    "injury_precautions": ["Precaution 1"],
    "progression_strategy": "How load/volume/complexity should progress"
  },
  "phase_roadmap": [
    { "phase_title": "Phase title", "phase_type": "foundations", "purpose": "Why this phase exists" }
  ],
  "phase_nutrition": [
    {
      "phase_index": 0,
      "phase_title": "Foundations",
      "phase_type": "foundations",
      "training_context": { "volume": "moderate" },
      "recommendations": { "priority": "Protein and routine consistency" }
    }
  ],
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
- For a new programme, create the complete Cerebro programme arc: Foundations, 1RM Testing, Hypertrophy, Strength, Retest, Taper unless Pedro's instruction clearly requires a different structure.
- "Concise" means concise notes and cues, not fewer phases. Do not collapse a new programme into a single phase.
- For a revision, preserve useful parts of the current programme and change only what client feedback, logs, or Pedro's instruction justify.
- Explain the coaching reasoning, movement priorities, injury precautions, and progression strategy.
- Sync nutrition to each phase. Do not produce generic nutrition advice disconnected from training demand.

WEEK_BLOCKS ARE MANDATORY FOR ALL THREE MAIN PHASES:
- Phase 1 Foundations: week_blocks MUST use "sets" progression: [{"weeks":2,"sets":"2"},{"weeks":2,"sets":"3"},{"weeks":2,"sets":"3"}]
- Phase 2 Hypertrophy: week_blocks MUST include BOTH "sets" AND "weight_pct" in every block: [{"weeks":3,"sets":"3","weight_pct":"65%"},{"weeks":3,"sets":"4","weight_pct":"68%"},{"weeks":3,"sets":"4","weight_pct":"72%"},{"weeks":3,"sets":"5","weight_pct":"75%"}]
- Phase 3 Strength: week_blocks MUST include BOTH "sets" AND "weight_pct" in every block: [{"weeks":2,"sets":"4","weight_pct":"77%"},{"weeks":3,"sets":"4","weight_pct":"80%"},{"weeks":3,"sets":"5","weight_pct":"85%"},{"weeks":2,"sets":"6","weight_pct":"88%"}]
- Adjust block week counts proportionally if Pedro sets a different phase duration. Never omit week_blocks. Never omit weight_pct from Hypertrophy or Strength blocks.

KNOWLEDGE BASE — MANDATORY:
The context includes knowledge_base_catalog listing ALL indexed documents. You MUST reference ALL of them. In coaching_reasoning, explicitly cite which documents informed your exercise selection, loading parameters, nutrition strategy, and phase progression. Do not write generic programming that ignores the knowledge base. Key mandatory cross-references:
- Nutrition: cite Nutrition Pyramid AND Precision Nutrition sources
- Exercise/loading: cite Training Pyramid AND ACSM physiology
- Any shoulder/upper body issues: cite shoulder instability AND rotator cuff documents
- Preventive notes: cite Prescribing exercise as preventive therapy

- Use exercise week_overrides only when a specific exercise needs to differ from the phase block.
- Prefer supplied exercise library IDs. Copy library cues and video URLs when available.
- Respect injuries, pain, dislikes, schedule, equipment, and recent performance.
- Include warm up, main work, conditioning, stretches, or cool down sections where useful.
- Apply the equipment and Foundation rules before output: default to gym when equipment is not stated; no banded exercises in gym Foundation; Foundation has two unilateral-emphasis days and one bilateral-emphasis day; every Foundation exercise note includes tempo/control.
- Run a client-specific audit before output. Compare the draft to the client's goals, injuries, dislikes, training history, equipment, notes, messages, logs, and Pedro's instruction. Adapt exercises until they fit this client while preserving phase order and week_blocks.
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

    const adminClient = createClient(url, serviceKey);
    const tokenPayload = jwtPayload(authHeader.replace('Bearer ', ''));
    let createdBy: string | null = null;

    if (tokenPayload.role !== 'service_role') {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

      createdBy = authData.user.id;
      const requesterEmail = authData.user.email?.toLowerCase() ?? '';
      const { data: requesterProfile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (requesterProfile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
        return json({ error: 'Only Pedro can use the programming agent.' }, 403);
      }
    }

    const body = (await req.json()) as AgentRequest;
    const clientId = body.client_id;
    const mode = body.mode;
    const instructions = body.instructions?.trim() ?? '';

    if (!clientId) return json({ error: 'Missing client_id.' }, 400);
    if (mode !== 'new_programme' && mode !== 'revise_programme') {
      return json({ error: 'Invalid mode.' }, 400);
    }

    const run = await createGenerationRun(adminClient, clientId, body.assignment_id, mode, instructions, createdBy);
    const steps = await createGenerationSteps(adminClient, run.id);

    const contextStep = stepByCommand(steps, 'LOAD_CLIENT_CARD');
    await markStep(adminClient, contextStep, 'running', { client_id: clientId, assignment_id: body.assignment_id ?? null, mode });
    const context = await buildContext(adminClient, clientId, body.assignment_id, mode, instructions);
    if ('error' in context) {
      await failRun(adminClient, run.id, contextStep, context.error);
      return json({ error: context.error, run_id: run.id }, context.status);
    }
    await markStep(adminClient, contextStep, 'succeeded', undefined, context);

    const principles = await loadPrinciples();
    const documentStep = stepByCommand(steps, 'PARSE_CLIENT_DOCUMENTS');
    await markStep(adminClient, documentStep, 'running', { document_url: context.client.document_url ?? null });
    const document = await loadClientDocument(adminClient, context.client.document_url, openaiKey);
    await markStep(adminClient, documentStep, 'succeeded', undefined, {
      document_loaded: Boolean(document.text || document.fileId),
      document_type: document.fileId ? 'pdf_file' : document.text ? 'text' : 'none',
    });

    const brainStep = stepByCommand(steps, 'UPDATE_CLIENT_BRAIN');
    await markStep(adminClient, brainStep, 'running', { stage: 'pre_generation_context' });
    await invokeUpdateClientBrain(url, serviceKey, clientId, {
      trigger_type: 'coach_decision',
      content: `Started deterministic programming generation. Mode: ${mode}. Instruction: ${instructions || 'none'}`,
      structured_data: {
        important_decision: {
          decision: mode === 'new_programme' ? 'Started new programme generation' : 'Started programme revision',
          instruction: instructions || null,
          generation_run_id: run.id,
        },
      },
    });
    await markStep(adminClient, brainStep, 'succeeded', undefined, { brain_update_requested: true });

    const retrievalStep = stepByCommand(steps, 'RETRIEVE_KNOWLEDGE_CONTEXT');
    await markStep(adminClient, retrievalStep, 'running', {
      taskType: mode === 'new_programme' ? 'full_program' : 'program_revision',
    });
    const retrieval = await retrieveKnowledgeContext(url, serviceKey, {
      runId: run.id,
      stepId: retrievalStep.id,
      taskType: mode === 'new_programme' ? 'full_program' : 'program_revision',
      phaseType: 'full_program',
      clientGoal: text(context.client.goals, ''),
      questionOrDecision: buildRetrievalQuestion(context, mode, instructions),
    });
    await markStep(adminClient, retrievalStep, retrieval.ok ? 'succeeded' : 'failed', undefined, retrieval);
    if (!retrieval.ok) {
      await failRun(adminClient, run.id, retrievalStep, retrieval.error ?? 'Knowledge retrieval failed.');
      return json({ error: retrieval.error ?? 'Knowledge retrieval failed.', run_id: run.id }, 500);
    }

    const generationContext = {
      ...compactGenerationContext(context),
      deterministic_generation: {
        run_id: run.id,
        commands: COMMANDS,
        retrieval_context: compactRetrievalContext(retrieval),
      },
    };

    let result: Record<string, unknown>;
    if (document.fileId) {
      result = await generateWithFile(openaiKey, document.fileId, generationContext, principles);
      await deleteOpenAIFile(openaiKey, document.fileId);
    } else {
      result = await generateWithText(openaiKey, generationContext, principles, document.text);
    }

    if (typeof result.error === 'string') {
      await failRun(adminClient, run.id, stepByCommand(steps, 'GENERATE_FOUNDATIONS_PHASE'), result.error);
      return json({ error: result.error, run_id: run.id }, 500);
    }

    result = await refineProgrammeForEquipmentAndFoundationRules(openaiKey, result, generationContext, principles);

    const programme = safeProgramme(result.programme);
    const coachingReasoning = safeRecord(result.coaching_reasoning);
    const phaseRoadmap = Array.isArray(result.phase_roadmap) ? result.phase_roadmap : buildPhaseRoadmap(programme);
    const phaseNutrition = safePhaseNutrition(result.phase_nutrition, programme);
    const validation = validateProgramme(programme, phaseNutrition, retrieval, mode, generationContext);

    await recordGenerationOutputs(adminClient, steps, programme, phaseRoadmap, phaseNutrition);
    await createReviewOutputs(adminClient, run.id, clientId, context.active_assignment?.id ?? null, validation, programme, phaseNutrition);

    await adminClient
      .from('pt_program_generation_runs')
      .update({
        status: validation.status,
        current_command: 'OPEN_COACH_REVIEW',
        coaching_reasoning: coachingReasoning,
        phase_roadmap: phaseRoadmap,
        programme_draft: programme,
        nutrition_draft: phaseNutrition,
        validation_summary: validation,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id);

    const openReviewStep = stepByCommand(steps, 'OPEN_COACH_REVIEW');
    await markStep(adminClient, openReviewStep, 'succeeded', { destination: 'programme_editor' }, {
      review_status: validation.status,
      message: 'Draft returned to the coach for review in the existing programme editor.',
    });

    await invokeUpdateClientBrain(url, serviceKey, clientId, {
      trigger_type: 'program_generation',
      content: text(result.change_summary, mode === 'new_programme' ? 'Programme draft generated.' : 'Programme revision draft generated.'),
      structured_data: {
        coaching_reasoning: coachingReasoning,
        movement_priorities: Array.isArray(coachingReasoning.movement_priorities) ? coachingReasoning.movement_priorities : undefined,
        injury_precautions: Array.isArray(coachingReasoning.injury_precautions) ? coachingReasoning.injury_precautions : undefined,
        progression_strategy: {
          strategy: coachingReasoning.progression_strategy ?? null,
          phase_roadmap: phaseRoadmap,
          generation_run_id: run.id,
        },
        important_decision: {
          decision: mode === 'new_programme' ? 'Generated programme draft for coach review' : 'Generated programme revision draft for coach review',
          validation_status: validation.status,
          generation_run_id: run.id,
        },
      },
    });

    return json({
      ok: true,
      mode,
      run_id: run.id,
      review_status: validation.status,
      validation_summary: validation,
      retrieval_context: retrieval,
      client_id: clientId,
      assignment_id: context.active_assignment?.id ?? null,
      name: text(result.name, mode === 'new_programme' ? `${context.client.name} Programme` : context.active_assignment?.name ?? `${context.client.name} Programme`),
      goal: text(result.goal, context.active_assignment?.goal ?? context.client.goals ?? ''),
      change_summary: text(result.change_summary, mode === 'new_programme' ? 'Draft programme created for Pedro to review.' : 'Draft revision created for Pedro to review.'),
      coaching_reasoning: coachingReasoning,
      phase_roadmap: phaseRoadmap,
      phase_nutrition: phaseNutrition,
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

  const [assignmentsRes, notesRes, messagesRes, workoutsRes, setsRes, exercisesRes, knowledgeDocsRes] = await Promise.all([
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
    adminClient
      .from('pt_knowledge_documents')
      .select('id, title, description, chunk_count')
      .order('created_at', { ascending: true }),
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
    knowledge_catalog: (knowledgeDocsRes.data ?? []).map((doc) => {
      const d = doc as { id: string; title: string; description: string | null; chunk_count: number };
      return { id: d.id, title: d.title, description: d.description, chunk_count: d.chunk_count };
    }),
  };
}

function compactGenerationContext(context: Record<string, unknown>): Record<string, unknown> {
  const exerciseLibrary = Array.isArray(context.exercise_library) ? context.exercise_library : [];
  const recentSets = Array.isArray(context.recent_sets) ? context.recent_sets : [];
  const recentMessages = Array.isArray(context.recent_messages) ? context.recent_messages : [];
  const recentWorkouts = Array.isArray(context.recent_workouts) ? context.recent_workouts : [];
  const feedbackNotes = Array.isArray(context.active_feedback_notes) ? context.active_feedback_notes : [];

  const knowledgeCatalog = Array.isArray(context.knowledge_catalog) ? context.knowledge_catalog : [];

  return {
    mode: context.mode,
    pedro_instruction: context.pedro_instruction,
    client: context.client,
    active_assignment: context.active_assignment,
    recent_assignments: context.recent_assignments,
    active_feedback_notes: feedbackNotes.slice(0, 12),
    recent_messages: recentMessages.slice(0, 12),
    recent_workouts: recentWorkouts.slice(0, 12),
    recent_sets: recentSets.slice(0, 50),
    knowledge_base_catalog: knowledgeCatalog,
    exercise_library: exerciseLibrary.slice(0, 140).map((item) => {
      const exercise = safeRecord(item);
      return {
        id: exercise.id,
        name: exercise.name,
        muscles: exercise.muscles,
        purpose: exercise.purpose,
        equipment: exercise.equipment,
        video_url: exercise.video_url,
        cues: Array.isArray(exercise.cues) ? exercise.cues.slice(0, 4) : [],
        tags: Array.isArray(exercise.tags) ? exercise.tags.slice(0, 6) : [],
      };
    }),
  };
}

function compactRetrievalContext(retrieval: Record<string, unknown>): Record<string, unknown> {
  const excerpts = Array.isArray(retrieval.relevant_excerpts) ? retrieval.relevant_excerpts : [];
  return {
    log_id: retrieval.log_id,
    confidence_score: retrieval.confidence_score,
    low_confidence: retrieval.low_confidence,
    warnings: retrieval.warnings,
    applied_rules: retrieval.applied_rules,
    referenced_documents: retrieval.referenced_documents,
    relevant_excerpts: excerpts.slice(0, 6).map((item) => {
      const excerpt = safeRecord(item);
      const chunkText = text(excerpt.chunk_text, '');
      return {
        document_title: excerpt.document_title,
        similarity: excerpt.similarity,
        priority_rank: excerpt.priority_rank,
        chunk_text: chunkText.length > 900 ? `${chunkText.slice(0, 900)}...` : chunkText,
      };
    }),
  };
}

async function createGenerationRun(
  adminClient: ReturnType<typeof createClient>,
  clientId: string,
  assignmentId: string | undefined,
  mode: AgentMode,
  instructions: string,
  userId: string | null,
): Promise<{ id: string }> {
  const { data, error } = await adminClient
    .from('pt_program_generation_runs')
    .insert({
      client_id: clientId,
      assignment_id: assignmentId ?? null,
      task_type: mode,
      current_command: 'LOAD_CLIENT_CARD',
      status: 'running',
      coaching_reasoning: {
        pedro_instruction: instructions || null,
      },
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !data?.id) throw new Error(`Could not create generation run: ${error?.message ?? 'missing id'}`);
  return { id: String(data.id) };
}

async function createGenerationSteps(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
): Promise<GenerationStep[]> {
  const rows = COMMANDS.map((commandName, index) => ({
    run_id: runId,
    step_order: index + 1,
    command_name: commandName,
    status: 'pending',
  }));

  const { data, error } = await adminClient
    .from('pt_program_generation_steps')
    .insert(rows)
    .select('id, command_name, step_order')
    .order('step_order', { ascending: true });

  if (error || !data) throw new Error(`Could not create generation steps: ${error?.message ?? 'missing rows'}`);
  return (data as Array<{ id: string; command_name: string; step_order: number }>).map((row) => ({
    id: row.id,
    command_name: row.command_name,
    step_order: row.step_order,
  }));
}

function stepByCommand(steps: GenerationStep[], commandName: string): GenerationStep {
  const step = steps.find((item) => item.command_name === commandName);
  if (!step) throw new Error(`Missing generation step: ${commandName}`);
  return step;
}

async function markStep(
  adminClient: ReturnType<typeof createClient>,
  step: GenerationStep,
  status: 'running' | 'succeeded' | 'failed' | 'skipped',
  input?: unknown,
  output?: unknown,
  failureReason?: string,
) {
  const patch: Record<string, unknown> = {
    status,
  };
  if (input !== undefined) patch.input_json = input;
  if (output !== undefined) patch.output_json = output;
  if (failureReason) patch.failure_reason = failureReason;
  if (status === 'running') patch.started_at = new Date().toISOString();
  if (status === 'succeeded' || status === 'failed' || status === 'skipped') {
    patch.completed_at = new Date().toISOString();
  }

  await adminClient.from('pt_program_generation_steps').update(patch).eq('id', step.id);
}

async function failRun(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  step: GenerationStep,
  reason: string,
) {
  await markStep(adminClient, step, 'failed', undefined, undefined, reason);
  await adminClient
    .from('pt_program_generation_runs')
    .update({
      status: 'failed',
      current_command: step.command_name,
      failure_reason: reason,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);
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
): Promise<Record<string, unknown> & { ok: boolean; error?: string }> {
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
  if (!res.ok) {
    return {
      ok: false,
      error: typeof payload.error === 'string' ? payload.error : `Retrieval failed with ${res.status}`,
      ...payload,
    };
  }
  return { ok: true, ...payload };
}

async function invokeUpdateClientBrain(
  supabaseUrl: string,
  serviceKey: string,
  clientId: string,
  body: {
    trigger_type: string;
    content: string;
    structured_data?: Record<string, unknown>;
  },
) {
  await fetch(`${supabaseUrl}/functions/v1/update-client-brain`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      ...body,
    }),
  }).catch(() => {});
}

function buildRetrievalQuestion(context: Record<string, unknown>, mode: AgentMode, instructions: string): string {
  const client = safeRecord(context.client);
  const assignment = safeRecord(context.active_assignment);
  return [
    `Build a ${mode === 'new_programme' ? 'new full programme' : 'programme revision'} for ${text(client.name, 'this client')}.`,
    `Goal: ${text(client.goals, 'not specified')}.`,
    `Notes: ${text(client.notes, 'none')}.`,
    assignment.name ? `Current programme: ${text(assignment.name, '')}.` : '',
    instructions ? `Pedro instruction: ${instructions}.` : '',
    'Equipment rule: if client documents/text do not explicitly say bands-only/bodyweight/home/no-gym, assume gym access. For gym Foundation, do not use banded exercises.',
    'Foundation rule: pain/movement restrictions outrank performance goals; Day 1 and Day 3 single-arm/single-leg emphasis; Day 2 bilateral emphasis; pull/push/anterior-lower/posterior-lower/hip-core slots; no same-day repeated exercise-family variations; tempo/control note on every exercise.',
    'Need phase roadmap, foundations, warm-ups, 1RM testing, hypertrophy, strength, retest, taper, phase nutrition, and validation rules.',
  ].filter(Boolean).join('\n');
}

async function recordGenerationOutputs(
  adminClient: ReturnType<typeof createClient>,
  steps: GenerationStep[],
  programme: Programme,
  phaseRoadmap: unknown,
  phaseNutrition: unknown,
) {
  await markStep(adminClient, stepByCommand(steps, 'CREATE_PHASE_ROADMAP'), 'succeeded', undefined, phaseRoadmap);
  const phaseMap: Record<string, string[]> = {
    GENERATE_FOUNDATIONS_PHASE: ['foundation'],
    GENERATE_1RM_TEST_SESSION: ['1rm', 'testing'],
    GENERATE_HYPERTROPHY_PHASE: ['hypertrophy'],
    GENERATE_STRENGTH_PHASE: ['strength'],
    GENERATE_RETEST_SESSION: ['retest'],
    GENERATE_TAPER_PHASE: ['taper'],
  };

  for (const [command, matches] of Object.entries(phaseMap)) {
    const phases = programme.phases.filter((phase) => {
      const title = `${phase.title} ${phase.focus}`.toLowerCase();
      return matches.some((match) => title.includes(match));
    });
    await markStep(adminClient, stepByCommand(steps, command), phases.length > 0 ? 'succeeded' : 'skipped', undefined, { phases });
  }

  const warmups = programme.phases.flatMap((phase) =>
    phase.days.map((day) => ({
      phase_title: phase.title,
      day_title: day.title,
      warmup_count: day.exercises.filter((exercise) => exercise.section_start === 'Warm Up' || exercise.name.toLowerCase().includes('warm')).length,
    }))
  );
  await markStep(adminClient, stepByCommand(steps, 'GENERATE_WORKOUT_WARMUPS'), 'succeeded', undefined, { warmups });
  await markStep(adminClient, stepByCommand(steps, 'GENERATE_PHASE_NUTRITION'), 'succeeded', undefined, phaseNutrition);
}

async function createReviewOutputs(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  clientId: string,
  assignmentId: unknown,
  validation: Record<string, unknown>,
  programme: Programme,
  phaseNutrition: unknown,
) {
  const status = text(validation.status, 'needs_review') === 'failed' ? 'failed' : 'needs_review';
  const findings = Array.isArray(validation.findings) ? validation.findings : [];
  const hardRuleFailures = Array.isArray(validation.hard_rule_failures) ? validation.hard_rule_failures : [];
  const assignment_id = typeof assignmentId === 'string' ? assignmentId : null;

  await adminClient.from('pt_program_review_outputs').insert([
    {
      run_id: runId,
      assignment_id,
      client_id: clientId,
      review_type: 'program',
      status,
      findings,
      hard_rule_failures: hardRuleFailures,
      repaired_output: programme,
      reviewer_notes: 'Deterministic programme review completed. Pedro must approve or edit before use.',
    },
    {
      run_id: runId,
      assignment_id,
      client_id: clientId,
      review_type: 'nutrition',
      status: Array.isArray(phaseNutrition) && phaseNutrition.length > 0 ? 'needs_review' : 'failed',
      findings: Array.isArray(phaseNutrition) && phaseNutrition.length > 0 ? [] : ['No phase nutrition was generated.'],
      hard_rule_failures: Array.isArray(phaseNutrition) && phaseNutrition.length > 0 ? [] : ['Missing phase nutrition synchronization.'],
      repaired_output: { phase_nutrition: phaseNutrition },
      reviewer_notes: 'Nutrition strategy is phase-linked and needs coach review.',
    },
    {
      run_id: runId,
      assignment_id,
      client_id: clientId,
      review_type: 'system',
      status,
      findings,
      hard_rule_failures: hardRuleFailures,
      repaired_output: { validation },
      reviewer_notes: 'System validation completed for audit trail.',
    },
  ]);

  await markStep(adminClient, stepByCommand(await getStepsForRun(adminClient, runId), 'PROGRAM_REVIEW_AGENT'), 'succeeded', undefined, { status, findings, hard_rule_failures: hardRuleFailures });
  await markStep(adminClient, stepByCommand(await getStepsForRun(adminClient, runId), 'NUTRITION_REVIEW_AGENT'), 'succeeded', undefined, { phase_nutrition: phaseNutrition });
  await markStep(adminClient, stepByCommand(await getStepsForRun(adminClient, runId), 'SYSTEM_VALIDATION_AGENT'), 'succeeded', undefined, { validation });
  await markStep(adminClient, stepByCommand(await getStepsForRun(adminClient, runId), 'VALIDATE_FULL_PROGRAM'), 'succeeded', undefined, validation);
}

async function getStepsForRun(adminClient: ReturnType<typeof createClient>, runId: string): Promise<GenerationStep[]> {
  const { data, error } = await adminClient
    .from('pt_program_generation_steps')
    .select('id, command_name, step_order')
    .eq('run_id', runId)
    .order('step_order', { ascending: true });
  if (error || !data) return [];
  return (data as Array<{ id: string; command_name: string; step_order: number }>).map((row) => ({
    id: row.id,
    command_name: row.command_name,
    step_order: row.step_order,
  }));
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

async function refineProgrammeForEquipmentAndFoundationRules(
  openaiKey: string,
  result: Record<string, unknown>,
  context: Record<string, unknown>,
  principles: string,
): Promise<Record<string, unknown>> {
  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}

You are the final programming rule-review layer before Pedro sees the draft.
Return the SAME top-level JSON schema you receive. Do not add commentary.

Audit and adapt the programme using these hard rules:
- Infer equipment from client documents, notes, messages, logs, and Pedro instructions. If equipment is not explicitly limited to bands/bodyweight/home/no-gym/travel, assume gym access.
- For gym Foundation, remove banded exercises. No banded deadlifts, hinges, squats, rows, presses, or banded lower-body substitutes.
- For gym Foundation hinges, prefer DB deadlift, KB deadlift, single-leg DB RDL, cable pull-through style work, machines, or bodyweight regressions.
- Foundation is 3 full-body days. Pain and movement restrictions outrank performance goals. Day 1 and Day 3 must emphasize single-arm and single-leg work. Day 2 must emphasize bilateral/two-arm/two-leg work.
- Every Foundation Workout day needs 1 pull, 1 push, 1 anterior lower, 1 posterior lower, and hip/core corrective coverage. Do not repeat multiple variations of the same exercise family in one day. Generated Foundation days only contain Warm Up and Workout.
- Every Foundation exercise note must include tempo, controlled eccentric, pause, range, or execution intent.
- Prefer these Foundation staples when relevant: Hip flexor cable pull, Standing hip flexor KB pull, Half kneeling adductor slides sideways, Half kneeling adductor slides front/front-splits, Single-leg glute bridge, Single-leg hip thrust, Single-arm cable pull, DB push, Single-leg step-up, Cable crunch, Back extension, QL extension on back extension machine, Leg press, Knee extension, Hamstring curl, Single-leg DB RDL, Seated shoulder press, Hip CARs.
- Compare the programme against the client's goals, injuries, dislikes, schedule, training history, and logs. Adapt exercises until the plan fits the client.
- Preserve phase order, week_blocks, 1RM test/retest structure, Big 5 exposure, exercise object shape, and editability.

Pedro programming principles:
${principles}`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            context,
            generated_draft: result,
          }),
        },
      ],
    }),
  });

  if (!chatRes.ok) return result;
  const chatJson = (await chatRes.json().catch(() => ({}))) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
  if (chatJson.error) return result;
  const refined = parseJsonResult(chatJson.choices?.[0]?.message.content ?? '{}');
  if (typeof refined.error === 'string') return result;
  return refined;
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

function buildPhaseRoadmap(programme: Programme): Array<Record<string, unknown>> {
  return programme.phases.map((phase, index) => ({
    phase_index: index,
    phase_title: phase.title,
    phase_type: phaseTypeFromTitle(phase.title, phase.focus),
    weeks: phase.weeks,
    purpose: phase.focus || phase.progression,
    progression: phase.progression,
  }));
}

function safePhaseNutrition(value: unknown, programme: Programme): Array<Record<string, unknown>> {
  const rows = Array.isArray(value) ? value : [];
  const parsed = rows
    .map((item): Record<string, unknown> | null => {
      const record = safeRecord(item);
      const phaseIndex = typeof record.phase_index === 'number'
        ? record.phase_index
        : Number.parseInt(String(record.phase_index ?? ''), 10);
      if (!Number.isFinite(phaseIndex)) return null;
      const phase = programme.phases[phaseIndex];
      return {
        phase_index: phaseIndex,
        phase_title: text(record.phase_title, phase?.title ?? `Phase ${phaseIndex + 1}`),
        phase_type: text(record.phase_type, phase ? phaseTypeFromTitle(phase.title, phase.focus) : 'general'),
        training_context: safeRecord(record.training_context),
        recommendations: safeRecord(record.recommendations),
      };
    })
    .filter((item): item is Record<string, unknown> => item !== null);

  if (parsed.length > 0) return parsed;
  return programme.phases.map((phase, index) => ({
    phase_index: index,
    phase_title: phase.title,
    phase_type: phaseTypeFromTitle(phase.title, phase.focus),
    training_context: {
      weeks: phase.weeks,
      focus: phase.focus,
      progression: phase.progression,
    },
    recommendations: {
      priority: 'Coach to review calories, protein, carbohydrates, recovery, and adherence needs for this phase.',
    },
  }));
}

function validateProgramme(
  programme: Programme,
  phaseNutrition: Array<Record<string, unknown>>,
  retrieval: Record<string, unknown>,
  mode: AgentMode,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const findings: string[] = [];
  const hardRuleFailures: string[] = [];
  const isGymAccess = inferGymAccess(context);

  if (programme.phases.length === 0) hardRuleFailures.push('Programme has no phases.');
  if (mode === 'new_programme' && programme.phases.length < 5) {
    hardRuleFailures.push('New programmes must include the full Cerebro phase arc unless Pedro explicitly changes the structure.');
  }
  if (phaseNutrition.length < programme.phases.length) findings.push('Not every phase has an explicit nutrition strategy.');
  if (retrieval.low_confidence === true) findings.push('Knowledge retrieval confidence was low. Coach review required.');

  programme.phases.forEach((phase, phaseIndex) => {
    if (!phase.title.trim()) hardRuleFailures.push(`Phase ${phaseIndex + 1} is missing a title.`);
    if (!phase.weeks.trim()) findings.push(`${phase.title || `Phase ${phaseIndex + 1}`} is missing duration.`);
    if (phase.days.length === 0) hardRuleFailures.push(`${phase.title || `Phase ${phaseIndex + 1}`} has no workout days.`);

    const isFoundations = phase.title.toLowerCase().includes('foundation') || phaseIndex === 0;
    if (isFoundations && phase.days.length !== 3) {
      hardRuleFailures.push(`${phase.title || 'Phase 1'} must have exactly 3 full-body workout days (currently has ${phase.days.length}).`);
    }
    if (isFoundations && isGymAccess) {
      const banded = phase.days.flatMap((day) =>
        day.exercises
          .filter((exercise) => isBandedExercise(exercise.name))
          .map((exercise) => `${day.title || 'day'}: ${exercise.name}`)
      );
      if (banded.length > 0) {
        hardRuleFailures.push(`${phase.title || 'Phase 1'} is gym Foundation but contains banded exercises: ${banded.join(', ')}.`);
      }
    }
    if (isFoundations) {
      const missingTempo = phase.days.flatMap((day) =>
        day.exercises
          .filter((exercise) => !hasTempoOrControlCue(exercise.notes))
          .map((exercise) => `${day.title || 'day'}: ${exercise.name}`)
      );
      if (missingTempo.length > 0) {
        hardRuleFailures.push(`${phase.title || 'Phase 1'} must include tempo/control notes on every exercise. Missing: ${missingTempo.slice(0, 8).join(', ')}${missingTempo.length > 8 ? '...' : ''}.`);
      }
      if (phase.days.length === 3) {
        const unilateralDays = phase.days.filter((day) => dayHasUnilateralEmphasis(day));
        if (unilateralDays.length < 2) {
          hardRuleFailures.push(`${phase.title || 'Phase 1'} must have at least 2 Foundation days with single-arm and/or single-leg emphasis.`);
        }
        const bilateralDay = phase.days.some((day) => dayHasBilateralEmphasis(day));
        if (!bilateralDay) {
          findings.push(`${phase.title || 'Phase 1'} should include one bilateral-emphasis Foundation day.`);
        }
      }
    }

    const isHypertrophy = phase.title.toLowerCase().includes('hypertrophy');
    if (isHypertrophy) {
      if (!phase.week_blocks || phase.week_blocks.length === 0) {
        hardRuleFailures.push(`${phase.title}: Hypertrophy phase is missing week_blocks. Must include blocks with both sets and weight_pct for every progression block.`);
      } else if (!phase.week_blocks.every((block) => block.weight_pct)) {
        hardRuleFailures.push(`${phase.title}: Every Hypertrophy week_block must include weight_pct. Missing percentage on one or more blocks.`);
      } else if (!phase.week_blocks.every((block) => block.sets)) {
        hardRuleFailures.push(`${phase.title}: Every Hypertrophy week_block must include sets. Missing set count on one or more blocks.`);
      }
    }

    const isStrength = phase.title.toLowerCase().includes('strength') && !phase.title.toLowerCase().includes('muscle');
    if (isStrength) {
      if (!phase.week_blocks || phase.week_blocks.length === 0) {
        hardRuleFailures.push(`${phase.title}: Strength phase is missing week_blocks. Must include blocks with both sets and weight_pct for every progression block.`);
      } else if (!phase.week_blocks.every((block) => block.weight_pct)) {
        hardRuleFailures.push(`${phase.title}: Every Strength week_block must include weight_pct. Missing percentage on one or more blocks.`);
      } else if (!phase.week_blocks.every((block) => block.sets)) {
        hardRuleFailures.push(`${phase.title}: Every Strength week_block must include sets. Missing set count on one or more blocks.`);
      }
    }

    phase.days.forEach((day, dayIndex) => {
      if (day.exercises.length === 0) hardRuleFailures.push(`${phase.title} / day ${dayIndex + 1} has no exercises.`);
      const sectionStarts = day.exercises
        .map((exercise) => exercise.section_start)
        .filter((section): section is string => typeof section === 'string' && section.trim().length > 0);
      if (!sectionStarts.includes('Warm Up')) findings.push(`${phase.title} / ${day.title || `day ${dayIndex + 1}`} has no Warm Up section marker.`);
      if (!sectionStarts.includes('Workout')) hardRuleFailures.push(`${phase.title} / ${day.title || `day ${dayIndex + 1}`} has no Workout section marker.`);

      const workoutIdx = day.exercises.findIndex((ex) => ex.section_start === 'Workout');
      const warmUpCount = workoutIdx > 0 ? workoutIdx : 0;
      if (sectionStarts.includes('Warm Up') && warmUpCount !== 4) {
        findings.push(`${phase.title} / ${day.title || `day ${dayIndex + 1}`} warm-up should have exactly 4 exercises (has ${warmUpCount}).`);
      }

      day.exercises.forEach((exercise) => {
        if (!exercise.name.trim()) hardRuleFailures.push(`${phase.title} / ${day.title} has an unnamed exercise.`);
        if (exercise.cues.length === 0) findings.push(`${exercise.name || 'An exercise'} has no client-facing cues.`);
      });
    });
  });

  return {
    status: hardRuleFailures.length > 0 ? 'failed' : 'needs_review',
    findings,
    hard_rule_failures: hardRuleFailures,
    inferred_equipment: isGymAccess ? 'gym' : 'limited',
    retrieval_low_confidence: retrieval.low_confidence === true,
    phase_count: programme.phases.length,
    nutrition_phase_count: phaseNutrition.length,
    validated_at: new Date().toISOString(),
  };
}

function inferGymAccess(context: Record<string, unknown>): boolean {
  const raw = JSON.stringify(context).toLowerCase();
  const limitedEquipmentSignals = [
    'bands only',
    'band only',
    'bodyweight only',
    'body weight only',
    'home only',
    'home workout',
    'home workouts',
    'no gym',
    'without gym',
    'minimal equipment',
    'travel workout',
    'hotel workout',
  ];
  return !limitedEquipmentSignals.some((signal) => raw.includes(signal));
}

function isBandedExercise(name: string): boolean {
  const value = name.toLowerCase();
  return /\bband(ed)?\b|\bresistance band\b|\bmini band\b/.test(value);
}

function hasTempoOrControlCue(notes: string): boolean {
  const value = notes.toLowerCase();
  return [
    'tempo',
    'eccentric',
    'descent',
    'lower',
    'pause',
    'hold',
    'controlled',
    'control',
    'slow',
    'range',
    'rom',
    'intent',
  ].some((signal) => value.includes(signal));
}

function dayHasUnilateralEmphasis(day: ProgrammeDay): boolean {
  const names = day.exercises.map((exercise) => exercise.name.toLowerCase()).join(' ');
  return [
    'single arm',
    'single-arm',
    'single leg',
    'single-leg',
    'one arm',
    'one-arm',
    'one leg',
    'one-leg',
    'split squat',
    'step-up',
    'step up',
    'lunge',
    'unilateral',
  ].some((signal) => names.includes(signal));
}

function dayHasBilateralEmphasis(day: ProgrammeDay): boolean {
  const names = day.exercises.map((exercise) => exercise.name.toLowerCase()).join(' ');
  return [
    'leg press',
    'goblet squat',
    'db deadlift',
    'dumbbell deadlift',
    'kb deadlift',
    'kettlebell deadlift',
    'barbell',
    'bb ',
    'bench press',
    'seated shoulder press',
    'back extension',
    'hamstring curl',
    'knee extension',
  ].some((signal) => names.includes(signal));
}

function phaseTypeFromTitle(title: string, focus: string): string {
  const textValue = `${title} ${focus}`.toLowerCase();
  if (textValue.includes('foundation')) return 'foundations';
  if (textValue.includes('1rm') || textValue.includes('test')) return 'testing';
  if (textValue.includes('hypertrophy')) return 'hypertrophy';
  if (textValue.includes('strength')) return 'strength';
  if (textValue.includes('retest')) return 'retest';
  if (textValue.includes('taper')) return 'taper';
  return 'general';
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

function jwtPayload(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function safeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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
