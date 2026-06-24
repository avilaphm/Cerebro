import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];

const BIG_5_ALIASES: Record<string, string[]> = {
  'BB Squat': ['squat', 'bb squat', 'barbell squat', 'back squat'],
  'BB Deadlift': ['deadlift', 'bb deadlift', 'barbell deadlift', 'conventional deadlift'],
  'BB Bench Press': ['bench press', 'bb bench', 'barbell bench', 'chest press', 'bb chest press'],
  'BB Shoulder Press': ['shoulder press', 'overhead press', 'ohp', 'bb shoulder press', 'barbell shoulder press', 'military press'],
  'Pull-up': ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup'],
};

function matchExerciseName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [canonical, aliases] of Object.entries(BIG_5_ALIASES)) {
    if (aliases.some((alias) => lower.includes(alias))) return canonical;
  }
  return null;
}

function parsePct(pctStr: string): number | null {
  const cleaned = pctStr.replace('%', '').trim();
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0 || value > 200) return null;
  return value / 100;
}

function resolveKg(pctStr: string, oneRmKg: number): number | null {
  const pct = parsePct(pctStr);
  if (pct === null) return null;
  return Math.round(oneRmKg * pct * 4) / 4; // round to nearest 0.25kg
}

interface Exercise {
  id: string;
  name: string;
  weight_pct?: string;
  week_overrides?: Array<{
    block_index: number;
    weight_pct?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface Phase {
  id: string;
  title: string;
  week_blocks?: Array<{ weeks: number; weight_pct?: string; sets?: string }>;
  days: Array<{ id: string; title: string; exercises: Exercise[] }>;
  [key: string]: unknown;
}

interface Programme {
  phases: Phase[];
}

interface ResolvedLoad {
  exercise_name: string;
  canonical_exercise: string;
  phase_title: string;
  block_label: string;
  weight_pct: string;
  one_rm_kg: number;
  resolved_kg: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const adminClient = createClient(url, serviceKey);
    const tokenPayload = jwtPayload(authHeader.replace('Bearer ', ''));

    if (tokenPayload.role !== 'service_role') {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

      const requesterEmail = authData.user.email?.toLowerCase() ?? '';
      const { data: profile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (profile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
        return json({ error: 'Only Pedro can recalculate loads.' }, 403);
      }
    }

    const body = (await req.json()) as { client_id?: string; assignment_id?: string };
    const clientId = body.client_id;
    const assignmentId = body.assignment_id;

    if (!clientId || !assignmentId) return json({ error: 'Missing client_id or assignment_id.' }, 400);

    // Load the most recent 1RM result per exercise for this client
    const { data: resultRows, error: resultErr } = await adminClient
      .from('pt_client_1rm_results')
      .select('exercise_name, estimated_1rm_kg, tested_at:pt_client_1rm_tests(tested_at)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (resultErr) return json({ error: `Could not load 1RM results: ${resultErr.message}` }, 500);

    // Build map: canonical exercise -> highest estimated 1RM Pedro has recorded.
    const oneRmMap: Record<string, number> = {};
    for (const row of (resultRows ?? [])) {
      const r = row as { exercise_name: string; estimated_1rm_kg: number | null };
      if (!r.estimated_1rm_kg) continue;
      const canonical = matchExerciseName(r.exercise_name);
      if (!canonical) continue;
      oneRmMap[canonical] = Math.max(oneRmMap[canonical] ?? 0, r.estimated_1rm_kg);
    }

    if (Object.keys(oneRmMap).length === 0) {
      return json({ error: 'No 1RM results found for this client. Enter results first.' }, 400);
    }

    // Load the programme
    const { data: assignment, error: assignErr } = await adminClient
      .from('pt_program_assignments')
      .select('id, programme, name')
      .eq('id', assignmentId)
      .eq('client_id', clientId)
      .single();

    if (assignErr || !assignment) return json({ error: 'Programme not found.' }, 404);

    const programme = assignment.programme as Programme;
    if (!programme?.phases) return json({ error: 'Programme has no phases.' }, 400);

    const resolvedLoads: ResolvedLoad[] = [];
    const exerciseResolutionMap: Record<string, number[]> = {};

    for (const phase of programme.phases) {
      // Resolve phase-level week_blocks with weight_pct
      const phaseBlocks = Array.isArray(phase.week_blocks) ? phase.week_blocks : [];

      for (const day of (phase.days ?? [])) {
        for (const exercise of (day.exercises ?? [])) {
          const canonical = matchExerciseName(exercise.name);
          const oneRm = canonical ? oneRmMap[canonical] : null;
          if (!oneRm || !canonical) continue;

          // Phase-level blocks
          phaseBlocks.forEach((block, blockIdx) => {
            if (!block.weight_pct) return;
            const kg = resolveKg(block.weight_pct, oneRm);
            if (kg === null) return;
            resolvedLoads.push({
              exercise_name: exercise.name,
              canonical_exercise: canonical,
              phase_title: phase.title,
              block_label: `Block ${blockIdx + 1} (${block.weeks}w)`,
              weight_pct: block.weight_pct,
              one_rm_kg: oneRm,
              resolved_kg: kg,
            });
            if (!exerciseResolutionMap[canonical]) exerciseResolutionMap[canonical] = [];
            exerciseResolutionMap[canonical].push(kg);
          });

          // Exercise-level week_overrides
          (exercise.week_overrides ?? []).forEach((override) => {
            if (!override.weight_pct) return;
            const kg = resolveKg(String(override.weight_pct), oneRm);
            if (kg === null) return;
            resolvedLoads.push({
              exercise_name: exercise.name,
              canonical_exercise: canonical,
              phase_title: phase.title,
              block_label: `Override block ${override.block_index}`,
              weight_pct: String(override.weight_pct),
              one_rm_kg: oneRm,
              resolved_kg: kg,
            });
          });
        }
      }
    }

    // Build current_1rm structure for client brain doc
    const current1rm: Record<string, { value_kg: number; result_type: string; confidence: string; updated_at: string }> = {};
    for (const [exercise, oneRm] of Object.entries(oneRmMap)) {
      current1rm[exercise] = {
        value_kg: oneRm,
        result_type: 'estimated_1rm',
        confidence: 'high',
        updated_at: new Date().toISOString(),
      };
    }

    // Store resolved 1RM map in pt_client_exercise_doc
    await adminClient
      .from('pt_client_exercise_doc')
      .update({ current_1rm: current1rm, updated_at: new Date().toISOString() })
      .eq('client_id', clientId);

    // Store resolved loads on the assignment for later display
    await adminClient
      .from('pt_program_assignments')
      .update({
        validation_summary: {
          ...(typeof assignment.programme === 'object' ? {} : {}),
          resolved_loads: resolvedLoads,
          one_rm_map: oneRmMap,
          resolved_at: new Date().toISOString(),
        },
      })
      .eq('id', assignmentId);

    return json({
      ok: true,
      client_id: clientId,
      assignment_id: assignmentId,
      one_rm_map: oneRmMap,
      resolved_loads_count: resolvedLoads.length,
      resolved_loads: resolvedLoads,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Recalculation failed.' }, 500);
  }
});

function jwtPayload(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
