import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];
const DEFAULT_MATCH_COUNT = 12;
const DEFAULT_MATCH_THRESHOLD = 0.28;
const LOW_CONFIDENCE_THRESHOLD = 0.55;

interface RetrievalRequest {
  taskType?: string;
  task_type?: string;
  phaseType?: string | null;
  phase_type?: string | null;
  clientGoal?: string | null;
  client_goal?: string | null;
  questionOrDecision?: string;
  question_or_decision?: string;
  runId?: string | null;
  run_id?: string | null;
  stepId?: string | null;
  step_id?: string | null;
  matchCount?: number;
  match_count?: number;
  matchThreshold?: number;
  match_threshold?: number;
}

interface KnowledgeChunk {
  document_title: string;
  chunk_text: string;
  similarity: number;
}

interface RelevantExcerpt {
  document_title: string;
  chunk_text: string;
  similarity: number;
  priority_rank: number;
  excerpt_index: number;
}

interface ReferencedDocument {
  title: string;
  excerpt_count: number;
  best_similarity: number;
  priority_rank: number;
}

interface AppliedRule {
  rule: string;
  source: string;
}

const DOCUMENT_PRIORITY = [
  {
    rank: 1,
    label: 'Cerebro Programming Architecture',
    patterns: [
      'cerebro master system prompt',
      'cerebro client analysis',
      'program generation system',
      'cerebro programming',
      'programming system',
    ],
  },
  { rank: 2, label: 'Pedro Coaching Philosophy', patterns: ['pedro', 'coaching', 'voice note', 'matt duncan'] },
  { rank: 3, label: 'Eric Helms Training Pyramid', patterns: ['muscle and strength pyramid training', 'helms training'] },
  { rank: 4, label: 'Eric Helms Nutrition Pyramid', patterns: ['muscle and strength pyramid nutrition', 'helms nutrition'] },
  { rank: 5, label: 'ACSM', patterns: ['acsm', 'exercise physiology', 'chronic disease'] },
  { rank: 6, label: 'Musculoskeletal Research', patterns: ['musculoskeletal', 'rotator cuff', 'shoulder instability'] },
  { rank: 7, label: 'Precision Nutrition', patterns: ['precision nutrition', 'pn certification', 'nutrition big picture'] },
  { rank: 8, label: 'Pedro Writing Voice', patterns: ['writing voice', 'pedro writing'] },
];

const BASE_PROGRAMMING_RULES: AppliedRule[] = [
  { rule: 'Movement quality comes before load.', source: 'Cerebro Programming Architecture' },
  { rule: 'Tempo and full range of motion come before intensity.', source: 'Cerebro Programming Architecture' },
  { rule: 'Progression must be sustainable and coach-reviewable.', source: 'Cerebro Programming Architecture' },
  { rule: 'Nutrition must be synced to the generated training phase, not generated in isolation.', source: 'Cerebro Programming Architecture' },
  { rule: 'Low retrieval confidence must be flagged for coach review.', source: 'Cerebro Programming Architecture' },
];

