import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface PhaseTemplate {
  id: string;
  title: string;
  focus: string;
  weeks: string;
}

function buildSystemPrompt(phaseTemplate: PhaseTemplate[]): string {
  const phaseList = phaseTemplate.length > 0
    ? phaseTemplate
        .map((p, i) => `  ${i + 1}. "${p.title}" — ${p.weeks} weeks — focus: ${p.focus}`)
        .join('\n')
    : '  (No template provided — create 3-5 phases based on client profile)';

  return `You are Pedro Avila's AI programming assistant. Analyse a client profile and populate structured workout days into a fixed programme template.

CRITICAL RULES:
- The phase structure below is FIXED. Do not add, remove, rename, or reorder phases.
- Do not change "title" or "weeks" values for any phase. Copy them exactly as given.
- Populate "days" for each phase based on the client profile, goals, schedule, and any injuries or limitations.
- Each workout day must have sections in this exact order: Warm Up, Workout, MetCon (if applicable), Stretches.
- Mark each section start using "section_start" on the first exercise of that section.
- Every exercise must have up to 4 simple client-facing cues.
- Respect any injuries, limitations, or exercise dislikes mentioned in the client profile.

FIXED PHASE STRUCTURE:
${phaseList}

Return ONLY valid JSON. No markdown. No commentary.

{
  "name": "Programme name based on client goals",
  "goal": "Main training goal",
  "programme": {
    "phases": [
      {
        "id": "<copy from template>",
        "title": "<copy from template exactly>",
        "focus": "<copy from template>",
        "weeks": "<copy from template exactly>",
        "progression": "How it progresses",
        "days": [
          {
            "id": "day_1",
            "title": "Day 1 - Full Body",
            "focus": "Session focus",
            "exercises": [
              {
                "id": "exercise_1",
                "exercise_id": null,
                "name": "Exercise name",
                "sets": "3",
                "reps": "8-12",
                "rest": "60 sec",
                "notes": "Specific note",
                "video_url": null,
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
}`;
}

async function getQueryEmbedding(query: string, openaiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function searchKnowledgeBase(
  query: string,
  openaiKey: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string> {
  const embedding = await getQueryEmbedding(query, openaiKey);
  if (!embedding) return '';

  const db = createClient(supabaseUrl, serviceKey);
  const { data } = await db.rpc('match_knowledge_chunks', {
    query_embedding: embedding,
    match_count: 6,
    match_threshold: 0.4,
  });

  if (!data || data.length === 0) return '';

  return (data as Array<{ document_title: string; chunk_text: string }>)
    .map((r) => `[From: ${r.document_title}]\n${r.chunk_text}`)
    .join('\n\n---\n\n');
}

async function searchWeb(query: string, openaiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-search-preview',
        messages: [
          {
            role: 'user',
            content: `Research and summarise the best evidence-based training methods for: ${query}. Focus on exercise selection, progression strategies, and periodisation appropriate for this client profile. Be concise — 3 short paragraphs max.`,
          },
        ],
      }),
    });
    if (!res.ok) return '';
    const json = (await res.json()) as { choices?: Array<{ message: { content: string } }> };
    return json.choices?.[0]?.message.content ?? '';
  } catch {
    return '';
  }
}

async function generateFromText(
  prompt: string,
  openaiKey: string,
  supabaseUrl: string,
  serviceKey: string,
  phaseTemplate: PhaseTemplate[],
): Promise<Record<string, unknown>> {
  const [knowledgeContext, webContext] = await Promise.all([
    searchKnowledgeBase(prompt.slice(0, 500), openaiKey, supabaseUrl, serviceKey),
    searchWeb(prompt.slice(0, 400), openaiKey),
  ]);

  const contextSections: string[] = [];
  if (knowledgeContext) contextSections.push(`KNOWLEDGE BASE EXCERPTS:\n${knowledgeContext}`);
  if (webContext) contextSections.push(`WEB RESEARCH:\n${webContext}`);

  const userContent: Record<string, unknown> = {
    client_profile: prompt,
    phase_template: phaseTemplate,
  };
  if (contextSections.length > 0) {
    userContent.context = contextSections.join('\n\n===\n\n');
  }

  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(phaseTemplate) },
        { role: 'user', content: JSON.stringify(userContent) },
      ],
    }),
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text().catch(() => 'unknown error');
    return { error: `OpenAI error: ${errText}` };
  }

  const chatJson = (await chatRes.json()) as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };
  if (chatJson.error) return { error: chatJson.error.message };
  const raw = chatJson.choices?.[0]?.message.content ?? '{}';
  return parseJsonResult(raw);
}

