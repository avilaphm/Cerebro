import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 150;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 50);
}

async function extractTextFromPdf(fileBytes: ArrayBuffer, openaiKey: string): Promise<string> {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([fileBytes], { type: 'application/pdf' }), 'document.pdf');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });
  if (!uploadRes.ok) throw new Error('PDF upload failed');
  const uploadJson = (await uploadRes.json()) as { id?: string };
  const fileId = uploadJson.id;
  if (!fileId) throw new Error('No file ID from OpenAI');

  try {
    const responseRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_file', file_id: fileId },
              {
                type: 'input_text',
                text: 'Extract all text from this document verbatim. Return only the extracted text, no commentary, no markdown formatting.',
              },
            ],
          },
        ],
      }),
    });
    if (!responseRes.ok) throw new Error('OpenAI Responses API failed');
    const responseJson = (await responseRes.json()) as {
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    return responseJson.output?.[0]?.content?.[0]?.text ?? '';
  } finally {
    await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${openaiKey}` },
    }).catch(() => {});
  }
}

async function embedChunks(chunks: string[], openaiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: chunks }),
  });
  if (!res.ok) throw new Error('Embedding API failed');
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const db = createClient(url, serviceKey);

    const { document_id } = (await req.json()) as { document_id?: string };
    if (!document_id) return json({ error: 'Missing document_id.' }, 400);

    const { data: doc, error: docError } = await db
      .from('pt_knowledge_documents')
      .select('id, title, file_path, file_type')
      .eq('id', document_id)
      .single();

    if (docError || !doc) return json({ error: 'Document not found.' }, 404);

    let contentText = '';

    if (doc.file_path) {
      const { data: signed, error: signedErr } = await db.storage
        .from('pt-knowledge-docs')
        .createSignedUrl(doc.file_path as string, 300);

      if (signedErr || !signed?.signedUrl) return json({ error: 'Could not access file.' }, 500);

      const fileRes = await fetch(signed.signedUrl);
      if (!fileRes.ok) return json({ error: 'File fetch failed.' }, 500);

      const isPdf =
        (doc.file_type as string)?.includes('pdf') ||
        (doc.file_path as string).toLowerCase().endsWith('.pdf');

      if (isPdf) {
        const bytes = await fileRes.arrayBuffer();
        contentText = await extractTextFromPdf(bytes, openaiKey);
      } else {
        contentText = await fileRes.text();
      }
    }

    if (!contentText.trim()) {
      return json({ error: 'No text could be extracted from the document.' }, 422);
    }

    await db.from('pt_knowledge_documents').update({ content_text: contentText }).eq('id', document_id);

    // Delete any existing chunks for this document (re-ingestion)
    await db.from('pt_knowledge_chunks').delete().eq('document_id', document_id);

    const chunks = chunkText(contentText);
    const embeddings = await embedChunks(chunks, openaiKey);

    const rows = chunks.map((chunk_text, chunk_index) => ({
      document_id,
      chunk_index,
      chunk_text,
      embedding: JSON.stringify(embeddings[chunk_index]),
    }));

    const { error: insertError } = await db.from('pt_knowledge_chunks').insert(rows);
    if (insertError) throw new Error(insertError.message);

    await db
      .from('pt_knowledge_documents')
      .update({ chunk_count: chunks.length })
      .eq('id', document_id);

    return json({ success: true, chunk_count: chunks.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Ingestion failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
