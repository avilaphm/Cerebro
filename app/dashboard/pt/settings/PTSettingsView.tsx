'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { PTExercise } from '@/utils/pt/types';

const EMPTY_EXERCISE_FORM = {
  name: '', muscles: '', equipment: '', purpose: '', video_url: '', cue_1: '', cue_2: '', cue_3: '', cue_4: '', tags: '',
};

export default function PTSettingsView({ exercises: initialExercises }: { exercises: PTExercise[] }) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exercises, setExercises] = useState(initialExercises);
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_EXERCISE_FORM);
  const [addSaving, setAddSaving] = useState(false);

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

  const saveExercise = async () => {
    if (!addForm.name.trim()) return;
    setAddSaving(true);
    const record = {
      name: addForm.name.trim(),
      muscles: splitList(addForm.muscles),
      purpose: addForm.purpose.trim() || null,
      equipment: addForm.equipment.trim() || null,
      video_url: addForm.video_url.trim() || null,
      cues: [addForm.cue_1, addForm.cue_2, addForm.cue_3, addForm.cue_4].filter(Boolean).slice(0, 4),
      tags: splitList(addForm.tags),
      source: 'manual' as const,
    };
    const { error } = await supabase.from('pt_exercises').upsert(record, { onConflict: 'name' });
    if (error) {
      setStatus(error.message);
    } else {
      const { data } = await supabase.from('pt_exercises').select('*').order('name');
      setExercises((data ?? []) as PTExercise[]);
      setAddForm(EMPTY_EXERCISE_FORM);
      setShowAddModal(false);
      setStatus('Exercise saved.');
    }
    setAddSaving(false);
  };

  const filtered = exercises.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.muscles.join(' ').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] mb-10">Settings</h1>

      <section className="mb-10 max-w-2xl">
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Exercise library import</h2>
        <p className="text-xs text-black/40 mb-4">
          CSV columns: <span className="font-mono text-black/60">name, muscles, purpose, equipment, video_url, cue_1, cue_2, cue_3, cue_4, tags</span>
          <br />Upserts on name — re-importing the same file updates existing exercises.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="w-full border border-black bg-black px-5 py-3 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-40 sm:w-auto sm:py-2.5"
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
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">
            Exercise library ({exercises.length})
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exercises…"
              className="w-full border border-black/15 px-3 py-2.5 text-sm outline-none focus:border-black/40 sm:w-56 sm:py-1.5"
            />
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full border border-black bg-black px-4 py-2.5 text-sm text-white transition-colors hover:bg-white hover:text-black sm:w-auto sm:py-1.5"
            >
              + Add exercise
            </button>
          </div>
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

      {/* Add Exercise Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg space-y-4 overflow-y-auto border border-black/20 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-lg font-light">Add exercise</h3>
              <button onClick={() => setShowAddModal(false)} className="text-black/30 hover:text-black text-xl leading-none">×</button>
            </div>

            <div>
              <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Name *</label>
              <input
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Goblet Squat"
                className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                autoFocus
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Muscles</label>
                <input
                  value={addForm.muscles}
                  onChange={(e) => setAddForm((f) => ({ ...f, muscles: e.target.value }))}
                  placeholder="Quads, glutes, core"
                  className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                />
              </div>
              <div>
                <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Equipment</label>
                <input
                  value={addForm.equipment}
                  onChange={(e) => setAddForm((f) => ({ ...f, equipment: e.target.value }))}
                  placeholder="Dumbbell"
                  className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                />
              </div>
            </div>

            <div>
              <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">YouTube URL</label>
              <input
                value={addForm.video_url}
                onChange={(e) => setAddForm((f) => ({ ...f, video_url: e.target.value }))}
                placeholder="https://youtube.com/watch?v=…"
                className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
              />
              {addForm.video_url && addForm.video_url.includes('youtube') && (
                <p className="mt-1 text-[0.6rem] text-black/35">YouTube link detected — will show in client portal.</p>
              )}
            </div>

            <div>
              <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Description / purpose</label>
              <input
                value={addForm.purpose}
                onChange={(e) => setAddForm((f) => ({ ...f, purpose: e.target.value }))}
                placeholder="What this exercise is for"
                className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {(['cue_1', 'cue_2', 'cue_3', 'cue_4'] as const).map((key, idx) => (
                <div key={key}>
                  <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1">Cue {idx + 1}</label>
                  <input
                    value={addForm[key]}
                    onChange={(e) => setAddForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={`Cue ${idx + 1}`}
                    className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <button onClick={() => setShowAddModal(false)} className="border border-black/15 px-5 py-2.5 text-sm hover:bg-black/5">
                Cancel
              </button>
              <button
                onClick={() => void saveExercise()}
                disabled={addSaving || !addForm.name.trim()}
                className="flex-1 border border-black bg-black text-white py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
              >
                {addSaving ? 'Saving…' : 'Save to library'}
              </button>
            </div>
          </div>
        </div>
      )}
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