const TASK_RULES: Record<string, AppliedRule[]> = {
  foundations: [
    { rule: 'Phase 1 should bias slow tempo, motor control, and movement quality.', source: 'Cerebro Programming Architecture' },
    { rule: 'Weeks 1-2 use 2 sets; weeks 3-4 use 3 sets; weeks 5-7 introduce key compounds when appropriate.', source: 'Cerebro Programming Architecture' },
  ],
  hypertrophy: [
    { rule: 'Hypertrophy work should generally use 65-75% 1RM, 8-15 reps, and 3-5 sets.', source: 'Cerebro Programming Architecture' },
  ],
  strength: [
    { rule: 'Strength work should generally use 75-90% 1RM, 3-8 reps, and 4-6 sets.', source: 'Cerebro Programming Architecture' },
  ],
  nutrition: [
    { rule: 'Use the least restrictive nutrition strategy that supports the phase goal.', source: 'Cerebro Programming Architecture' },
    { rule: 'Nutrition recommendations must reflect training volume, intensity, recovery demand, stress, and adherence level.', source: 'Cerebro Programming Architecture' },
  ],
  warmup: [
    { rule: 'Every workout warm-up has exactly 4 exercises, 1 set each, 10-12 reps each.', source: 'Cerebro Programming Architecture' },
  ],
  testing: [
    { rule: 'The 1RM testing session includes squat, deadlift, bench press, shoulder press, and pull-up only.', source: 'Cerebro Programming Architecture' },
  ],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

    const adminClient = createClient(supabaseUrl, serviceKey);
    const auth = await authorizeRequest(supabaseUrl, anonKey, authHeader, adminClient);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const rawBody = (await req.json()) as RetrievalRequest;
    const input = normalizeInput(rawBody);
    if ('error' in input) return json({ error: input.error }, 400);

    const query = buildRetrievalQuery(input);
    const embedding = await embedQuery(query, openaiKey);
    if (!embedding) return json({ error: 'Could not create retrieval embedding.' }, 502);

    const { data, error } = await adminClient.rpc('match_knowledge_chunks', {
      query_embedding: embedding,
      match_count: input.matchCount,
      match_threshold: input.matchThreshold,
    });

    if (error) return json({ error: error.message }, 500);

    const vectorChunks = ((data ?? []) as KnowledgeChunk[]).filter((chunk) => chunk.chunk_text?.trim());
    const architectureChunks = await loadArchitectureChunks(adminClient, input);
    const rawChunks = mergeChunks(architectureChunks, vectorChunks);
    const excerpts = rankExcerpts(rawChunks).slice(0, input.matchCount);
    const referencedDocuments = buildReferencedDocuments(excerpts);
    const appliedRules = buildAppliedRules(input, excerpts);
    const confidenceScore = calculateConfidence(excerpts, referencedDocuments);
    const lowConfidence = confidenceScore < LOW_CONFIDENCE_THRESHOLD || excerpts.length < 3;

    const logPayload = {
      run_id: input.runId,
      step_id: input.stepId,
      task_type: input.taskType,
      phase_type: input.phaseType,
      client_goal: input.clientGoal,
      question_or_decision: input.questionOrDecision,
      excerpts: excerpts,
      applied_rules: appliedRules,
      referenced_documents: referencedDocuments,
      confidence_score: confidenceScore,
      low_confidence: lowConfidence,
    };

    const { data: logRow, error: logError } = await adminClient
      .from('pt_knowledge_retrieval_logs')
      .insert(logPayload)
      .select('id')
      .single();

    if (logError) return json({ error: `Retrieval succeeded but logging failed: ${logError.message}` }, 500);

    return json({
      ok: true,
      command_name: 'RETRIEVE_KNOWLEDGE_CONTEXT',
      log_id: logRow?.id ?? null,
      input: {
        task_type: input.taskType,
        phase_type: input.phaseType,
        client_goal: input.clientGoal,
        question_or_decision: input.questionOrDecision,
      },
      relevant_excerpts: excerpts,
      applied_rules: appliedRules,
      referenced_documents: referencedDocuments,
      confidence_score: confidenceScore,
      low_confidence: lowConfidence,
      warnings: lowConfidence
        ? ['Low retrieval confidence. Coach review is required before using this context for generation.']
        : [],
    });
  } catch (error) {
    console.error('retrieve-knowledge-context error:', error);
    return json({ error: error instanceof Error ? error.message : 'Retrieval failed.' }, 500);
  }
});

