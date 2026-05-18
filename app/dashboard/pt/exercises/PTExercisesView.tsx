'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Pencil, Search, Video, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import type { PTExercise } from '@/utils/pt/types';

function getYouTubeId(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] ?? null;
    if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] ?? null;
    return parsed.searchParams.get('v');
  } catch {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
    return match?.[1] ?? null;
  }
}

interface Props {
  initialExercises: PTExercise[];
}

const MUSCLE_GROUPS = [
  'Glutes', 'Hamstrings', 'Quadriceps', 'Calves', 'Hip Flexors',
  'Core', 'Lower Back', 'Upper Back', 'Lats', 'Traps', 'Chest',
  'Shoulders', 'Biceps', 'Triceps', 'Forearms',
];

const EQUIPMENT_OPTIONS = [
  'bodyweight', 'barbell', 'dumbbells', 'kettlebell', 'cable machine',
  'resistance band', 'machine', 'TRX', 'foam roller', 'stability ball',
];

const CATEGORY_TAGS = [
  'strength-compound', 'strength-isolation', 'core', 'mobility',
  'cardio', 'golf', 'running', 'pilates',
];

export default function PTExercisesView({ initialExercises }: Props) {
  const supabase = createClient();
  const [exercises, setExercises] = useState<PTExercise[]>(initialExercises);
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('');
  const [equipFilter, setEquipFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selected, setSelected] = useState<PTExercise | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<PTExercise>>({});
  const [saving, setSaving] = useState(false);
  const [findingVideo, setFindingVideo] = useState(false);
  const [flashMsg, setFlashMsg] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSetupCues, setShowSetupCues] = useState(false);
  const [showCues, setShowCues] = useState(false);

  function flash(msg: string) {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(''), 4000);
  }

  const filtered = exercises.filter((ex) => {
    const q = search.toLowerCase();
    if (q && !ex.name.toLowerCase().includes(q) &&
        !ex.primary_muscles.some((m) => m.toLowerCase().includes(q)) &&
        !ex.conditions.some((c) => c.toLowerCase().includes(q))) return false;
    if (muscleFilter && !ex.primary_muscles.some((m) => m.toLowerCase().includes(muscleFilter.toLowerCase())) &&
        !ex.secondary_muscles.some((m) => m.toLowerCase().includes(muscleFilter.toLowerCase()))) return false;
    if (equipFilter && (ex.equipment ?? '').toLowerCase() !== equipFilter.toLowerCase()) return false;
    if (tagFilter && !ex.tags.some((t) => t.toLowerCase().includes(tagFilter.toLowerCase()))) return false;
    return true;
  });

  function openExercise(ex: PTExercise) {
    setSelected(ex);
    setEditing(false);
    setDraft({});
    setShowSetupCues(false);
    setShowCues(false);
  }

  function startEdit() {
    if (!selected) return;
    setDraft({ ...selected });
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected || !draft.id) return;
    setSaving(true);
    const update = {
      name: draft.name,
      primary_muscles: draft.primary_muscles,
      secondary_muscles: draft.secondary_muscles,
      conditions: draft.conditions,
      setup_cues: draft.setup_cues,
      cues: draft.cues,
      equipment: draft.equipment,
      video_url: draft.video_url,
      tags: draft.tags,
      muscles: [...(draft.primary_muscles ?? []), ...(draft.secondary_muscles ?? [])],
    };
    const { error } = await supabase.from('pt_exercises').update(update).eq('id', draft.id);
    setSaving(false);
    if (error) { flash(`Error: ${error.message}`); return; }

    const updated = { ...selected, ...update } as PTExercise;
    setExercises((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setSelected(updated);
    setEditing(false);
    flash('Saved');
  }

  async function findVideo() {
    if (!selected) return;
    setFindingVideo(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/search-exercise-videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ exercise_ids: [selected.id] }),
    });
    const result = await res.json();
    setFindingVideo(false);
    if (result.populated > 0) {
      // Refetch this exercise to get the updated video_url
      const { data } = await supabase.from('pt_exercises').select('*').eq('id', selected.id).single();
      if (data) {
        const updated = data as PTExercise;
        setExercises((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        setSelected(updated);
        if (editing) setDraft((d) => ({ ...d, video_url: updated.video_url }));
        flash('Video found and saved');
      }
    } else {
      flash('No video found — try adding one manually');
    }
  }

  // Array field editor helper
  function ArrayField({
    label, value, onChange,
  }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
    const [inputVal, setInputVal] = useState('');
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-black/50">{label}</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {value.map((item, idx) => (
            <span key={idx} className="flex items-center gap-1 rounded-full bg-black/8 px-2 py-0.5 text-xs">
              {item}
              <button type="button" onClick={() => onChange(value.filter((_, i) => i !== idx))} className="text-black/40 hover:text-black">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputVal.trim()) {
                e.preventDefault();
                onChange([...value, inputVal.trim()]);
                setInputVal('');
              }
            }}
            placeholder="Type and press Enter"
            className="flex-1 rounded-lg border border-black/12 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
          />
        </div>
      </div>
    );
  }

  const videoId = getYouTubeId(editing ? (draft.video_url ?? null) : selected?.video_url ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-black/8 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Exercise Library</h1>
          <p className="text-xs text-black/40">{exercises.length} exercises</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-black/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exercises..."
              className="h-8 rounded-lg border border-black/12 bg-white pl-8 pr-3 text-sm outline-none focus:border-black/30 w-56"
            />
          </div>
          <select
            value={muscleFilter}
            onChange={(e) => setMuscleFilter(e.target.value)}
            className="h-8 rounded-lg border border-black/12 bg-white px-2 text-xs outline-none focus:border-black/30"
          >
            <option value="">All muscles</option>
            {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={equipFilter}
            onChange={(e) => setEquipFilter(e.target.value)}
            className="h-8 rounded-lg border border-black/12 bg-white px-2 text-xs outline-none focus:border-black/30"
          >
            <option value="">All equipment</option>
            {EQUIPMENT_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="h-8 rounded-lg border border-black/12 bg-white px-2 text-xs outline-none focus:border-black/30"
          >
            <option value="">All categories</option>
            {CATEGORY_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Exercise Grid */}
        <div className={`flex-1 overflow-y-auto p-4 ${selected ? 'hidden md:block' : ''}`}>
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-black/40">No exercises match your filters</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((ex) => {
                const thumb = getYouTubeId(ex.video_url);
                const isActive = selected?.id === ex.id;
                return (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => openExercise(ex)}
                    className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-all ${
                      isActive
                        ? 'border-black shadow-md'
                        : 'border-black/10 bg-white hover:border-black/25 hover:shadow-sm'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-video w-full bg-black/5">
                      {thumb ? (
                        <img
                          src={`https://img.youtube.com/vi/${thumb}/hqdefault.jpg`}
                          alt={ex.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Video className="h-5 w-5 text-black/20" />
                        </div>
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex flex-1 flex-col p-2.5">
                      <p className="text-xs font-medium leading-snug">{ex.name}</p>
                      {ex.primary_muscles.length > 0 && (
                        <p className="mt-0.5 text-[0.65rem] text-black/40 leading-tight">
                          {ex.primary_muscles.slice(0, 2).join(' · ')}
                        </p>
                      )}
                      {ex.conditions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {ex.conditions.slice(0, 2).map((c) => (
                            <span key={c} className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[0.6rem] text-emerald-700">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail / Edit Panel */}
        {selected && (
          <div className="flex w-full flex-col overflow-y-auto border-l border-black/8 bg-white md:w-96 lg:w-[28rem]">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-black/8 px-5 py-4">
              <div className="flex items-center gap-2">
                {editing ? (
                  <>
                    <button type="button" onClick={() => setEditing(false)} className="text-xs text-black/40 hover:text-black">Cancel</button>
                    <button type="button" onClick={saveEdit} disabled={saving} className="rounded-lg bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={startEdit} className="flex items-center gap-1 rounded-lg border border-black/12 px-2.5 py-1 text-xs hover:bg-black/5">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-black/30 hover:text-black">
                <X className="h-4 w-4" />
              </button>
            </div>

            {flashMsg && (
              <div className="mx-5 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{flashMsg}</div>
            )}

            {/* Video */}
            <div className="relative aspect-video w-full bg-black">
              {videoId ? (
                <iframe
                  title={`${selected.name} demo`}
                  src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/30">No video</div>
              )}
            </div>

            {/* Video URL field */}
            <div className="border-b border-black/8 px-5 py-3">
              {editing ? (
                <div className="flex gap-2">
                  <input
                    value={draft.video_url ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, video_url: e.target.value || null }))}
                    placeholder="YouTube URL"
                    className="flex-1 rounded-lg border border-black/12 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
                  />
                  <button
                    type="button"
                    onClick={findVideo}
                    disabled={findingVideo}
                    className="flex items-center gap-1 rounded-lg border border-black/12 px-2.5 py-1.5 text-xs hover:bg-black/5 disabled:opacity-50"
                  >
                    <Search className="h-3 w-3" />
                    {findingVideo ? 'Searching…' : 'Find video'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="flex-1 truncate text-xs text-black/40">{selected.video_url ?? 'No video URL'}</p>
                  <button
                    type="button"
                    onClick={findVideo}
                    disabled={findingVideo}
                    className="flex items-center gap-1 rounded-lg border border-black/12 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
                  >
                    <Search className="h-3 w-3" />
                    {findingVideo ? 'Searching…' : 'Find video'}
                  </button>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 space-y-5 px-5 py-5">
              {/* Name */}
              {editing ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-black/50">Name</p>
                  <input
                    value={draft.name ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="w-full rounded-lg border border-black/12 bg-white px-2.5 py-1.5 text-sm font-medium outline-none focus:border-black/30"
                  />
                </div>
              ) : (
                <h2 className="text-base font-semibold">{selected.name}</h2>
              )}

              {/* Equipment */}
              {editing ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-black/50">Equipment</p>
                  <select
                    value={draft.equipment ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, equipment: e.target.value || null }))}
                    className="w-full rounded-lg border border-black/12 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black/30"
                  >
                    <option value="">None / bodyweight</option>
                    {EQUIPMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ) : selected.equipment ? (
                <p className="text-xs text-black/50">Equipment: {selected.equipment}</p>
              ) : null}

              {/* Muscles */}
              {editing ? (
                <>
                  <ArrayField
                    label="Primary muscles"
                    value={draft.primary_muscles ?? []}
                    onChange={(v) => setDraft((d) => ({ ...d, primary_muscles: v }))}
                  />
                  <ArrayField
                    label="Secondary muscles"
                    value={draft.secondary_muscles ?? []}
                    onChange={(v) => setDraft((d) => ({ ...d, secondary_muscles: v }))}
                  />
                </>
              ) : (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-black/50">Muscles worked</p>
                  {selected.primary_muscles.length > 0 && (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {selected.primary_muscles.map((m) => (
                        <span key={m} className="rounded-full bg-black px-2.5 py-0.5 text-[0.65rem] font-medium text-white">{m}</span>
                      ))}
                    </div>
                  )}
                  {selected.secondary_muscles.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selected.secondary_muscles.map((m) => (
                        <span key={m} className="rounded-full border border-black/15 px-2.5 py-0.5 text-[0.65rem] text-black/60">{m}</span>
                      ))}
                    </div>
                  )}
                  {selected.primary_muscles.length === 0 && selected.secondary_muscles.length === 0 && (
                    <p className="text-xs text-black/30">No muscles added</p>
                  )}
                </div>
              )}

              {/* Conditions */}
              {editing ? (
                <ArrayField
                  label="Good for (conditions)"
                  value={draft.conditions ?? []}
                  onChange={(v) => setDraft((d) => ({ ...d, conditions: v }))}
                />
              ) : (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-black/50">Good for</p>
                  {selected.conditions.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {selected.conditions.map((c) => (
                        <span key={c} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[0.65rem] text-emerald-700">{c}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-black/30">None added</p>
                  )}
                </div>
              )}

              {/* Setup cues */}
              {editing ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-black/50">Setup cues (4-6 ordered steps)</p>
                  {(draft.setup_cues ?? []).map((cue, idx) => (
                    <div key={idx} className="mb-1.5 flex gap-1.5">
                      <span className="mt-1.5 w-4 shrink-0 text-center text-[0.65rem] font-medium text-black/40">{idx + 1}</span>
                      <input
                        value={cue}
                        onChange={(e) => {
                          const updated = [...(draft.setup_cues ?? [])];
                          updated[idx] = e.target.value;
                          setDraft((d) => ({ ...d, setup_cues: updated }));
                        }}
                        className="flex-1 rounded-lg border border-black/12 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (draft.setup_cues ?? []).filter((_, i) => i !== idx);
                          setDraft((d) => ({ ...d, setup_cues: updated }));
                        }}
                        className="text-black/20 hover:text-black"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, setup_cues: [...(d.setup_cues ?? []), ''] }))}
                    className="mt-1 text-xs text-black/40 hover:text-black"
                  >
                    + Add cue
                  </button>
                </div>
              ) : selected.setup_cues.length > 0 ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowSetupCues((s) => !s)}
                    className="flex w-full items-center justify-between rounded-xl border border-black/10 bg-black/2 px-4 py-2.5"
                  >
                    <span className="text-sm font-medium">Setup</span>
                    {showSetupCues ? <ChevronUp className="h-4 w-4 text-black/40" /> : <ChevronDown className="h-4 w-4 text-black/40" />}
                  </button>
                  {showSetupCues && (
                    <ol className="mt-2 space-y-1.5 rounded-xl border border-black/8 bg-white px-5 py-4">
                      {selected.setup_cues.map((cue, idx) => (
                        <li key={idx} className="flex gap-2.5 text-sm text-black/70">
                          <span className="mt-0.5 shrink-0 text-xs font-semibold text-black/30">{idx + 1}</span>
                          {cue}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : null}

              {/* Verbal cues */}
              {editing ? (
                <ArrayField
                  label="Verbal cues (during movement)"
                  value={draft.cues ?? []}
                  onChange={(v) => setDraft((d) => ({ ...d, cues: v }))}
                />
              ) : selected.cues.length > 0 ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowCues((s) => !s)}
                    className="flex w-full items-center justify-between rounded-xl border border-black/10 bg-black/2 px-4 py-2.5"
                  >
                    <span className="text-sm font-medium">Verbal cues</span>
                    {showCues ? <ChevronUp className="h-4 w-4 text-black/40" /> : <ChevronDown className="h-4 w-4 text-black/40" />}
                  </button>
                  {showCues && (
                    <ul className="mt-2 space-y-1 rounded-xl border border-black/8 bg-white px-5 py-4">
                      {selected.cues.map((cue, idx) => (
                        <li key={idx} className="flex gap-2 text-sm text-black/70">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-black/30" />
                          {cue}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {/* Tags */}
              {editing ? (
                <ArrayField
                  label="Category tags"
                  value={draft.tags ?? []}
                  onChange={(v) => setDraft((d) => ({ ...d, tags: v }))}
                />
              ) : selected.tags.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-black/50">Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((t) => (
                      <span key={t} className="rounded-full border border-black/10 px-2.5 py-0.5 text-[0.65rem] text-black/50">{t}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Progressions & Regressions (view only - linking is advanced) */}
              {!editing && (selected.progression_ids.length > 0 || selected.regression_ids.length > 0) && (
                <div className="space-y-3">
                  {selected.progression_ids.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-black/50">Make it harder</p>
                      <ProgressionList ids={selected.progression_ids} exercises={exercises} onSelect={openExercise} />
                    </div>
                  )}
                  {selected.regression_ids.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-black/50">Make it easier</p>
                      <ProgressionList ids={selected.regression_ids} exercises={exercises} onSelect={openExercise} />
                    </div>
                  )}
                </div>
              )}

              {/* Progressions/regressions edit */}
              {editing && (
                <>
                  <ProgressionEditor
                    label="Progressions (harder)"
                    ids={draft.progression_ids ?? []}
                    exercises={exercises}
                    onChange={(v) => setDraft((d) => ({ ...d, progression_ids: v }))}
                  />
                  <ProgressionEditor
                    label="Regressions (easier)"
                    ids={draft.regression_ids ?? []}
                    exercises={exercises}
                    onChange={(v) => setDraft((d) => ({ ...d, regression_ids: v }))}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressionList({
  ids, exercises, onSelect,
}: { ids: string[]; exercises: PTExercise[]; onSelect: (ex: PTExercise) => void }) {
  const linked = ids.map((id) => exercises.find((e) => e.id === id)).filter(Boolean) as PTExercise[];
  if (!linked.length) return null;
  return (
    <div className="space-y-1">
      {linked.map((ex) => (
        <button
          key={ex.id}
          type="button"
          onClick={() => onSelect(ex)}
          className="flex w-full items-center gap-2 rounded-lg border border-black/8 bg-white px-3 py-2 text-left text-xs hover:bg-black/3"
        >
          <ChevronRight className="h-3 w-3 text-black/30" />
          {ex.name}
        </button>
      ))}
    </div>
  );
}

function ProgressionEditor({
  label, ids, exercises, onChange,
}: { label: string; ids: string[]; exercises: PTExercise[]; onChange: (v: string[]) => void }) {
  const [query, setQuery] = useState('');
  const matches = query.length >= 2
    ? exercises.filter(
        (e) => e.name.toLowerCase().includes(query.toLowerCase()) && !ids.includes(e.id),
      ).slice(0, 5)
    : [];

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-black/50">{label}</p>
      <div className="mb-2 space-y-1">
        {ids.map((id) => {
          const ex = exercises.find((e) => e.id === id);
          return ex ? (
            <div key={id} className="flex items-center justify-between rounded-lg border border-black/8 bg-white px-3 py-1.5 text-xs">
              {ex.name}
              <button type="button" onClick={() => onChange(ids.filter((i) => i !== id))} className="text-black/30 hover:text-black">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null;
        })}
      </div>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Link an exercise..."
          className="w-full rounded-lg border border-black/12 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
        />
        {matches.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-black/10 bg-white shadow-lg">
            {matches.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange([...ids, ex.id]);
                  setQuery('');
                }}
                className="flex w-full items-center px-3 py-2 text-left text-xs hover:bg-black/5"
              >
                {ex.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
