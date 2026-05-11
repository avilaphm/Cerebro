'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { PTExercise } from '@/utils/pt/types';

export default function PTSettingsView({ exercises: initialExercises }: { exercises: PTExercise[] }) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exercises, setExercises] = useState(initialExercises);
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');

  const importExercises = async (file: File) => {
    setImporting(true);
    setStatus('Importing…');
    const text = await file.text();
    const rows = parseCsv(text);
    const toImport = rows
      .map((row) => ({
        name: row.name,
        muscles: splitList(row.muscles),
        purpose: row.purpose || null,
        equipment: row.equipment || null,
        video_url: row.video_url || row.youtube || null,
        cues: [row.cue_1, row.cue_2, row.cue_3, row.cue_4].filter(Boolean).slice(0, 4),
        tags: splitList(row.tags),
        source: 'spreadsheet' as const,
      }))
      .filter((row) => row.name);

    if (toImport.length === 0) {
      setStatus('No exercises found. Columns: name, muscles, purpose, equipment, video_url, cue_1–4, tags.');
      setImporting(false);
      return;
    }

    const { error } = await supabase.from('pt_exercises').upsert(toImport, { onConflict: 'name' });
    if (error) {
      setStatus(error.message);
    } else {
      setStatus(`${toImport.length} exercises imported.`);
      const { data } = await supabase.from('pt_exercises').select('*').order('name');
      setExercises((data ?? []) as PTExercise[]);
    }
    setImporting(false);
  };

  const filtered = exercises.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.muscles.join(' ').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] mb-8">Settings</h1>

      <section className="mb-10 max-w-2xl">
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Exercise library import</h2>
        <p className="text-xs text-black/40 mb-4">
          CSV columns: <span className="font-mono text-black/60">name, muscles, purpose, equipment, video_url, cue_1, cue_2, cue_3, cue_4, tags</span>
          <br />Upserts on name — re-importing the same file updates existing exercises.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="border border-black bg-black text-white px-5 py-2.5 text-sm disabled:opacity-40 hover:bg-white hover:text-black transition-colors"
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          {status && <p className="text-xs text-black/40">{status}</p>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importExercises(f); e.target.value = ''; }}
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">
            Exercise library ({exercises.length})
          </h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exercises…"
            className="border border-black/15 px-3 py-1.5 text-sm outline-none focus:border-black/40 w-56"
          />
        </div>

        {filtered.length === 0 && (
          <p className="text-sm text-black/30">
            {exercises.length === 0 ? 'No exercises yet. Import a CSV to get started.' : 'No matches.'}
          </p>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((ex) => (
            <div key={ex.id} className="border border-black/10 p-4">
              <p className="font-medium text-sm">{ex.name}</p>
              {ex.muscles.length > 0 && (
                <p className="text-xs text-black/40 mt-0.5">{ex.muscles.join(', ')}</p>
              )}
              {ex.equipment && (
                <p className="text-xs text-black/30 mt-0.5">{ex.equipment}</p>
              )}
              {ex.video_url && (
                <a
                  href={ex.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-black/40 hover:text-black mt-2 block underline underline-offset-2"
                >
                  Video
                </a>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headers = splitCsvLine(lines[0] ?? '').map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? ''])) as Record<string, string>;
  });
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
}

function splitList(value: string) {
  return value.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
}
