import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai@4';

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

interface KnowledgeChunk {
  chunk_text: string;
  document_title: string;
  similarity: number;
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];
const OPENAI_TEXT_MODEL = Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5.6';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const openai = new OpenAI({ apiKey: openaiKey });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = authData.user.email?.toLowerCase() ?? '';
    const { data: requesterProfile } = await adminClient
      .from('profiles').select('role').eq('id', authData.user.id).maybeSingle();
    if (requesterProfile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
      return json({ error: 'Only Pedro/admin users can query the knowledge brain.' }, 403);
    }

    const body = (await req.json()) as { query: string; history?: HistoryMessage[] };
    if (!body.query?.trim()) return json({ error: 'Missing query.' }, 400);

    // Embed the query
    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: body.query,
    });
    const embedding = embeddingRes.data[0].embedding;

    // Search knowledge base
    const { data: chunks } = await adminClient.rpc('match_knowledge_chunks', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: 8,
    });

    const knowledgeContext = ((chunks ?? []) as KnowledgeChunk[])
      .map((c) => `[${c.document_title}]\n${c.chunk_text}`)
      .join('\n\n---\n\n');

    const systemPrompt = `You are Pedro Avila's PT Second Brain — a coaching knowledge assistant built from Pedro's uploaded documents, books, notes, and voice memos.

Your job is to answer questions by drawing directly from Pedro's knowledge base. Cite the source document when relevant.

If the knowledge base doesn't contain relevant information, say so clearly — do not hallucinate or fill gaps with generic advice.

${knowledgeContext ? `## Knowledge base excerpts:\n${knowledgeContext}` : 'The knowledge base appears to be empty or no relevant content was found for this query.'}`;

    const history = (body.history ?? []).slice(-10);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: body.query },
    ];

    const completion = await openai.chat.completions.create({
      model: OPENAI_TEXT_MODEL,
      temperature: 0.3,
      max_tokens: 800,
      messages,
    });

    const answer = completion.choices[0]?.message?.content?.trim() ?? 'No answer generated.';
    return json({ answer, sources_found: (chunks ?? []).length });
  } catch (err) {
    console.error('query-knowledge-brain error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