async function authorizeRequest(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const token = authHeader.replace('Bearer ', '');
  const payload = jwtPayload(token);
  if (payload.role === 'service_role') return { ok: true };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return { ok: false, error: 'Unauthorized.', status: 401 };

  const requesterEmail = authData.user.email?.toLowerCase() ?? '';
  const { data: requesterProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (requesterProfile?.role === 'admin' || PEDRO_EMAILS.includes(requesterEmail)) return { ok: true };
  return { ok: false, error: 'Only Pedro/admin users can retrieve PT programming context.', status: 403 };
}

function jwtPayload(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function normalizeInput(body: RetrievalRequest):
  | {
      taskType: string;
      phaseType: string | null;
      clientGoal: string | null;
      questionOrDecision: string;
      runId: string | null;
      stepId: string | null;
      matchCount: number;
      matchThreshold: number;
    }
  | { error: string } {
  const taskType = (body.taskType ?? body.task_type ?? '').trim();
  const questionOrDecision = (body.questionOrDecision ?? body.question_or_decision ?? '').trim();
  if (!taskType) return { error: 'Missing taskType.' };
  if (!questionOrDecision) return { error: 'Missing questionOrDecision.' };

  const matchCount = clampNumber(body.matchCount ?? body.match_count ?? DEFAULT_MATCH_COUNT, 3, 20);
  const matchThreshold = clampNumber(body.matchThreshold ?? body.match_threshold ?? DEFAULT_MATCH_THRESHOLD, 0.1, 0.8);

  return {
    taskType,
    phaseType: cleanOptional(body.phaseType ?? body.phase_type),
    clientGoal: cleanOptional(body.clientGoal ?? body.client_goal),
    questionOrDecision,
    runId: cleanOptional(body.runId ?? body.run_id),
    stepId: cleanOptional(body.stepId ?? body.step_id),
    matchCount,
    matchThreshold,
  };
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function buildRetrievalQuery(input: {
  taskType: string;
  phaseType: string | null;
  clientGoal: string | null;
  questionOrDecision: string;
}): string {
  const priorityHint = [
    'Cerebro Programming Architecture',
    'Pedro coaching philosophy',
    'Eric Helms training pyramid',
    'Eric Helms nutrition pyramid',
    'ACSM',
    'musculoskeletal research',
    'Precision Nutrition',
  ].join(', ');

  return [
    `Task type: ${input.taskType}`,
    input.phaseType ? `Phase type: ${input.phaseType}` : '',
    input.clientGoal ? `Client goal: ${input.clientGoal}` : '',
    `Decision needed: ${input.questionOrDecision}`,
    `Priority sources: ${priorityHint}`,
  ].filter(Boolean).join('\n');
}

async function loadArchitectureChunks(
  adminClient: ReturnType<typeof createClient>,
  input: { taskType: string; phaseType: string | null; clientGoal: string | null; questionOrDecision: string },
): Promise<KnowledgeChunk[]> {
  const { data } = await adminClient
    .from('pt_knowledge_documents')
    .select('title, content_text')
    .or('source.eq.cerebro_architecture,title.ilike.%CEREBRO MASTER SYSTEM PROMPT%,title.ilike.%CEREBRO CLIENT ANALYSIS%')
    .limit(4);

  const docs = ((data ?? []) as Array<{ title: string; content_text: string | null }>)
    .filter((doc) => doc.content_text?.trim());

  const queryTerms = importantTerms([
    input.taskType,
    input.phaseType ?? '',
    input.clientGoal ?? '',
    input.questionOrDecision,
  ].join(' '));

  return docs
    .flatMap((doc) => {
      const sections = splitMarkdownSections(doc.content_text ?? '');
      return sections.map((section) => ({
        document_title: doc.title,
        chunk_text: section,
        similarity: architectureSectionScore(doc.title, section, queryTerms),
      }));
    })
    .filter((chunk) => chunk.similarity >= 0.72)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

function splitMarkdownSections(text: string): string[] {
  const sections = text
    .split(/\n(?=#)/)
    .map((section) => section.trim())
    .filter((section) => section.length > 80);

  if (sections.length > 0) return sections.map((section) => section.slice(0, 1800));
  return text.match(/[\s\S]{1,1800}/g)?.map((section) => section.trim()).filter(Boolean) ?? [];
}

function importantTerms(text: string): string[] {
  const stopWords = new Set([
    'what', 'should', 'with', 'that', 'this', 'from', 'into', 'phase', 'client',
    'training', 'program', 'programme', 'generation', 'decision', 'needed',
  ]);
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((term) => term.length > 3 && !stopWords.has(term))
    .slice(0, 24);
}

function architectureSectionScore(title: string, section: string, queryTerms: string[]): number {
  const normalized = `${title}\n${section}`.toLowerCase();
  const matches = queryTerms.filter((term) => normalized.includes(term)).length;
  const titleBonus = documentPriorityRank(title) === 1 ? 0.12 : 0;
  const score = 0.72 + Math.min(0.16, matches * 0.025) + titleBonus;
  return roundScore(Math.min(0.96, score));
}

function mergeChunks(primaryChunks: KnowledgeChunk[], secondaryChunks: KnowledgeChunk[]): KnowledgeChunk[] {
  const seen = new Set<string>();
  const merged: KnowledgeChunk[] = [];
  for (const chunk of [...primaryChunks, ...secondaryChunks]) {
    const key = `${chunk.document_title}:${chunk.chunk_text.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(chunk);
  }
  return merged;
}

async function embedQuery(query: string, openaiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

function rankExcerpts(chunks: KnowledgeChunk[]): RelevantExcerpt[] {
  return chunks
    .map((chunk, index) => ({
      document_title: chunk.document_title,
      chunk_text: chunk.chunk_text,
      similarity: roundScore(chunk.similarity),
      priority_rank: documentPriorityRank(chunk.document_title),
      excerpt_index: index,
    }))
    .sort((a, b) => {
      const priorityDelta = a.priority_rank - b.priority_rank;
      if (priorityDelta !== 0 && Math.abs(a.similarity - b.similarity) < 0.08) return priorityDelta;
      return b.similarity - a.similarity;
    })
    .map((chunk, index) => ({ ...chunk, excerpt_index: index }));
}

function documentPriorityRank(title: string): number {
  const normalized = title.toLowerCase();
  const matched = DOCUMENT_PRIORITY.find((doc) => doc.patterns.some((pattern) => normalized.includes(pattern)));
  return matched?.rank ?? 99;
}

function buildReferencedDocuments(excerpts: RelevantExcerpt[]): ReferencedDocument[] {
  const map = new Map<string, ReferencedDocument>();
  for (const excerpt of excerpts) {
    const existing = map.get(excerpt.document_title);
    if (existing) {
      existing.excerpt_count += 1;
      existing.best_similarity = Math.max(existing.best_similarity, excerpt.similarity);
      existing.priority_rank = Math.min(existing.priority_rank, excerpt.priority_rank);
    } else {
      map.set(excerpt.document_title, {
        title: excerpt.document_title,
        excerpt_count: 1,
        best_similarity: excerpt.similarity,
        priority_rank: excerpt.priority_rank,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.priority_rank - b.priority_rank || b.best_similarity - a.best_similarity);
}

function buildAppliedRules(
  input: { taskType: string; phaseType: string | null; questionOrDecision: string },
  excerpts: RelevantExcerpt[],
): AppliedRule[] {
  const rules = [...BASE_PROGRAMMING_RULES];
  const haystack = `${input.taskType} ${input.phaseType ?? ''} ${input.questionOrDecision}`.toLowerCase();
  for (const [key, keyRules] of Object.entries(TASK_RULES)) {
    if (haystack.includes(key)) rules.push(...keyRules);
  }

  const excerptText = excerpts.map((excerpt) => `${excerpt.document_title} ${excerpt.chunk_text}`).join(' ').toLowerCase();
  if (excerptText.includes('injur') || excerptText.includes('pain') || excerptText.includes('rehab')) {
    rules.push({ rule: 'Pain, injury, and tolerance constraints override exercise preference and loading ambition.', source: 'Retrieved knowledge context' });
  }
  if (excerptText.includes('adherence') || excerptText.includes('habit')) {
    rules.push({ rule: 'Adherence is a primary programming constraint.', source: 'Retrieved knowledge context' });
  }
  if (excerptText.includes('protein') || excerptText.includes('carbohydrate') || excerptText.includes('nutrition')) {
    rules.push({ rule: 'Nutrition recommendations should match phase volume, intensity, and recovery demand.', source: 'Retrieved knowledge context' });
  }

  return dedupeRules(rules);
}

function dedupeRules(rules: AppliedRule[]): AppliedRule[] {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = rule.rule.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function calculateConfidence(excerpts: RelevantExcerpt[], referencedDocuments: ReferencedDocument[]): number {
  if (excerpts.length === 0) return 0;
  const top = excerpts.slice(0, 5);
  const averageSimilarity = top.reduce((sum, excerpt) => sum + excerpt.similarity, 0) / top.length;
  const sourceBreadthBonus = Math.min(0.12, referencedDocuments.length * 0.03);
  const priorityBonus = excerpts.some((excerpt) => excerpt.priority_rank <= 4) ? 0.08 : 0;
  return roundScore(Math.min(1, averageSimilarity + sourceBreadthBonus + priorityBonus));
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
