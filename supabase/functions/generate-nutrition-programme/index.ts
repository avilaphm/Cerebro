import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'];

type ActivityTag = 'sedentary' | 'light_active' | 'moderately_active' | 'active' | 'very_active' | 'extra_active';
type NutritionGoal = 'maintain' | 'weight_loss' | 'weight_gain';
type GoalSeverity = 'none' | 'mild' | 'moderate' | 'extreme';

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

interface ClientProfile {
  confirmed_age: number | null;
  confirmed_sex: 'male' | 'female' | null;
  nutrition_goal: NutritionGoal;
  goal_severity: GoalSeverity;
  reasoning: string;
  relevant_notes: string[];
}

interface DraftPlan {
  daily_targets: DailyTargets;
  protein_range_g: { min: number; max: number };
  phase_targets: PhaseTarget[];
  reasoning_steps: string[];
  assumptions: string[];
  nutrition_goal: NutritionGoal;
  goal_severity: GoalSeverity;
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
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY is required.' }, 500);

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
    if (!Number.isFinite(activityLevel) || activityLevel < 1 || activityLevel > 6) {
      return json({ error: 'activity_level must be 1-6.' }, 400);
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
        .limit(8),
    ]);

    if (clientRes.error || !clientRes.data) return json({ error: 'Client not found.' }, 404);

    const client = clientRes.data as Record<string, unknown>;
    const activityTag = activityTagFor(activityLevel);

    // Step 0: Read client profile and documents to determine nutrition goal
    // This runs before any calculation so the calorie target reflects the client's
    // actual body composition goal, not the PT programme type.
    let clientProfile: ClientProfile;
    try {
      clientProfile = await inferClientProfile({
        anthropicKey,
        client,
        nutritionDoc: nutritionDocRes.data as Record<string, unknown> | null,
        exerciseDoc: exerciseDocRes.data as Record<string, unknown> | null,
        lifestyleDoc: lifestyleDocRes.data as Record<string, unknown> | null,
        documents: (documentsRes.data ?? []) as Array<Record<string, unknown>>,
      });
    } catch {
      clientProfile = {
        confirmed_age: ageFromDate(client.date_of_birth),
        confirmed_sex: typeof client.gender === 'string' && (client.gender === 'male' || client.gender === 'female')
          ? client.gender
          : null,
        nutrition_goal: 'maintain',
        goal_severity: 'none',
        reasoning: 'Profile read failed. Defaulting to maintenance calories.',
        relevant_notes: [],
      };
    }

    // No active programme path
    if (assignmentRes.error || !assignmentRes.data) {
      const now = new Date().toISOString();
      const draft = buildBasicDraft({ client, clientProfile, heightCm, weightKg, activityLevel, activityTag });
      const existingEatingHabits = ((nutritionDocRes.data?.eating_habits as Record<string, unknown>) ?? {});
      await Promise.all([
        admin.from('pt_clients').update({
          height_cm: heightCm,
          current_weight_kg: weightKg,
          activity_level: activityLevel,
          activity_tag: activityTag,
          nutrition_onboarding_completed_at: now,
          updated_at: now,
        }).eq('id', clientId),
        admin.from('pt_client_metrics').insert({
          client_id: clientId,
          measured_at: now.slice(0, 10),
          weight_kg: weightKg,
          source: 'manual',
          notes: 'Nutrition onboarding weight.',
        }),
        admin.from('pt_client_nutrition_doc').upsert({
          client_id: clientId,
          daily_targets: draft.daily_targets,
          protein_range_g: draft.protein_range_g,
          goals_header: formatGoalsHeader(draft.daily_targets, draft.protein_range_g, draft.nutrition_goal, draft.goal_severity, activityTag, now),
          reasoning_steps: draft.reasoning_steps,
          phase_nutrition_strategy: {},
          eating_habits: {
            ...existingEatingHabits,
            body_profile: { height_cm: heightCm, weight_kg: weightKg, activity_level: activityLevel, activity_tag: activityTag, updated_at: now },
            nutrition_programme_summary: 'Basic targets set from biometrics. Phase targets will be generated once a training programme is assigned.',
          },
          updated_at: now,
        }, { onConflict: 'client_id' }),
      ]);
      return json({ ok: true, client_id: clientId, activity_tag: activityTag, client_profile: clientProfile, draft, no_programme: true });
    }

    const assignment = assignmentRes.data as Record<string, unknown>;
    const programme = (assignment.programme as { phases?: Array<Record<string, unknown>> } | null) ?? { phases: [] };
    const phases = Array.isArray(programme.phases) ? programme.phases : [];

    const draft = buildDraftPlan({
      client,
      clientProfile,
      assignment,
      phases,
      heightCm,
      weightKg,
      activityLevel,
      activityTag,
    });

    // Try AI-enhanced finalization; fall back to draft on any failure
    let finalPlan: FinalPlan;
    let pyramidMeta: { confidence_score: number; referenced_documents: Array<Record<string, unknown>> } = {
      confidence_score: 0,
      referenced_documents: [],
    };

    try {
      const pyramidContext = await retrievePyramidContext({
        supabaseUrl,
        serviceKey,
        clientGoal: String(client.goals ?? assignment.goal ?? ''),
      });

      if (pyramidContext.ok) {
        finalPlan = await finalizeWithPyramid({
          anthropicKey,
          client,
          clientProfile,
          assignment,
          draft,
          nutritionDoc: nutritionDocRes.data as Record<string, unknown> | null,
          exerciseDoc: exerciseDocRes.data as Record<string, unknown> | null,
          lifestyleDoc: lifestyleDocRes.data as Record<string, unknown> | null,
          documents: (documentsRes.data ?? []) as Array<Record<string, unknown>>,
          pyramidContext,
        });
        pyramidMeta = {
          confidence_score: pyramidContext.confidence_score,
          referenced_documents: pyramidContext.referenced_documents,
        };
      } else {
        console.warn('Pyramid retrieval failed, using draft:', pyramidContext.error);
        finalPlan = draftAsFinalPlan(draft);
      }
    } catch (aiError) {
      console.error('AI finalization failed, falling back to draft:', aiError);
      finalPlan = draftAsFinalPlan(draft);
    }

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

    const pyramidStep = pyramidMeta.referenced_documents.length > 0
      ? `Step 9 - Pyramid Review: Helms Nutrition Pyramid applied. ${finalPlan.pyramid_principles_applied.slice(0, 2).join('; ')}`
      : 'Step 9 - Pyramid Review: Draft used directly (Pyramid retrieval unavailable).';
    const reasoningSteps = [...draft.reasoning_steps, pyramidStep];

    const finalizerAudit = {
      source_document: pyramidMeta.referenced_documents.length > 0
        ? 'The Muscle and Strength Pyramid - Nutrition v2.0 .pdf.pdf'
        : 'draft_calculation',
      retrieved_documents: pyramidMeta.referenced_documents,
      confidence_score: pyramidMeta.confidence_score,
      principles_applied: finalPlan.pyramid_principles_applied,
      changes_from_draft: finalPlan.changes_from_draft,
      client_goal_alignment: finalPlan.client_goal_alignment,
      coach_notes: finalPlan.coach_notes,
      client_summary: finalPlan.client_summary,
      client_profile: clientProfile,
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
          protein_range_g: draft.protein_range_g,
          goals_header: formatGoalsHeader(finalPlan.final_daily_targets, draft.protein_range_g, draft.nutrition_goal, draft.goal_severity, activityTag, now),
          reasoning_steps: reasoningSteps,
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
        content: `Nutrition onboarding completed. Height ${heightCm}cm, weight ${weightKg}kg, activity level ${activityLevel}/6 (${activityTag}). Nutrition goal: ${draft.nutrition_goal} (${draft.goal_severity}). Final targets: ${finalPlan.final_daily_targets.calories} kcal, ${finalPlan.final_daily_targets.protein_g}g protein.`,
        structured_data: {
          nutrition_priorities: {
            body_profile: bodyProfile,
            client_profile: clientProfile,
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
      client_profile: clientProfile,
      draft,
      final_plan: finalPlan,
      pyramid_context: pyramidMeta,
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

// Reads client documents and determines the real nutrition goal.
// The body composition goal (lose/maintain/gain) is separate from the PT programme type.
async function inferClientProfile(input: {
  anthropicKey: string;
  client: Record<string, unknown>;
  nutritionDoc: Record<string, unknown> | null;
  exerciseDoc: Record<string, unknown> | null;
  lifestyleDoc: Record<string, unknown> | null;
  documents: Array<Record<string, unknown>>;
}): Promise<ClientProfile> {
  const fallbackAge = ageFromDate(input.client.date_of_birth);
  const fallbackSex = typeof input.client.gender === 'string' &&
    (input.client.gender === 'male' || input.client.gender === 'female')
    ? input.client.gender as 'male' | 'female'
    : null;

  const documentTexts = input.documents
    .map((doc) => `[${doc.title ?? 'Document'}]: ${String(doc.content_text ?? '').slice(0, 1200)}`)
    .join('\n\n');

  const clientContext = JSON.stringify({
    goals: input.client.goals,
    coaching_focus: input.client.coaching_focus,
    event_goal: input.client.event_goal,
    notes: input.client.notes,
    gender: input.client.gender,
    date_of_birth: input.client.date_of_birth,
    nutrition_habits: (input.nutritionDoc?.eating_habits as Record<string, unknown> | null) ?? null,
    lifestyle: input.lifestyleDoc ? compactDoc(input.lifestyleDoc) : null,
  });

  const anthropic = new Anthropic({ apiKey: input.anthropicKey });
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: `You are reading a PT client profile to determine their body composition goal for nutrition planning.
Return only valid JSON. No markdown, no explanation.

Determine:
1. confirmed_age: from date_of_birth field OR any mention of age in documents. Return number or null.
2. confirmed_sex: "male" or "female" from gender field OR documents. Return null if unknown.
3. nutrition_goal: what the client wants to do with their body.
   - "weight_loss" if they mention losing fat, losing weight, cutting, leaning out, getting smaller
   - "weight_gain" if they mention gaining muscle, bulking, adding size, gaining weight
   - "maintain" if they want to stay the same, maintain weight, or have no body comp goal stated
   Default to "maintain" when unclear.
4. goal_severity: for weight_loss/weight_gain only:
   - "mild": gradual, slow, small amount, first time dieting
   - "moderate": clear intent, standard pace
   - "extreme": aggressive, fast, large amount, medical reason, event deadline
   Return "none" for maintain.
5. reasoning: one sentence quoting the exact phrase from goals/documents that drove this decision.
6. relevant_notes: array of strings for dietary restrictions or medical conditions that affect nutrition.

Output schema:
{"confirmed_age":number|null,"confirmed_sex":"male"|"female"|null,"nutrition_goal":"maintain"|"weight_loss"|"weight_gain","goal_severity":"none"|"mild"|"moderate"|"extreme","reasoning":"string","relevant_notes":["string"]}`,
    messages: [{
      role: 'user',
      content: `CLIENT PROFILE:\n${clientContext}\n\nUPLOADED DOCUMENTS:\n${documentTexts || 'None'}`,
    }],
  });

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const parsed = parseJson(raw) as Partial<ClientProfile> | null;

  if (!parsed) {
    return {
      confirmed_age: fallbackAge,
      confirmed_sex: fallbackSex,
      nutrition_goal: 'maintain',
      goal_severity: 'none',
      reasoning: 'Could not parse AI response. Using maintenance calories as safe default.',
      relevant_notes: [],
    };
  }

  return {
    confirmed_age: typeof parsed.confirmed_age === 'number' ? parsed.confirmed_age : fallbackAge,
    confirmed_sex: parsed.confirmed_sex === 'male' || parsed.confirmed_sex === 'female'
      ? parsed.confirmed_sex
      : fallbackSex,
    nutrition_goal: (['maintain', 'weight_loss', 'weight_gain'] as const).includes(parsed.nutrition_goal as NutritionGoal)
      ? parsed.nutrition_goal as NutritionGoal
      : 'maintain',
    goal_severity: (['none', 'mild', 'moderate', 'extreme'] as const).includes(parsed.goal_severity as GoalSeverity)
      ? parsed.goal_severity as GoalSeverity
      : 'none',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Goal inferred from client profile.',
    relevant_notes: Array.isArray(parsed.relevant_notes)
      ? parsed.relevant_notes.filter((n): n is string => typeof n === 'string').slice(0, 6)
      : [],
  };
}

function buildDraftPlan(input: {
  client: Record<string, unknown>;
  clientProfile: ClientProfile;
  assignment: Record<string, unknown>;
  phases: Array<Record<string, unknown>>;
  heightCm: number;
  weightKg: number;
  activityLevel: number;
  activityTag: ActivityTag;
}): DraftPlan {
  const { confirmed_age, confirmed_sex, nutrition_goal, goal_severity, reasoning } = input.clientProfile;
  const bmr = estimateBmr(input.weightKg, input.heightCm, confirmed_age, confirmed_sex);
  const pal = activityMultiplier(input.activityLevel);
  const tdee = Math.round(bmr * pal);
  const calories = applyGoalCalories(tdee, nutrition_goal, goal_severity);
  const { protein_g, protein_range_g, fat_g, carbs_g, fibre_g } = computeMacros(input.weightKg, calories, nutrition_goal);
  const dailyTargets = normalizeTargets({ calories, protein_g, carbs_g, fat_g, fibre_g });

  const bmrMethod = confirmed_age && confirmed_sex
    ? `Mifflin-St Jeor (${confirmed_sex})`
    : 'conservative estimate (22 x weight)';
  const goalLabel = goalDisplayLabel(nutrition_goal, goal_severity);

  const reasoningSteps = [
    `Step 1 - Client Profile: Age ${confirmed_age ?? 'unknown'}, Sex ${confirmed_sex ?? 'unknown'}. Source: ${confirmed_age ? 'date_of_birth / documents' : 'not found'}.`,
    `Step 2 - Nutrition Goal: ${goalLabel}. Reasoning: ${reasoning}`,
    `Step 3 - BMR: ${bmrMethod}. BMR = ${bmr} kcal`,
    `Step 4 - TDEE: Activity level ${input.activityLevel}/6 (${activityTagLabel(input.activityTag)}, PAL ${pal}). TDEE = ${tdee} kcal`,
    `Step 5 - Calorie Target: ${goalLabel} (x${goalMultiplier(nutrition_goal, goal_severity)}). Target = ${dailyTargets.calories} kcal`,
    `Step 6 - Protein: ${input.weightKg}kg x ${nutrition_goal === 'weight_loss' ? '2.0' : '1.8'}g/kg = ${protein_g}g. Range: ${protein_range_g.min}g-${protein_range_g.max}g`,
    `Step 7 - Fat: ${input.weightKg}kg x 0.9g/kg = ${fat_g}g`,
    `Step 8 - Carbs: (${dailyTargets.calories} - ${protein_g * 4} - ${fat_g * 9}) / 4 = ${carbs_g}g${carbs_g === 100 ? ' (100g floor applied)' : ''}`,
  ];

  return {
    daily_targets: dailyTargets,
    protein_range_g,
    phase_targets: input.phases.map((phase, index) => {
      const title = String(phase.title ?? `Phase ${index + 1}`);
      const phaseType = phaseTypeFrom(title, String(phase.focus ?? ''));
      const weeks = parseInt(String(phase.weeks ?? '1'), 10) || 1;
      const adjusted = adjustTargetsForPhase(dailyTargets, phaseType, nutrition_goal);
      return {
        phase_index: index,
        phase_title: title,
        phase_type: phaseType,
        weeks,
        targets: adjusted,
        strategy: draftStrategyForPhase(phaseType, nutrition_goal),
      };
    }),
    reasoning_steps: reasoningSteps,
    assumptions: [
      confirmed_age && confirmed_sex
        ? `BMR calculated with Mifflin-St Jeor (${confirmed_sex}, age ${confirmed_age}).`
        : 'BMR estimated from body weight only (age or sex unavailable).',
      `Protein range: ${protein_range_g.min}g-${protein_range_g.max}g (1.5-2g/kg). Target: ${protein_g}g.`,
      `Activity level ${input.activityLevel}/6 (${activityTagLabel(input.activityTag)}, PAL ${pal}). TDEE: ${tdee} kcal.`,
      `Nutrition goal: ${goalLabel}. Calorie target: ${dailyTargets.calories} kcal.`,
    ],
    nutrition_goal,
    goal_severity,
    goal_interpretation: goalLabel,
    activity_tag: input.activityTag,
    estimated_tdee: tdee,
  };
}

function buildBasicDraft(input: {
  client: Record<string, unknown>;
  clientProfile: ClientProfile;
  heightCm: number;
  weightKg: number;
  activityLevel: number;
  activityTag: ActivityTag;
}): DraftPlan {
  const { confirmed_age, confirmed_sex, nutrition_goal, goal_severity, reasoning } = input.clientProfile;
  const bmr = estimateBmr(input.weightKg, input.heightCm, confirmed_age, confirmed_sex);
  const pal = activityMultiplier(input.activityLevel);
  const tdee = Math.round(bmr * pal);
  const calories = applyGoalCalories(tdee, nutrition_goal, goal_severity);
  const { protein_g, protein_range_g, fat_g, carbs_g, fibre_g } = computeMacros(input.weightKg, calories, nutrition_goal);
  const dailyTargets = normalizeTargets({ calories, protein_g, carbs_g, fat_g, fibre_g });
  const goalLabel = goalDisplayLabel(nutrition_goal, goal_severity);

  return {
    daily_targets: dailyTargets,
    protein_range_g,
    phase_targets: [],
    reasoning_steps: [
      `Step 1 - Client Profile: Age ${confirmed_age ?? 'unknown'}, Sex ${confirmed_sex ?? 'unknown'}.`,
      `Step 2 - Nutrition Goal: ${goalLabel}. ${reasoning}`,
      `Step 3 - BMR: ${bmr} kcal`,
      `Step 4 - TDEE: PAL ${pal} (${activityTagLabel(input.activityTag)}). TDEE = ${tdee} kcal`,
      `Step 5 - Calorie Target: ${goalLabel} (x${goalMultiplier(nutrition_goal, goal_severity)}). Target = ${dailyTargets.calories} kcal`,
      `Step 6 - Protein: ${protein_g}g. Range: ${protein_range_g.min}g-${protein_range_g.max}g`,
      `Step 7 - Fat: ${fat_g}g`,
      `Step 8 - Carbs: ${carbs_g}g`,
      'Step 9 - No active programme. Basic targets only.',
    ],
    assumptions: [
      'No active programme - basic daily targets from biometrics.',
      `Nutrition goal: ${goalLabel}. Calorie target: ${dailyTargets.calories} kcal.`,
    ],
    nutrition_goal,
    goal_severity,
    goal_interpretation: goalLabel,
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
    return { ok: false, error: 'Nutrition Pyramid retrieval returned no usable excerpts.' };
  }
  const confidence = Number(data.confidence_score ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0.45) {
    return { ok: false, error: 'Nutrition Pyramid retrieval confidence was too low.' };
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
  clientProfile: ClientProfile;
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
Apply the Pyramid hierarchy: calories -> macros -> micronutrients/fibre -> timing -> supplements.
Do not invent medical advice. Keep changes conservative and practical for an active PT client.

The client's nutrition goal and calorie target have already been correctly set based on their documents.
Your job is to validate and refine the draft, not to override the goal.

HARD RULES - never override these:
1. Protein must stay within 1.5-2g per kg body weight. Do NOT reduce protein.
2. Carbs must never go below 100g per day in any target or phase - even for fat loss.
3. Fat must never go below 50g per day.
4. Protein is the same regardless of goal - only calories and carbs shift between goals.
5. The calorie target reflects the client's stated body composition goal. Do not second-guess it.

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
        client_profile: input.clientProfile,
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
          excerpt: String(doc.content_text ?? '').slice(0, 1500),
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
    client_goal_alignment: text(parsed.client_goal_alignment, 'Final targets aligned to client goal and training cycle.'),
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

function draftAsFinalPlan(draft: DraftPlan): FinalPlan {
  return {
    final_daily_targets: draft.daily_targets,
    phase_targets: draft.phase_targets,
    pyramid_principles_applied: [],
    client_goal_alignment: `Goal: ${draft.goal_interpretation}.`,
    changes_from_draft: [],
    coach_notes: '',
    client_summary: 'Your nutrition targets have been calculated based on your body metrics and goals.',
  };
}

function numberInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

function activityTagFor(level: number): ActivityTag {
  const tags: ActivityTag[] = ['sedentary', 'light_active', 'moderately_active', 'active', 'very_active', 'extra_active'];
  return tags[Math.max(1, Math.min(6, level)) - 1] ?? 'moderately_active';
}

function activityTagLabel(tag: ActivityTag): string {
  const labels: Record<ActivityTag, string> = {
    sedentary: 'Sedentary',
    light_active: 'Light (1-3 days/week)',
    moderately_active: 'Moderate (3-5 days/week)',
    active: 'Active (6-7 days/week)',
    very_active: 'Very Active (hard exercise daily)',
    extra_active: 'Extra Active (physical job / twice-daily)',
  };
  return labels[tag] ?? tag;
}

function activityMultiplier(level: number): number {
  return [1.2, 1.375, 1.55, 1.725, 1.9, 2.2][Math.max(1, Math.min(6, level)) - 1] ?? 1.55;
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

function estimateBmr(weightKg: number, heightCm: number, age: number | null, sex: 'male' | 'female' | null): number {
  if (age && (sex === 'male' || sex === 'female')) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return Math.round(base + (sex === 'male' ? 5 : -161));
  }
  return Math.round(22 * weightKg);
}

function applyGoalCalories(tdee: number, goal: NutritionGoal, severity: GoalSeverity): number {
  return Math.round(tdee * goalMultiplier(goal, severity));
}

function goalMultiplier(goal: NutritionGoal, severity: GoalSeverity): number {
  if (goal === 'weight_loss') {
    if (severity === 'mild') return 0.9;
    if (severity === 'moderate') return 0.8;
    if (severity === 'extreme') return 0.6;
    return 0.9;
  }
  if (goal === 'weight_gain') {
    if (severity === 'mild') return 1.1;
    if (severity === 'moderate') return 1.2;
    if (severity === 'extreme') return 1.4;
    return 1.1;
  }
  return 1.0; // maintain
}

function goalDisplayLabel(goal: NutritionGoal, severity: GoalSeverity): string {
  if (goal === 'weight_loss') return `${severity === 'mild' ? 'Mild' : severity === 'moderate' ? 'Moderate' : 'Extreme'} Weight Loss`;
  if (goal === 'weight_gain') return `${severity === 'mild' ? 'Mild' : severity === 'moderate' ? 'Moderate' : 'Extreme'} Weight Gain`;
  return 'Maintain Weight';
}

function phaseTypeFrom(title: string, focus: string): string {
  const t = `${title} ${focus}`.toLowerCase();
  if (t.includes('foundation')) return 'foundation';
  if (t.includes('hypertrophy')) return 'hypertrophy';
  if (t.includes('deload')) return 'deload';
  if (t.includes('strength')) return 'strength';
  if (t.includes('test') || t.includes('1rm')) return 'testing';
  return 'general';
}

function computeMacros(
  weightKg: number,
  calories: number,
  goal: NutritionGoal,
): { protein_g: number; protein_range_g: { min: number; max: number }; fat_g: number; carbs_g: number; fibre_g: number } {
  const proteinMin = Math.round(weightKg * 1.5);
  const proteinMax = Math.round(weightKg * 2.0);
  const proteinTarget = clamp(Math.round(weightKg * (goal === 'weight_loss' ? 2.0 : 1.8)), proteinMin, proteinMax);
  const fatG = clamp(Math.round(weightKg * 0.9), 50, 120);
  const remainingCalories = Math.max(0, calories - proteinTarget * 4 - fatG * 9);
  const carbsG = Math.max(100, Math.round(remainingCalories / 4));
  const fibreG = clamp(Math.max(25, Math.round((calories / 1000) * 14)), 20, 70);
  return { protein_g: proteinTarget, protein_range_g: { min: proteinMin, max: proteinMax }, fat_g: fatG, carbs_g: carbsG, fibre_g: fibreG };
}

function adjustTargetsForPhase(base: DailyTargets, phaseType: string, goal: NutritionGoal): DailyTargets {
  let calories = base.calories;
  let carbs = base.carbs_g;
  if (phaseType === 'hypertrophy' && goal !== 'weight_loss') { calories += 120; carbs += 30; }
  else if (phaseType === 'strength' || phaseType === 'testing') { calories += 80; carbs += 20; }
  else if (phaseType === 'deload') { calories -= 80; carbs -= 20; }
  carbs = Math.max(100, carbs);
  return normalizeTargets({ ...base, calories, carbs_g: carbs });
}

function formatGoalsHeader(
  targets: DailyTargets,
  proteinRange: { min: number; max: number },
  goal: NutritionGoal,
  severity: GoalSeverity,
  activityTag: ActivityTag,
  isoDate: string,
): string {
  const date = new Date(isoDate);
  const dateStr = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const activityLabel: Record<ActivityTag, string> = {
    sedentary: 'Sedentary',
    light_active: 'Light',
    moderately_active: 'Moderate',
    active: 'Active',
    very_active: 'Very Active',
    extra_active: 'Extra Active',
  };
  return [
    `NUTRITION GOALS - ${dateStr}`,
    `Goal: ${goalDisplayLabel(goal, severity)}  |  Activity: ${activityLabel[activityTag] ?? activityTag}`,
    '------------------------------------------',
    `Calories:  ${targets.calories.toLocaleString('en-AU')} kcal`,
    `Protein:   ${proteinRange.min}g - ${proteinRange.max}g  (1.5-2g per kg body weight)`,
    `Carbs:     ${targets.carbs_g}g`,
    `Fat:       ${targets.fat_g}g`,
    `Fibre:     ${targets.fibre_g}g`,
    '------------------------------------------',
  ].join('\n');
}

function draftStrategyForPhase(phaseType: string, goal: NutritionGoal): string {
  if (phaseType === 'foundation') return 'Build consistency first: hit protein, fibre, hydration, and simple repeatable meals.';
  if (phaseType === 'hypertrophy') return goal === 'weight_loss'
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
    carbs_g: clamp(Math.round(targets.carbs_g), 100, 650),
    fat_g: clamp(Math.round(targets.fat_g), 50, 180),
    fibre_g: clamp(Math.round(targets.fibre_g), 20, 70),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compactClient(client: Record<string, unknown>) {
  return {
    id: client.id, name: client.name, goals: client.goals, coaching_focus: client.coaching_focus,
    event_goal: client.event_goal, gender: client.gender, date_of_birth: client.date_of_birth,
    height_cm: client.height_cm, current_weight_kg: client.current_weight_kg,
    activity_level: client.activity_level, activity_tag: client.activity_tag,
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
  try { return JSON.parse(match[0]); } catch { return null; }
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : fallback;
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