function parseJsonResult(raw: string): Record<string, unknown> {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { error: 'Could not parse AI response as JSON.' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const adminClient = createClient(url, serviceKey);

    const { client_id, phase_template } = (await req.json()) as {
      client_id?: string;
      phase_template?: PhaseTemplate[];
    };
    if (!client_id) return json({ error: 'Missing client_id.' }, 400);

    const template: PhaseTemplate[] = phase_template ?? [];

    const { data: client, error: clientError } = await adminClient
      .from('pt_clients')
      .select('name, goals, notes, document_url')
      .eq('id', client_id)
      .single();

    if (clientError || !client) return json({ error: 'Client not found.' }, 404);

    const documentPath = client.document_url as string | null;

    if (documentPath) {
      const { data: signedData, error: signedError } = await adminClient.storage
        .from('pt-client-docs')
        .createSignedUrl(documentPath, 300);

      if (!signedError && signedData?.signedUrl) {
        const fileRes = await fetch(signedData.signedUrl);

        if (fileRes.ok) {
          const contentType = fileRes.headers.get('content-type') ?? '';
          const isPdf = contentType.includes('pdf') || documentPath.toLowerCase().endsWith('.pdf');

          if (isPdf) {
            let uploadedFileId: string | null = null;
            try {
              const fileBytes = await fileRes.arrayBuffer();

              const form = new FormData();
              form.append('purpose', 'user_data');
              form.append('file', new Blob([fileBytes], { type: 'application/pdf' }), 'client-profile.pdf');

              const uploadRes = await fetch('https://api.openai.com/v1/files', {
                method: 'POST',
                headers: { Authorization: `Bearer ${openaiKey}` },
                body: form,
              });

              if (uploadRes.ok) {
                const uploadJson = (await uploadRes.json()) as { id?: string };
                uploadedFileId = uploadJson.id ?? null;
              }

              if (uploadedFileId) {
                const [knowledgeContext, webContext] = await Promise.all([
                  searchKnowledgeBase(
                    `${String(client.goals ?? '')} ${String(client.notes ?? '')}`.slice(0, 500),
                    openaiKey,
                    url,
                    serviceKey,
                  ),
                  searchWeb(String(client.goals ?? 'general fitness').slice(0, 300), openaiKey),
                ]);

                const contextSections: string[] = [];
                if (knowledgeContext) contextSections.push(`KNOWLEDGE BASE EXCERPTS:\n${knowledgeContext}`);
                if (webContext) contextSections.push(`WEB RESEARCH:\n${webContext}`);

                const systemWithContext = buildSystemPrompt(template) +
                  (contextSections.length > 0
                    ? `\n\n${contextSections.join('\n\n===\n\n')}`
                    : '');

                const responseRes = await fetch('https://api.openai.com/v1/responses', {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'gpt-4o',
                    instructions: systemWithContext,
                    input: [
                      {
                        role: 'user',
                        content: [
                          { type: 'input_file', file_id: uploadedFileId },
                          {
                            type: 'input_text',
                            text: `Analyse this client profile and populate the fixed phase programme template. Phase template: ${JSON.stringify(template)}. Return only the JSON schema.`,
                          },
                        ],
                      },
                    ],
                  }),
                });

                if (responseRes.ok) {
                  const responseJson = (await responseRes.json()) as {
                    output?: Array<{ content?: Array<{ text?: string }> }>;
                  };
                  const rawText = responseJson.output?.[0]?.content?.[0]?.text ?? '';
                  if (rawText) {
                    return json(parseJsonResult(rawText));
                  }
                }
              }
            } catch {
              // PDF processing failed — fall through to text fallback
            } finally {
              if (uploadedFileId) {
                await fetch(`https://api.openai.com/v1/files/${uploadedFileId}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${openaiKey}` },
                }).catch(() => {});
              }
            }
          } else {
            const documentContent = await fileRes.text();
            if (documentContent.trim()) {
              const prompt = `Client profile document:\n\n${documentContent}`;
              return json(await generateFromText(prompt, openaiKey, url, serviceKey, template));
            }
          }
        }
      }
    }

    const prompt = `Client name: ${String(client.name)}\nGoals: ${String(client.goals ?? 'Not specified')}\nNotes: ${String(client.notes ?? 'None')}`;
    return json(await generateFromText(prompt, openaiKey, url, serviceKey, template));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Parsing failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
