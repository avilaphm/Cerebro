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

const STEP_NAMES = ['CLIENT_ANALYSIS', 'METHODOLOGY_PLAN', 'VALIDATION'] as const;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as {
      client_id: string;
      phase_weeks: { foundation: number; hypertrophy: number; strength: number };
      days_per_week?: 3 | 4 | 5;
      intake_text?: string;
    };
    if (!body.client_id || !body.phase_weeks) return json({ error: 'client_id and phase_weeks required' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: clientRow } = await admin.from('pt_clients').select('id, goals').eq('id', body.client_id).maybeSingle();

    const { data: runRow, error: runError } = await admin
      .from('pt_program_generation_runs')
      .insert({
        client_id: body.client_id,
        task_type: 'full_program',
        client_goal: clientRow?.goals ?? null,
        status: 'running',
        current_command: STEP_NAMES[0],
      })
      .select('id')
      .single();
    if (runError || !runRow) return json({ error: `Failed to create run: ${runError?.message}` }, 500);
    const runId = runRow.id;

    // Run the 4-agent pipeline in the background; respond immediately so the wizard can poll.
    EdgeRuntime.waitUntil(runPipeline({ runId, body, admin, supabaseUrl, serviceKey }));

    return json({ ok: true, run_id: runId, status: 'running' });
  } catch (error) {
    console.error('pt-programme-orchestrator error:', error);
    return json({ error: error instanceof Error ? error.message : 'Orchestration failed' }, 500);
  }
});

async function runPipeline(ctx: {
  runId: string;
  body: { client_id: string; phase_weeks: { foundation: number; hypertrophy: number; strength: number }; days_per_week?: 3 | 4 | 5; intake_text?: string };
  admin: ReturnType<typeof createClient>;
  supabaseUrl: string;
  serviceKey: string;
}) {
  const { runId, body, admin, supabaseUrl, serviceKey } = ctx;
  try {

    const callAgent = async (path: string, input: Record<string, unknown>): Promise<{ ok: boolean; output: Record<string, unknown>; error?: string }> => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok || data.error) return { ok: false, output: data, error: data.error ?? `HTTP ${res.status}` };
        return { ok: true, output: data };
      } catch (e) {
        return { ok: false, output: {}, error: e instanceof Error ? e.message : String(e) };
      }
    };

    const recordStep = async (order: number, name: string, input: unknown, output: unknown, status: 'succeeded' | 'failed', failureReason?: string) => {
      await admin.from('pt_program_generation_steps').insert({
        run_id: runId,
        step_order: order,
        command_name: name,
        input_json: input as Record<string, unknown>,
        output_json: output as Record<string, unknown>,
        status,
        failure_reason: failureReason ?? null,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    };

    const fail = async (reason: string) => {
      await admin.from('pt_program_generation_runs').update({
        status: 'failed',
        failure_reason: reason,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
    };

    // STEP 1: Client Analysis
    await admin.from('pt_program_generation_runs').update({ current_command: STEP_NAMES[0] }).eq('id', runId);
    const step1 = await callAgent('client-analysis-agent', { client_id: body.client_id, intake_text: body.intake_text });
    await recordStep(1, STEP_NAMES[0], { client_id: body.client_id }, step1.output, step1.ok ? 'succeeded' : 'failed', step1.error);
    if (!step1.ok) { await fail(`Client analysis failed: ${step1.error}`); return; }
    const clientAnalysis = step1.output.analysis as Record<string, unknown>;

    // STEP 2: Methodology Plan
    await admin.from('pt_program_generation_runs').update({ current_command: STEP_NAMES[1] }).eq('id', runId);
    const step2 = await callAgent('methodology-plan-agent', {
      client_analysis: clientAnalysis,
      phase_weeks: body.phase_weeks,
      days_per_week: body.days_per_week ?? 3,
      run_id: runId,
    });
    await recordStep(2, STEP_NAMES[1], { phase_weeks: body.phase_weeks }, step2.output, step2.ok ? 'succeeded' : 'failed', step2.error);
    if (!step2.ok) { await fail(`Methodology planning failed: ${step2.error}`); return; }
    const methodologyPlan = step2.output.methodology_plan as Record<string, unknown>;

    // STEP 3: Programme Synthesis, one phase at a time to stay under edge runtime limits.
    const methodologyPhases = (methodologyPlan.phases ?? []) as Array<Record<string, unknown>>;
    if (methodologyPhases.length === 0) {
      await fail('Methodology plan returned no phases.');
      return;
    }

    const phases: Record<string, unknown>[] = [];
    let programmeName = '';
    let programmeGoal = '';
    const allMissing: string[] = [];

    for (let i = 0; i < methodologyPhases.length; i++) {
      const commandName = synthesisCommandName(methodologyPhases[i], i);
      await admin.from('pt_program_generation_runs').update({ current_command: commandName }).eq('id', runId);

      const step = await callAgent('programme-synthesis-agent', {
        client_analysis: clientAnalysis,
        methodology_plan_phase: methodologyPhases[i],
        phase_index: i,
        programme_name: programmeName,
        programme_goal: programmeGoal,
      });

      const stepOrder = 3 + i;
      await recordStep(
        stepOrder,
        commandName,
        { phase_index: i, methodology_plan_phase: methodologyPhases[i] },
        step.output,
        step.ok ? 'succeeded' : 'failed',
        step.error,
      );
      if (!step.ok) {
        await fail(`Programme synthesis failed at phase ${i + 1}: ${step.error}`);
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
    const missingExercises = Array.from(new Set(allMissing));

    // STEP 4: Validation
    await admin.from('pt_program_generation_runs').update({ current_command: STEP_NAMES[2] }).eq('id', runId);
    const emphasis = (clientAnalysis.emphasis ?? {}) as { needs_cardio_block?: boolean; needs_mobility_block?: boolean };
    const step4 = await callAgent('programme-validation-agent', { programme, emphasis });
    await recordStep(3 + methodologyPhases.length, STEP_NAMES[2], {}, step4.output, step4.ok ? 'succeeded' : 'failed', step4.error);
    if (!step4.ok) { await fail(`Validation failed: ${step4.error}`); return; }
    const validation = step4.output as { passed: boolean; hard_failures: string[]; findings: string[] };

    // Final state
    const finalStatus = validation.passed ? 'needs_review' : 'needs_review';

    await admin.from('pt_program_generation_runs').update({
      status: finalStatus,
      current_command: null,
      programme_draft: programme,
      coaching_reasoning: { client_analysis: clientAnalysis, methodology_plan: methodologyPlan },
      validation_summary: {
        name: programmeName,
        goal: programmeGoal,
        passed: validation.passed,
        hard_failures: validation.hard_failures,
        findings: validation.findings,
        missing_exercises: missingExercises,
      },
      completed_at: new Date().toISOString(),
    }).eq('id', runId);

    if (validation.hard_failures.length || validation.findings.length) {
      await admin.from('pt_program_review_outputs').insert({
        run_id: runId,
        client_id: body.client_id,
        review_type: 'system',
        status: validation.passed ? 'needs_review' : 'failed',
        hard_rule_failures: validation.hard_failures,
        findings: validation.findings,
      });
    }

  } catch (error) {
    console.error('pt-programme-orchestrator pipeline error:', error);
    await admin.from('pt_program_generation_runs').update({
      status: 'failed',
      failure_reason: error instanceof Error ? error.message : 'Pipeline crashed',
      completed_at: new Date().toISOString(),
    }).eq('id', runId);
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
