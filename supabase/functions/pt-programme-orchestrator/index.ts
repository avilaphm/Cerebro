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

const STEP_NAMES = ['CLIENT_ANALYSIS', 'METHODOLOGY_PLAN', 'PROGRAMME_SYNTHESIS', 'VALIDATION'] as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as {
      client_id: string;
      phase_weeks: { foundation: number; hypertrophy: number; strength: number };
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

    const callAgent = async (path: string, input: Record<string, unknown>): Promise<{ ok: boolean; output: Record<string, unknown>; error?: string }> => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
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
      return json({ ok: false, run_id: runId, error: reason }, 500);
    };

    // STEP 1: Client Analysis
    await admin.from('pt_program_generation_runs').update({ current_command: STEP_NAMES[0] }).eq('id', runId);
    const step1 = await callAgent('client-analysis-agent', { client_id: body.client_id, intake_text: body.intake_text });
    await recordStep(1, STEP_NAMES[0], { client_id: body.client_id }, step1.output, step1.ok ? 'succeeded' : 'failed', step1.error);
    if (!step1.ok) return fail(`Client analysis failed: ${step1.error}`);
    const clientAnalysis = step1.output.analysis as Record<string, unknown>;

    // STEP 2: Methodology Plan
    await admin.from('pt_program_generation_runs').update({ current_command: STEP_NAMES[1] }).eq('id', runId);
    const step2 = await callAgent('methodology-plan-agent', {
      client_analysis: clientAnalysis,
      phase_weeks: body.phase_weeks,
      run_id: runId,
    });
    await recordStep(2, STEP_NAMES[1], { phase_weeks: body.phase_weeks }, step2.output, step2.ok ? 'succeeded' : 'failed', step2.error);
    if (!step2.ok) return fail(`Methodology planning failed: ${step2.error}`);
    const methodologyPlan = step2.output.methodology_plan as Record<string, unknown>;

    // STEP 3: Programme Synthesis
    await admin.from('pt_program_generation_runs').update({ current_command: STEP_NAMES[2] }).eq('id', runId);
    const step3 = await callAgent('programme-synthesis-agent', {
      client_analysis: clientAnalysis,
      methodology_plan: methodologyPlan,
    });
    await recordStep(3, STEP_NAMES[2], {}, step3.output, step3.ok ? 'succeeded' : 'failed', step3.error);
    if (!step3.ok) return fail(`Programme synthesis failed: ${step3.error}`);
    const programmeName = step3.output.name as string;
    const programmeGoal = step3.output.goal as string;
    const programme = step3.output.programme as Record<string, unknown>;
    const missingExercises = (step3.output.missing_exercises as string[]) ?? [];

    // STEP 4: Validation
    await admin.from('pt_program_generation_runs').update({ current_command: STEP_NAMES[3] }).eq('id', runId);
    const emphasis = (clientAnalysis.emphasis ?? {}) as { needs_cardio_block?: boolean; needs_mobility_block?: boolean };
    const step4 = await callAgent('programme-validation-agent', { programme, emphasis });
    await recordStep(4, STEP_NAMES[3], {}, step4.output, step4.ok ? 'succeeded' : 'failed', step4.error);
    if (!step4.ok) return fail(`Validation failed: ${step4.error}`);
    const validation = step4.output as { passed: boolean; hard_failures: string[]; findings: string[] };

    // Final state
    const finalStatus = validation.passed ? 'needs_review' : 'needs_review';

    await admin.from('pt_program_generation_runs').update({
      status: finalStatus,
      current_command: null,
      programme_draft: programme,
      coaching_reasoning: { client_analysis: clientAnalysis, methodology_plan: methodologyPlan },
      validation_summary: {
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

    return json({
      ok: true,
      run_id: runId,
      name: programmeName,
      goal: programmeGoal,
      programme,
      client_analysis: clientAnalysis,
      methodology_plan: methodologyPlan,
      validation,
      missing_exercises: missingExercises,
    });
  } catch (error) {
    console.error('pt-programme-orchestrator error:', error);
    return json({ error: error instanceof Error ? error.message : 'Orchestration failed' }, 500);
  }
});
