'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Pencil, Search, Upload, Video, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { fetchAllPTExercises } from '@/utils/pt/exercise-library';
import { searchExerciseLibrary } from '@/utils/pt/exercise-search';
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

export default function PTExercisesView({ initialExercises }: Props) {
  const supabase = createClient();
  const [exercises, setExercises] = useState<PTExercise[]>(initialExercises);
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('');
  const [equipFilter, setEquipFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [videoFilter, setVideoFilter] = useState('');
  const [selected, setSelected] = useState<PTExercise | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<PTExercise>>({});
  const [saving, setSaving] = useState(false);
  const [findingVideo, setFindingVideo] = useState(false);
  const [findingMissingVideos, setFindingMissingVideos] = useState(false);
  const [videoBatchStatus, setVideoBatchStatus] = useState('');
  const [flashMsg, setFlashMsg] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSetupCues, setShowSetupCues] = useState(false);
  const [showCues, setShowCues] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState('');
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; exercises: string[] } | null>(null);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  function flash(msg: string) {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(''), 4000);
  }

  async function readFile(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      setImportError('File too large — maximum 20 MB');
      return;
    }
    const allowed = ['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/csv', ''];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const allowedExts = ['pdf', 'txt', 'csv', 'md', 'tsv'];
    if (!allowedExts.includes(ext) && !allowed.includes(file.type)) {
      setImportError('Unsupported file type — use .pdf, .txt, .csv, or .md');
      return;
    }
    setImportError('');
    setImportResult(null);
    setImportStage('');
    setImportFileName(file.name);
    try {
      if (file.type.includes('pdf') || ext === 'pdf') {
        setImportStage('Extracting text from PDF...');
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/pt/parse-pdf', { method: 'POST', body: form });
        const result = await res.json() as { text?: string; error?: string };
        if (!res.ok || result.error) {
          setImportText('');
          setImportError(result.error ?? 'PDF parse failed');
          return;
        }
        setImportText(result.text ?? '');
        setImportStage('');
        return;
      }
      setImportText(await file.text());
      setImportFileName(file.name);
    } catch (err) {
      setImportText('');
      setImportError(`Could not read file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportStage('');
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  }, []);

  function resetImport() {
    setImportText('');
    setImportFileName('');
    setImportResult(null);
    setImportError('');
    setImportStage('');
    setImporting(false);
  }

  async function runImport() {
    if (!importText.trim()) { setImportError('Paste text or upload a file first'); return; }
    setImporting(true);
    setImportError('');
    setImportResult(null);
    setImportStage('Analysing document with AI…');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      setImportStage('Extracting exercises — this may take 30–60 seconds for large documents…');
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/import-exercises`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ document_text: importText }),
      });
      const result = await res.json();
      if (!res.ok) {
        setImportError(result.error ?? 'Import failed');
        setImporting(false);
        setImportStage('');
        return;
      }
      setImportResult(result);
      setImportStage('');
      if (result.added > 0) {
        setExercises(await fetchAllPTExercises(supabase));
        flash(`${result.added} new exercises added to the library`);
      }
    } catch (err) {
      setImportError(String(err));
    }
    setImporting(false);
  }

  const searchedExercises = search.trim()
    ? searchExerciseLibrary(exercises, search, exercises.length)
    : exercises;
  const filtered = searchedExercises.filter((ex) => {
    if (muscleFilter && !ex.primary_muscles.some((m) => m.toLowerCase().includes(muscleFilter.toLowerCase())) &&
        !ex.secondary_muscles.some((m) => m.toLowerCase().includes(muscleFilter.toLowerCase()))) return false;
    if (equipFilter && (ex.equipment ?? '').toLowerCase() !== equipFilter.toLowerCase()) return false;
    if (tagFilter && !ex.tags.some((t) => t.toLowerCase().includes(tagFilter.toLowerCase()))) return false;
    if (videoFilter === 'missing' && ex.video_url?.trim()) return false;
    return true;
  });
  const missingVideoExercises = exercises.filter((ex) => !ex.video_url?.trim());
  const missingVideoCount = missingVideoExercises.length;

  function openExercise(ex: PTExercise) {
    setSelected(ex);
    setEditing(false);
    setDraft({});
    setShowSetupCues(false);
    setShowCues(false);
  }

  useEffect(() => {
    detailPanelRef.current?.scrollTo({ top: 0 });
  }, [selected?.id]);

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

  async function findMissingVideos() {
    if (findingMissingVideos || missingVideoCount === 0) return;
    setFindingMissingVideos(true);
    setVideoBatchStatus(`0/${missingVideoCount}`);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      let populated = 0;
      const missing: string[] = [];
      const batchSize = 25;

      for (let start = 0; start < missingVideoExercises.length; start += batchSize) {
        const batch = missingVideoExercises.slice(start, start + batchSize);
        setVideoBatchStatus(`${Math.min(start + batch.length, missingVideoCount)}/${missingVideoCount}`);
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/search-exercise-videos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ exercise_ids: batch.map((ex) => ex.id) }),
        });
        const result = await res.json();
        if (!res.ok || result.error) throw new Error(result.error ?? 'Video search failed');
        populated += Number(result.populated ?? 0);
        if (Array.isArray(result.missing)) missing.push(...result.missing);
      }

      const nextExercises = await fetchAllPTExercises(supabase);
      setExercises(nextExercises);
      const updatedSelected = selected ? nextExercises.find((ex) => ex.id === selected.id) : null;
      if (updatedSelected) {
        setSelected(updatedSelected);
        if (editing) setDraft((d) => ({ ...d, video_url: updatedSelected.video_url }));
      }

      flash(`Found ${populated} video${populated === 1 ? '' : 's'}${missing.length ? `, ${missing.length} still missing` : ''}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Video search failed');
    } finally {
      setFindingMissingVideos(false);
      setVideoBatchStatus('');
    }
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
          <button
            type="button"
            onClick={() => { setShowImport(true); resetImport(); }}
            className="exercise-import-button no-glass flex items-center gap-1.5 rounded-lg border border-black bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-black hover:text-white"
          >
            <Upload className="h-3.5 w-3.5" />
            Import exercises
          </button>
          <button
            type="button"
            onClick={findMissingVideos}
            disabled={findingMissingVideos || missingVideoCount === 0}
            className="no-glass flex items-center gap-1.5 rounded-lg border border-black/12 bg-white px-3 py-1.5 text-xs font-medium text-black hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-40"
            title={missingVideoCount === 0 ? 'Every exercise already has a video' : `Find videos for ${missingVideoCount} exercise${missingVideoCount === 1 ? '' : 's'}`}
          >
            <Video className="h-3.5 w-3.5" />
            {findingMissingVideos ? `Finding ${videoBatchStatus || 'videos'}...` : `Find missing videos${missingVideoCount ? ` (${missingVideoCount})` : ''}`}
          </button>
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
          <select
            value={videoFilter}
            onChange={(e) => setVideoFilter(e.target.value)}
            className="h-8 rounded-lg border border-black/12 bg-white px-2 text-xs outline-none focus:border-black/30"
          >
            <option value="">All video statuses</option>
            <option value="missing">Missing video URL</option>
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Exercise Grid */}
        <div className={`flex-1 overflow-y-auto p-4 ${selected ? 'hidden md:block md:pr-[26rem] lg:pr-[30rem]' : ''}`}>
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
                    className={`exercise-library-tile group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 active:scale-[0.96] ${
                      isActive
                        ? 'exercise-library-tile-active border-emerald-500 ring-2 ring-emerald-500 ring-offset-1 bg-emerald-50 shadow-[0_14px_34px_-12px_rgba(16,185,129,0.7)] scale-[0.97]'
                        : 'border-black/10 bg-white hover:border-black/25 hover:shadow-sm'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    )}
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
          <div ref={detailPanelRef} className="fixed inset-x-3 top-3 bottom-3 z-40 flex w-auto flex-col overflow-y-auto rounded-xl border border-black/12 bg-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] md:inset-x-auto md:right-3 md:w-96 lg:w-[28rem]">
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
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
          <div className="exercise-import-modal no-glass flex w-full max-w-xl flex-col rounded-2xl border border-black/10 bg-[#f7f4ef] shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-black/8 px-6 py-4">
              <div>
                <h2 className="text-sm font-semibold text-black">Import exercises from document</h2>
                <p className="text-xs text-black/60">Upload a .pdf, .txt, .csv, or .md file — or paste content directly</p>
              </div>
              <button type="button" onClick={() => setShowImport(false)} className="text-black/45 hover:text-black">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {!importResult ? (
                <>
                  {/* Drop zone */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
                      dragOver ? 'border-black/45 bg-white' : 'border-black/18 bg-[#fbfaf7] hover:border-black/35 hover:bg-white'
                    }`}
                  >
                    <Upload className="h-6 w-6 text-black/45" />
                    {importFileName ? (
                      <p className="text-sm font-medium text-black">{importFileName}</p>
                    ) : (
                      <p className="text-sm text-black/65">Drop your file here or <span className="font-medium text-black">click to browse</span></p>
                    )}
                    <p className="text-xs text-black/45">.pdf · .txt · .csv · .md — max 20 MB</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.csv,.md,.tsv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }}
                    />
                  </div>

                  {/* Paste fallback */}
                  {!importFileName && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-black/60">Or paste document text</p>
                      <textarea
                        value={importText}
                        onChange={(e) => { setImportText(e.target.value); setImportFileName(''); }}
                        placeholder="Paste your exercise list here…"
                        rows={6}
                        className="w-full resize-none rounded-xl border border-black/15 bg-white px-3 py-2.5 text-xs text-black outline-none placeholder:text-black/35 focus:border-black/40"
                      />
                    </div>
                  )}

                  {importFileName && importText && (
                    <p className="text-xs text-black/60">
                      {(importText.length / 1000).toFixed(0)} KB loaded · ready to import
                    </p>
                  )}

                  {importError && (
                    <p className="rounded-lg border border-red-200 bg-[#fff1f1] px-3 py-2 text-xs font-medium text-red-800">{importError}</p>
                  )}

                  {importStage && (
                    <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2.5">
                      <svg className="h-3.5 w-3.5 animate-spin text-black/55" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      <p className="text-xs text-black/70">{importStage}</p>
                    </div>
                  )}
                </>
              ) : (
                /* Results */
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 rounded-xl bg-emerald-50 px-4 py-3 text-center">
                      <p className="text-2xl font-semibold text-emerald-700">{importResult.added}</p>
                      <p className="text-xs text-emerald-600">exercises added</p>
                    </div>
                    <div className="flex-1 rounded-xl bg-black/4 px-4 py-3 text-center">
                      <p className="text-2xl font-semibold text-black/60">{importResult.skipped}</p>
                      <p className="text-xs text-black/40">already existed</p>
                    </div>
                  </div>
                  {importResult.exercises.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-black/8 bg-white px-4 py-3">
                      <p className="mb-2 text-xs font-medium text-black/50">Added exercises</p>
                      <ul className="space-y-1">
                        {importResult.exercises.map((name) => (
                          <li key={name} className="text-xs text-black/70">{name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-black/8 px-6 py-4">
              {importResult ? (
                <>
                  <button type="button" onClick={resetImport} className="rounded-lg border border-black/12 px-4 py-2 text-xs hover:bg-black/5">
                    Import another
                  </button>
                  <button type="button" onClick={() => setShowImport(false)} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white">
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setShowImport(false)} className="rounded-lg border border-black/12 px-4 py-2 text-xs hover:bg-black/5">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={runImport}
                    disabled={importing || !importText.trim()}
                    className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {importing ? 'Importing…' : 'Start import'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
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
    ? searchExerciseLibrary(exercises.filter((e) => !ids.includes(e.id)), query, 5)
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
          <div className="no-glass absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-black/10 bg-white shadow-lg">
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
