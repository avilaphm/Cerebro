import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'];

type ActivityTag = 'sedentary' | 'lightly_active' | 'moderately_active' | 'very_active' | 'athlete_level';

interface RequestBody {
  client_id?: string;
  height_cm?: number;
  weight_kg?: number;
  activity_level?: number;
}

interface DailyTargets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

interface PhaseTarget {
  phase_index: number;
  phase_title: string;
  phase_type: string;
  weeks: number;
  targets: DailyTargets;
  strategy: string;
}

interface DraftPlan {
  daily_targets: DailyTargets;
  phase_targets: PhaseTarget[];
  assumptions: string[];
  goal_interpretation: string;
  activity_tag: ActivityTag;
  estimated_tdee: number;
}

interface FinalPlan {
  final_daily_targets: DailyTargets;
  phase_targets: PhaseTarget[];
  pyramid_principles_applied: string[];
  client_goal_alignment: string;
  changes_from_draft: string[];
  coach_notes: string;
  client_summary: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jwtPayload(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
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
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY is required for the Nutrition Pyramid finalizer.' }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);
    const token = authHeader.replace('Bearer ', '');
    const isServiceRequest = token === serviceKey || jwtPayload(token).role === 'service_role';
    const authData = isServiceRequest
      ? { user: { id: 'service-role', email: 'service-role' } }
      : (await userClient.auth.getUser()).data;
    if (!authData.user) return json({ error: 'Unauthorized.' }, 401);

    const body = (await req.json()) as RequestBody;
    const clientId = body.client_id;
    const heightCm = numberInRange(body.height_cm, 100, 240);
    const weightKg = numberInRange(body.weight_kg, 30, 250);
    const activityLevel = Math.round(Number(body.activity_level));

    if (!clientId) return json({ error: 'client_id required.' }, 400);
    if (!heightCm) return json({ error: 'height_cm must be between 100 and 240.' }, 400);
    if (!weightKg) return json({ error: 'weight_kg must be between 30 and 250.' }, 400);
    if (!Number.isFinite(activityLevel) || activityLevel < 1 || activityLevel > 5) {
      return json({ error: 'activity_level must be 1-5.' }, 400);
    }

    const authz = isServiceRequest
      ? { ok: true as const }
      : await authorizeClient(admin, authData.user.id, authData.user.email ?? '', clientId);
    if (!authz.ok) return json({ error: authz.error }, authz.status);

    const [
      clientRes,
      assignmentRes,
      nutritionDocRes,
      exerciseDocRes,
      lifestyleDocRes,
      documentsRes,
    ] = await Promise.all([
      admin.from('pt_clients').select('*').eq('id', clientId).single(),
      admin
        .from('pt_program_assignments')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from('pt_client_nutrition_doc').select('*').eq('client_id', clientId).maybeSingle(),
      admin.from('pt_client_exercise_doc').select('*').eq('client_id', clientId).maybeSingle(),
      admin.from('pt_client_lifestyle_doc').select('*').eq('client_id', clientId).maybeSingle(),
      admin
        .from('pt_client_documents')
        .select('title, document_type, content_text, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

    if (clientRes.error || !clientRes.data) return json({ error: 'Client not found.' }, 404);
    if (assignmentRes.error || !assignmentRes.data) return json({ error: 'No active training programme found for this client.' }, 400);

    const client = clientRes.data as Record<string, unknown>;
    const assignment = assignmentRes.data as Record<string, unknown>;
    const programme = (assignment.programme as { phases?: Array<Record<string, unknown>> } | null) ?? { phases: [] };
    const phases = Array.isArray(programme.phases) ? programme.phases : [];
    if (phases.length === 0) return json({ error: 'Active programme has no phases.' }, 400);

    const activityTag = activityTagFor(activityLevel);
    const draft = buildDraftPlan({
      client,
      assignment,
      phases,
      heightCm,
      weightKg,
      activityLevel,
      activityTag,
    });

    const pyramidContext = await retrievePyramidContext({
      supabaseUrl,
      serviceKey,
      clientGoal: String(client.goals ?? assignment.goal ?? ''),
    });

    if (!pyramidContext.ok) return json({ error: pyramidContext.error }, 502);

    const finalPlan = await finalizeWithPyramid({
      anthropicKey,
      client,
      assignment,
      draft,
      nutritionDoc: nutritionDocRes.data as Record<string, unknown> | null,
      exerciseDoc: exerciseDocRes.data as Record<string, unknown> | null,
      lifestyleDoc: lifestyleDocRes.data as Record<string, unknown> | null,
      documents: (documentsRes.data ?? []) as Array<Record<string, unknown>>,
      pyramidContext,
    });

    const now = new Date().toISOString();
    const bodyProfile = {
      height_cm: heightCm,
      weight_kg: weightKg,
      activity_level: activityLevel,
      activity_tag: activityTag,
      updated_at: now,
    };
    const existingEatingHabits = ((nutritionDocRes.data?.eating_habits as Record<string, unknown>) ?? {});
    const phaseStrategy = Object.fromEntries(finalPlan.phase_targets.map((phase) => [
      `${phase.phase_index}:${phase.phase_title}`,
      {
        phase_title: phase.phase_title,
        phase_type: phase.phase_type,
        targets: phase.targets,
        strategy: phase.strategy,
        updated_at: now,
      },
    ]));
    const finalizerAudit = {
      source_document: 'The Muscle and Strength Pyramid - Nutrition v2.0 .pdf.pdf',
      retrieved_documents: pyramidContext.referenced_documents,
      confidence_score: pyramidContext.confidence_score,
      principles_applied: finalPlan.pyramid_principles_applied,
      changes_from_draft: finalPlan.changes_from_draft,
      client_goal_alignment: finalPlan.client_goal_alignment,
      coach_notes: finalPlan.coach_notes,
      client_summary: finalPlan.client_summary,
      draft,
      finalized_at: now,
    };

    const writes = await Promise.all([
      admin
        .from('pt_clients')
        .update({
          height_cm: heightCm,
          current_weight_kg: weightKg,
          activity_level: activityLevel,
          activity_tag: activityTag,
          nutrition_onboarding_completed_at: now,
          updated_at: now,
        })
        .eq('id', clientId),
      admin
        .from('pt_client_metrics')
        .insert({
          client_id: clientId,
          measured_at: now.slice(0, 10),
          weight_kg: weightKg,
          source: 'manual',
          notes: 'Nutrition onboarding weight.',
        }),
      admin
        .from('pt_client_nutrition_doc')
        .upsert({
          client_id: clientId,
          daily_targets: finalPlan.final_daily_targets,
          phase_nutrition_strategy: phaseStrategy,
          pyramid_finalizer: finalizerAudit,
          eating_habits: {
            ...existingEatingHabits,
            body_profile: bodyProfile,
            nutrition_programme_summary: finalPlan.client_summary,
          },
          updated_at: now,
        }, { onConflict: 'client_id' }),
      admin
        .from('pt_program_assignments')
        .update({
          nutrition_sync: {
            status: 'auto_published',
            daily_targets: finalPlan.final_daily_targets,
            phase_count: finalPlan.phase_targets.length,
            pyramid_finalized_at: now,
          },
          updated_at: now,
        })
        .eq('id', assignment.id),
      ...finalPlan.phase_targets.map((phase) => admin
        .from('pt_phase_nutrition')
        .upsert({
          client_id: clientId,
          assignment_id: assignment.id,
          generation_run_id: assignment.generation_run_id ?? null,
          phase_index: phase.phase_index,
          phase_title: phase.phase_title,
          phase_type: phase.phase_type,
          training_context: {
            programme_name: assignment.name,
            programme_goal: assignment.goal,
            phase_weeks: phase.weeks,
          },
          recommendations: {
            daily_targets: phase.targets,
            strategy: phase.strategy,
            client_summary: finalPlan.client_summary,
          },
          finalizer_notes: finalizerAudit,
          review_status: 'approved',
          updated_at: now,
        }, { onConflict: 'assignment_id,phase_index' })),
    ]);

    const errors = writes.filter((w) => w.error).map((w) => w.error!.message);
    if (errors.length > 0) return json({ error: 'Nutrition programme write failed.', details: errors }, 500);

    await Promise.allSettled([
      callInternalFunction(supabaseUrl, serviceKey, 'update-client-brain', {
        client_id: clientId,
        trigger_type: 'metric_added',
        content: `Nutrition onboarding completed. Height ${heightCm}cm, weight ${weightKg}kg, activity level ${activityLevel}/5 (${activityTag}). Final targets: ${finalPlan.final_daily_targets.calories} kcal, ${finalPlan.final_daily_targets.protein_g}g protein.`,
        structured_data: {
          nutrition_priorities: {
            body_profile: bodyProfile,
            final_daily_targets: finalPlan.final_daily_targets,
            pyramid_principles_applied: finalPlan.pyramid_principles_applied,
          },
        },
      }),
      callInternalFunction(supabaseUrl, serviceKey, 'embed-client-brain', { client_id: clientId }),
      callInternalFunction(supabaseUrl, serviceKey, 'compute-client-metrics', { client_id: clientId }),
    ]);

    return json({
      ok: true,
      client_id: clientId,
      activity_tag: activityTag,
      draft,
      final_plan: finalPlan,
      pyramid_context: {
        confidence_score: pyramidContext.confidence_score,
        referenced_documents: pyramidContext.referenced_documents,
      },
    });
  } catch (error) {
    console.error('generate-nutrition-programme error:', error);
    return json({ error: error instanceof Error ? error.message : 'Nutrition programme generation failed.' }, 500);
  }
});

async function authorizeClient(
  admin: ReturnType<typeof createClient>,
  userId: string,
  email: string,
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const lowerEmail = email.toLowerCase();
  if (PEDRO_EMAILS.includes(lowerEmail)) return { ok: true };

  const [{ data: profile }, { data: client }] = await Promise.all([
    admin.from('profiles').select('role').eq('id', userId).maybeSingle(),
    admin.from('pt_clients').select('id').eq('id', clientId).eq('user_id', userId).maybeSingle(),
  ]);

  if (profile?.role === 'admin' || client?.id) return { ok: true };
  return { ok: false, error: 'Not allowed to generate nutrition for this client.', status: 403 };
}

function buildDraftPlan(input: {
  client: Record<string, unknown>;
  assignment: Record<string, unknown>;
  phases: Array<Record<string, unknown>>;
  heightCm: number;
  weightKg: number;
  activityLevel: number;
  activityTag: ActivityTag;
}): DraftPlan {
  const gender = typeof input.client.gender === 'string' ? input.client.gender : null;
  const age = ageFromDate(input.client.date_of_birth);
  const bmr = estimateBmr(input.weightKg, input.heightCm, age, gender);
  const tdee = Math.round(bmr * activityMultiplier(input.activityLevel));
  const goalText = `${input.client.goals ?? ''} ${input.client.coaching_focus ?? ''} ${input.assignment.goal ?? ''}`.toLowerCase();
  const goal = inferGoal(goalText);
  const calories = applyGoalCalories(tdee, goal);
  const proteinG = clamp(Math.round(input.weightKg * (goal === 'fat_loss' ? 2.1 : 1.9)), 90, 260);
  const fatG = clamp(Math.round(input.weightKg * 0.8), 40, 110);
  const remainingCalories = Math.max(0, calories - proteinG * 4 - fatG * 9);
  const carbsG = clamp(Math.round(remainingCalories / 4), 80, 500);
  const fibreG = Math.max(25, Math.round((calories / 1000) * 14));
  const dailyTargets = normalizeTargets({ calories, protein_g: proteinG, carbs_g: carbsG, fat_g: fatG, fibre_g: fibreG });

  return {
    daily_targets: dailyTargets,
    phase_targets: input.phases.map((phase, index) => {
      const title = String(phase.title ?? `Phase ${index + 1}`);
      const phaseType = phaseTypeFrom(title, String(phase.focus ?? ''));
      const weeks = parseInt(String(phase.weeks ?? '1'), 10) || 1;
      const adjusted = adjustTargetsForPhase(dailyTargets, phaseType, goal);
      return {
        phase_index: index,
        phase_title: title,
        phase_type: phaseType,
        weeks,
        targets: adjusted,
        strategy: draftStrategyForPhase(phaseType, goal),
      };
    }),
    assumptions: [
      gender && age ? 'BMR estimated with available age and gender.' : 'BMR estimated conservatively from body weight because age or gender was unavailable.',
      `Activity level ${input.activityLevel}/5 mapped to ${input.activityTag}.`,
      `Goal interpreted as ${goal}.`,
    ],
    goal_interpretation: goal,
    activity_tag: input.activityTag,
    estimated_tdee: tdee,
  };
}

async function retrievePyramidContext(input: {
  supabaseUrl: string;
  serviceKey: string;
  clientGoal: string;
}): Promise<{
  ok: true;
  excerpts: Array<Record<string, unknown>>;
  referenced_documents: Array<Record<string, unknown>>;
  applied_rules: Array<Record<string, unknown>>;
  confidence_score: number;
} | { ok: false; error: string }> {
  const res = await fetch(`${input.supabaseUrl}/functions/v1/retrieve-knowledge-context`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.serviceKey}`,
      apikey: input.serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      task_type: 'nutrition',
      phase_type: 'full_cycle',
      client_goal: input.clientGoal,
      question_or_decision: 'Use The Muscle and Strength Pyramid - Nutrition v2.0 to review calories, macros, fibre, timing, supplements, and adherence for a full-cycle client nutrition plan.',
      match_count: 12,
      match_threshold: 0.18,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || data.error) return { ok: false, error: String(data.error ?? `Retrieval failed with HTTP ${res.status}`) };
  const excerpts = (data.relevant_excerpts ?? []) as Array<Record<string, unknown>>;
  const referenced = (data.referenced_documents ?? []) as Array<Record<string, unknown>>;
  const hasPyramid = referenced.some((doc) => String(doc.title ?? '').toLowerCase().includes('nutrition'));
  if (excerpts.length === 0 || !hasPyramid) {
    return { ok: false, error: 'Nutrition Pyramid retrieval returned no usable Pyramid excerpts.' };
  }
  const confidence = Number(data.confidence_score ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0.45) {
    return { ok: false, error: 'Nutrition Pyramid retrieval confidence was too low to auto-publish.' };
  }
  return {
    ok: true,
    excerpts,
    referenced_documents: referenced,
    applied_rules: (data.applied_rules ?? []) as Array<Record<string, unknown>>,
    confidence_score: confidence,
  };
}

async function finalizeWithPyramid(input: {
  anthropicKey: string;
  client: Record<string, unknown>;
  assignment: Record<string, unknown>;
  draft: DraftPlan;
  nutritionDoc: Record<string, unknown> | null;
  exerciseDoc: Record<string, unknown> | null;
  lifestyleDoc: Record<string, unknown> | null;
  documents: Array<Record<string, unknown>>;
  pyramidContext: {
    excerpts: Array<Record<string, unknown>>;
    referenced_documents: Array<Record<string, unknown>>;
    applied_rules: Array<Record<string, unknown>>;
    confidence_score: number;
  };
}): Promise<FinalPlan> {
  const anthropic = new Anthropic({ apiKey: input.anthropicKey });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2400,
    system: `You are the Nutrition Pyramid Finalizer inside Pedro Avila's Cerebro coaching system.
Return only valid JSON. No markdown.

Use the supplied excerpts from "The Muscle and Strength Pyramid - Nutrition v2.0" as the primary source.
Apply the hierarchy: calories, macros, micronutrients/fibre/food quality, timing, supplements.
Do not invent medical advice. Keep changes conservative and practical for an active PT client.
The output must match this schema:
{
  "final_daily_targets": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fibre_g": number},
  "phase_targets": [{"phase_index": number, "phase_title": string, "phase_type": string, "weeks": number, "targets": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fibre_g": number}, "strategy": string}],
  "pyramid_principles_applied": string[],
  "client_goal_alignment": string,
  "changes_from_draft": string[],
  "coach_notes": string,
  "client_summary": string
}`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        client: compactClient(input.client),
        active_programme: {
          id: input.assignment.id,
          name: input.assignment.name,
          goal: input.assignment.goal,
          duration_weeks: input.assignment.duration_weeks,
        },
        nutrition_doc: compactDoc(input.nutritionDoc),
        exercise_doc: compactDoc(input.exerciseDoc),
        lifestyle_doc: compactDoc(input.lifestyleDoc),
        recent_documents: input.documents.map((doc) => ({
          title: doc.title,
          document_type: doc.document_type,
          excerpt: String(doc.content_text ?? '').slice(0, 1800),
        })),
        proposed_draft: input.draft,
        pyramid_context: input.pyramidContext,
      }),
    }],
  });

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const parsed = parseJson(raw) as Partial<FinalPlan> | null;
  if (!parsed) throw new Error('Nutrition Pyramid finalizer did not return valid JSON.');

  const finalDaily = normalizeTargets({
    calories: Number(parsed.final_daily_targets?.calories ?? input.draft.daily_targets.calories),
    protein_g: Number(parsed.final_daily_targets?.protein_g ?? input.draft.daily_targets.protein_g),
    carbs_g: Number(parsed.final_daily_targets?.carbs_g ?? input.draft.daily_targets.carbs_g),
    fat_g: Number(parsed.final_daily_targets?.fat_g ?? input.draft.daily_targets.fat_g),
    fibre_g: Number(parsed.final_daily_targets?.fibre_g ?? input.draft.daily_targets.fibre_g),
  });

  const draftPhaseMap = new Map(input.draft.phase_targets.map((phase) => [phase.phase_index, phase]));
  const parsedPhases = Array.isArray(parsed.phase_targets) ? parsed.phase_targets : [];
  const phaseTargets = input.draft.phase_targets.map((draftPhase) => {
    const next = parsedPhases.find((phase) => Number(phase.phase_index) === draftPhase.phase_index) ?? draftPhase;
    const targets = normalizeTargets({
      calories: Number(next.targets?.calories ?? draftPhase.targets.calories),
      protein_g: Number(next.targets?.protein_g ?? draftPhase.targets.protein_g),
      carbs_g: Number(next.targets?.carbs_g ?? draftPhase.targets.carbs_g),
      fat_g: Number(next.targets?.fat_g ?? draftPhase.targets.fat_g),
      fibre_g: Number(next.targets?.fibre_g ?? draftPhase.targets.fibre_g),
    });
    const original = draftPhaseMap.get(draftPhase.phase_index) ?? draftPhase;
    return {
      phase_index: draftPhase.phase_index,
      phase_title: String(next.phase_title ?? original.phase_title),
      phase_type: String(next.phase_type ?? original.phase_type),
      weeks: Number(next.weeks ?? original.weeks),
      targets,
      strategy: String(next.strategy ?? original.strategy),
    };
  });

  return {
    final_daily_targets: finalDaily,
    phase_targets: phaseTargets,
    pyramid_principles_applied: textArray(parsed.pyramid_principles_applied).slice(0, 8),
    client_goal_alignment: text(parsed.client_goal_alignment, 'Final targets were aligned to the client goal and current training cycle.'),
    changes_from_draft: textArray(parsed.changes_from_draft).slice(0, 8),
    coach_notes: text(parsed.coach_notes, ''),
    client_summary: text(parsed.client_summary, 'Your nutrition targets are now set for the current training cycle.'),
  };
}

async function callInternalFunction(supabaseUrl: string, serviceKey: string, name: string, body: Record<string, unknown>) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`${name} failed:`, await res.text());
}

function numberInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

function activityTagFor(level: number): ActivityTag {
  if (level <= 1) return 'sedentary';
  if (level === 2) return 'lightly_active';
  if (level === 3) return 'moderately_active';
  if (level === 4) return 'very_active';
  return 'athlete_level';
}

function activityMultiplier(level: number): number {
  return [1.2, 1.375, 1.55, 1.725, 1.9][Math.max(1, Math.min(5, level)) - 1] ?? 1.55;
}

function ageFromDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const birth = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return age > 10 && age < 100 ? age : null;
}

function estimateBmr(weightKg: number, heightCm: number, age: number | null, gender: string | null): number {
  if (age && (gender === 'male' || gender === 'female')) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return Math.round(base + (gender === 'male' ? 5 : -161));
  }
  return Math.round(22 * weightKg);
}

function inferGoal(textValue: string): 'fat_loss' | 'muscle_gain' | 'strength' | 'recomposition' {
  if (/lose|loss|fat|cut|lean|weight down|drop/.test(textValue)) return 'fat_loss';
  if (/gain|muscle|hypertrophy|bulk|size/.test(textValue)) return 'muscle_gain';
  if (/strength|strong|1rm|power/.test(textValue)) return 'strength';
  return 'recomposition';
}

function applyGoalCalories(tdee: number, goal: string): number {
  if (goal === 'fat_loss') return Math.round(tdee * 0.85);
  if (goal === 'muscle_gain') return Math.round(tdee * 1.07);
  if (goal === 'strength') return Math.round(tdee * 1.03);
  return tdee;
}

function phaseTypeFrom(title: string, focus: string): string {
  const textValue = `${title} ${focus}`.toLowerCase();
  if (textValue.includes('foundation')) return 'foundation';
  if (textValue.includes('hypertrophy')) return 'hypertrophy';
  if (textValue.includes('deload')) return 'deload';
  if (textValue.includes('strength')) return 'strength';
  if (textValue.includes('test') || textValue.includes('1rm')) return 'testing';
  return 'general';
}

function adjustTargetsForPhase(base: DailyTargets, phaseType: string, goal: string): DailyTargets {
  let calories = base.calories;
  let carbs = base.carbs_g;
  if (phaseType === 'hypertrophy' && goal !== 'fat_loss') {
    calories += 120;
    carbs += 30;
  } else if (phaseType === 'strength' || phaseType === 'testing') {
    calories += 80;
    carbs += 20;
  } else if (phaseType === 'deload') {
    calories -= 80;
    carbs -= 20;
  }
  return normalizeTargets({ ...base, calories, carbs_g: carbs });
}

function draftStrategyForPhase(phaseType: string, goal: string): string {
  if (phaseType === 'foundation') return 'Build consistency first: hit protein, fibre, hydration, and simple repeatable meals.';
  if (phaseType === 'hypertrophy') return goal === 'fat_loss'
    ? 'Keep deficit conservative so training volume and recovery do not collapse.'
    : 'Support high training volume with enough carbs and a small calorie surplus when appropriate.';
  if (phaseType === 'strength') return 'Keep protein stable and bias carbs around lifting sessions to support performance.';
  if (phaseType === 'deload') return 'Keep protein stable, slightly reduce carbs only if appetite and training volume drop.';
  if (phaseType === 'testing') return 'Keep meals familiar and slightly higher-carb before testing sessions.';
  return 'Keep targets stable and adjust based on logs and weekly feedback.';
}

function normalizeTargets(targets: DailyTargets): DailyTargets {
  return {
    calories: clamp(Math.round(targets.calories), 1200, 5000),
    protein_g: clamp(Math.round(targets.protein_g), 60, 300),
    carbs_g: clamp(Math.round(targets.carbs_g), 50, 650),
    fat_g: clamp(Math.round(targets.fat_g), 35, 180),
    fibre_g: clamp(Math.round(targets.fibre_g), 20, 70),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compactClient(client: Record<string, unknown>) {
  return {
    id: client.id,
    name: client.name,
    goals: client.goals,
    coaching_focus: client.coaching_focus,
    event_goal: client.event_goal,
    gender: client.gender,
    date_of_birth: client.date_of_birth,
    height_cm: client.height_cm,
    current_weight_kg: client.current_weight_kg,
    activity_level: client.activity_level,
    activity_tag: client.activity_tag,
  };
}

function compactDoc(doc: Record<string, unknown> | null) {
  if (!doc) return null;
  const omit = new Set(['id', 'client_id', 'created_at', 'updated_at']);
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !omit.has(key)));
}

function parseJson(textValue: string): unknown | null {
  const match = textValue.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : fallback;
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}
