import { createClient } from 'npm:@supabase/supabase-js@2';
import { extractText } from 'npm:unpdf@0.11.0';

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

async function extractTextFromPdf(fileBytes: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(fileBytes), { mergePages: true });
  return typeof text === 'string' ? text : (text as string[]).join('\n\n');
}

async function embedChunks(chunks: string[], openaiKey: string): Promise<number[][]> {
  const BATCH = 100;
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
    });
    if (!res.ok) throw new Error('Embedding API failed');
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    allEmbeddings.push(...json.data.map((d) => d.embedding));
  }
  return allEmbeddings;
}

async function transcribeAudio(audioBase64: string, mimeType: string, openaiKey: string): Promise<string> {
  const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
    : mimeType.includes('mp3') ? 'mp3'
    : mimeType.includes('ogg') ? 'ogg'
    : 'webm';
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', new Blob([audioBytes], { type: mimeType }), `voice.${ext}`);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error('Whisper transcription failed');
  const data = (await res.json()) as { text?: string };
  return data.text ?? '';
}

async function ingestTextForDocument(
  documentId: string,
  contentText: string,
  openaiKey: string,
  db: ReturnType<typeof createClient>,
): Promise<number> {
  await db.from('pt_knowledge_documents').update({ content_text: contentText }).eq('id', documentId);
  await db.from('pt_knowledge_chunks').delete().eq('document_id', documentId);
  const chunks = chunkText(contentText);
  const embeddings = await embedChunks(chunks, openaiKey);
  const rows = chunks.map((chunk_text, chunk_index) => ({
    document_id: documentId,
    chunk_index,
    chunk_text,
    embedding: JSON.stringify(embeddings[chunk_index]),
  }));
  const { error: insertError } = await db.from('pt_knowledge_chunks').insert(rows);
  if (insertError) throw new Error(insertError.message);
  await db.from('pt_knowledge_documents').update({ chunk_count: chunks.length }).eq('id', documentId);
  return chunks.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const db = createClient(url, serviceKey);

    const body = (await req.json()) as {
      document_id?: string;
      voice_audio_base64?: string;
      voice_mime_type?: string;
      title?: string;
    };

    // Voice note path: transcribe audio then ingest as a new document
    if (body.voice_audio_base64) {
      if (!body.title) return json({ error: 'Missing title for voice note.' }, 400);
      const contentText = await transcribeAudio(
        body.voice_audio_base64,
        body.voice_mime_type ?? 'audio/webm',
        openaiKey,
      );
      if (!contentText.trim()) return json({ error: 'Transcription returned empty text.' }, 422);

      const { data: newDoc, error: insertErr } = await db
        .from('pt_knowledge_documents')
        .insert({ title: body.title, source: 'voice', file_type: 'text/plain' })
        .select('id')
        .single();
      if (insertErr || !newDoc) return json({ error: 'Failed to create document record.' }, 500);

      const chunkCount = await ingestTextForDocument(newDoc.id as string, contentText, openaiKey, db);
      return json({ success: true, document_id: newDoc.id, chunk_count: chunkCount });
    }

    // File document path: fetch from storage and extract text
    if (!body.document_id) return json({ error: 'Missing document_id.' }, 400);

    const { data: doc, error: docError } = await db
      .from('pt_knowledge_documents')
      .select('id, title, file_path, file_type, content_text')
      .eq('id', body.document_id)
      .single();

    if (docError || !doc) return json({ error: 'Document not found.' }, 404);

    let contentText = (doc.content_text as string | null) ?? '';

    if (!contentText && doc.file_path) {
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
        contentText = await extractTextFromPdf(bytes);
      } else {
        contentText = await fileRes.text();
      }
    }

    if (!contentText.trim()) {
      return json({ error: 'No text could be extracted from the document.' }, 422);
    }

    const chunkCount = await ingestTextForDocument(body.document_id, contentText, openaiKey, db);
    return json({ success: true, chunk_count: chunkCount });
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
