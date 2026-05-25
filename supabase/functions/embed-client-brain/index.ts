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

type DocType = 'master' | 'nutrition' | 'exercise' | 'lifestyle';

const TARGET_CHARS = 1800;
const OVERLAP_CHARS = 200;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json() as { client_id?: string };
    if (!body.client_id) return json({ error: 'client_id required' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

    const [masterRes, nutritionRes, exerciseRes, lifestyleRes] = await Promise.all([
      admin.from('pt_client_brain').select('*').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_nutrition_doc').select('*').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_exercise_doc').select('*').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_lifestyle_doc').select('*').eq('client_id', body.client_id).maybeSingle(),
    ]);

    const sources: { doc_type: DocType; row: Record<string, unknown> | null }[] = [
      { doc_type: 'master', row: masterRes.data ?? null },
      { doc_type: 'nutrition', row: nutritionRes.data ?? null },
      { doc_type: 'exercise', row: exerciseRes.data ?? null },
      { doc_type: 'lifestyle', row: lifestyleRes.data ?? null },
    ];

    const chunks: { doc_type: DocType; chunk_index: number; chunk_text: string; source_columns: string[] }[] = [];
    for (const { doc_type, row } of sources) {
      if (!row) continue;
      const sections = serializeRow(row);
      const merged = mergeSections(sections);
      const split = chunkText(merged.text, TARGET_CHARS, OVERLAP_CHARS);
      split.forEach((text, i) => {
        chunks.push({ doc_type, chunk_index: i, chunk_text: text, source_columns: merged.columns });
      });
    }

    if (chunks.length === 0) {
      return json({ ok: true, chunks_written: 0, note: 'No brain content found for this client yet.' });
    }

    const embeddings = await embedBatch(chunks.map((c) => c.chunk_text), openaiKey);
    if (!embeddings) return json({ error: 'Embedding API failed' }, 502);

    const { error: delError } = await admin
      .from('pt_client_brain_chunks')
      .delete()
      .eq('client_id', body.client_id);
    if (delError) return json({ error: `Could not clear stale chunks: ${delError.message}` }, 500);

    const rows = chunks.map((c, i) => ({
      client_id: body.client_id,
      doc_type: c.doc_type,
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: embeddings[i],
      source_columns: c.source_columns,
    }));

    const { error: insError } = await admin.from('pt_client_brain_chunks').insert(rows);
    if (insError) return json({ error: `Insert failed: ${insError.message}` }, 500);

    return json({ ok: true, chunks_written: rows.length, by_doc: countByDoc(rows) });
  } catch (error) {
    console.error('embed-client-brain error:', error);
    return json({ error: error instanceof Error ? error.message : 'Embedding failed' }, 500);
  }
});

function serializeRow(row: Record<string, unknown>): Array<{ column: string; text: string }> {
  const skip = new Set(['id', 'client_id', 'created_at', 'updated_at']);
  const out: Array<{ column: string; text: string }> = [];
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    const text = stringifyValue(v).trim();
    if (!text || text === '{}' || text === '[]') continue;
    out.push({ column: k, text: `${k}:\n${text}` });
  }
  return out;
}

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    if (v.every((x) => typeof x === 'string')) return v.join(', ');
    return JSON.stringify(v, null, 2);
  }
  if (typeof v === 'object') {
    return JSON.stringify(v, null, 2);
  }
  return '';
}

function mergeSections(sections: Array<{ column: string; text: string }>): { text: string; columns: string[] } {
  return {
    text: sections.map((s) => s.text).join('\n\n'),
    columns: sections.map((s) => s.column),
  };
}

function chunkText(text: string, targetChars: number, overlapChars: number): string[] {
  const clean = text.trim();
  if (clean.length <= targetChars) return clean ? [clean] : [];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    const end = Math.min(cursor + targetChars, clean.length);
    let slice = clean.slice(cursor, end);
    if (end < clean.length) {
      const lastNewline = slice.lastIndexOf('\n\n');
      if (lastNewline > targetChars * 0.6) slice = slice.slice(0, lastNewline);
    }
    chunks.push(slice.trim());
    if (end >= clean.length) break;
    cursor += slice.length - overlapChars;
    if (cursor < 0) cursor = 0;
  }
  return chunks.filter((c) => c.length > 0);
}

async function embedBatch(inputs: string[], openaiKey: string): Promise<number[][] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: inputs }),
    });
    if (!res.ok) {
      console.error('OpenAI embeddings non-200:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    if (!data.data || data.data.length !== inputs.length) return null;
    return data.data.map((d) => d.embedding);
  } catch (e) {
    console.error('OpenAI embeddings threw:', e);
    return null;
  }
}

function countByDoc(rows: Array<{ doc_type: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.doc_type] = (counts[r.doc_type] ?? 0) + 1;
  return counts;
}
