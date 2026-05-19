import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json() as {
    client_id: string;
    step_label: string;
    step_type: 'phase' | 'test';
    milestone?: 'initial' | 'retest';
    phase_index: number | null;
    total_steps: number;
    programme_phases: string[];
    is_active: boolean;
    is_done: boolean;
  };

  const { client_id, step_label, step_type, milestone, phase_index, total_steps, programme_phases, is_active, is_done } = body;

  // --- Fetch client context ---
  const [clientRes, brainRes, exDocRes] = await Promise.all([
    supabase.from('pt_clients').select('name, goals').eq('id', client_id).single(),
    supabase.from('pt_client_brain').select('coaching_reasoning, important_decisions').eq('client_id', client_id).maybeSingle(),
    supabase.from('pt_client_exercise_doc').select('movement_assessment_summary, progression_strategy').eq('client_id', client_id).maybeSingle(),
  ]);

  const client = clientRes.data;
  const brain = brainRes.data;
  const exDoc = exDocRes.data;

  const clientName = client?.name?.split(' ')[0] ?? 'you';
  const goals = client?.goals ? `Client goals: ${client.goals}` : '';
  const coachingReasoning = brain?.coaching_reasoning && Object.keys(brain.coaching_reasoning).length > 0
    ? `Coaching reasoning: ${JSON.stringify(brain.coaching_reasoning)}`
    : '';
  const importantDecisions = brain?.important_decisions?.length > 0
    ? `Key coaching decisions: ${brain.important_decisions.join('. ')}`
    : '';
  const movementSummary = exDoc?.movement_assessment_summary && Object.keys(exDoc.movement_assessment_summary).length > 0
    ? `Movement assessment: ${JSON.stringify(exDoc.movement_assessment_summary)}`
    : '';
  const progressionStrategy = exDoc?.progression_strategy && Object.keys(exDoc.progression_strategy).length > 0
    ? `Progression strategy: ${JSON.stringify(exDoc.progression_strategy)}`
    : '';

  const contextSections = [goals, coachingReasoning, importantDecisions, movementSummary, progressionStrategy]
    .filter(Boolean).join('\n');

  const programmeStructure = programme_phases.length > 0
    ? `Programme structure: ${programme_phases.join(' → ')}`
    : '';

  const stepPosition = phase_index !== null
    ? `This is step ${(phase_index ?? 0) + 1} of ${total_steps} in the programme.`
    : '';

  const statusLine = is_done
    ? `${clientName} has completed this phase.`
    : is_active
      ? `${clientName} is currently in this phase.`
      : `${clientName} has not yet reached this phase.`;

  let stepContext = '';
  if (step_type === 'test') {
    stepContext = milestone === 'initial'
      ? `This is the 1RM Test phase — a strength benchmark performed after the foundation phase to establish maximum load before higher-intensity training begins.`
      : `This is the 1RM Re-test phase — a final strength assessment after completing the full training block to measure progress against the initial benchmark.`;
  } else {
    stepContext = `This is the "${step_label}" training phase.`;
  }

  const prompt = `You are Pedro Avila, a Sydney-based personal trainer writing a brief, warm, direct explanation for a client about where they are in their training journey.

CLIENT CONTEXT:
Name: ${clientName}
${contextSections || 'No detailed coaching notes on file yet.'}

PROGRAMME CONTEXT:
${programmeStructure}
${stepPosition}
${statusLine}
${stepContext}

Write a 2–3 paragraph explanation for ${clientName} that covers:
1. What this phase/step is and what it's designed to do physiologically and for their training
2. Why it matters — what it builds toward, what adaptation it creates, why the sequence makes sense
3. What they should feel or notice during/after this phase (or what achieving it means if it's done)

If you have specific coaching notes or decisions, weave them in naturally. If not, write based on sound PT programming education applied to where they are in the sequence.

Keep it personal, clear, and motivating. No bullet points. No headers. Write it as if you're speaking directly to ${clientName}. 2–3 short paragraphs max. First person ("you") addressing the client.`;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const explanation = (msg.content[0] as { text: string }).text.trim();

  return json({ explanation });
});
