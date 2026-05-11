import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You are Pedro Avila's AI programming assistant. Analyse this client profile document and extract a complete PT programme structure.

Return ONLY valid JSON in this exact schema. No markdown. No commentary.

{
  "name": "Programme name based on client goals",
  "goal": "Main training goal in one sentence",
  "programme": {
    "phases": [
      {
        "id": "phase_1",
        "title": "Phase title e.g. Week 1-4 Foundation",
        "focus": "What this phase trains",
        "weeks": "e.g. 4",
        "progression": "How it progresses across the phase",
        "days": [
          {
            "id": "day_1",
            "title": "Day 1 - Upper Body Push",
            "focus": "Session focus",
            "exercises": [
              {
                "id": "exercise_1",
                "exercise_id": null,
                "name": "Exercise name",
                "sets": "3",
                "reps": "8-12",
                "rest": "60-90 sec",
                "notes": "Any specific notes",
                "video_url": null,
                "cues": ["Cue 1", "Cue 2", "Cue 3"],
                "superset_id": null
              }
            ]
          }
        ]
      }
    ]
  }
}

Rules:
- Create 2-4 phases based on what makes sense for the client's profile, goals, injuries, and timeline
- Create 3-5 training days per phase based on the client's schedule and availability
- Include 4-8 exercises per day appropriate to the client's fitness level and goals
- Respect any injuries, limitations, or exercise dislikes mentioned
- Progressions should be realistic and periodised
- Keep exercises practical and evidence-based`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const adminClient = createClient(url, serviceKey);

    const { client_id } = (await req.json()) as { client_id?: string };
    if (!client_id) return json({ error: 'Missing client_id.' }, 400);

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
            // Try PDF path via OpenAI Files + Responses API — fall through on any failure
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
                const responseRes = await fetch('https://api.openai.com/v1/responses', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: 'gpt-4o',
                    instructions: SYSTEM_PROMPT,
                    input: [
                      {
                        role: 'user',
                        content: [
                          { type: 'input_file', file_id: uploadedFileId },
                          { type: 'input_text', text: 'Extract the PT programme structure from this client profile document. Return only the JSON schema.' },
                        ],
                      },
                    ],
                  }),
                });

                if (responseRes.ok) {
                  const responseJson = (await responseRes.json()) as { output?: Array<{ content?: Array<{ text?: string }> }> };
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
            // Non-PDF: read as text and use chat completions below
            const documentContent = await fileRes.text();
            if (documentContent.trim()) {
              return json(await generateFromText(`Client profile document:\n\n${documentContent}`, openaiKey));
            }
          }
        }
      }
    }

    // Fallback: use client goals + notes via chat completions
    const prompt = `Client name: ${String(client.name)}\nGoals: ${String(client.goals ?? 'Not specified')}\nNotes: ${String(client.notes ?? 'None')}`;
    return json(await generateFromText(prompt, openaiKey));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Parsing failed.' }, 500);
  }
});

async function generateFromText(prompt: string, openaiKey: string): Promise<Record<string, unknown>> {
  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text().catch(() => 'unknown error');
    return { error: `OpenAI error: ${errText}` };
  }

  const chatJson = (await chatRes.json()) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
