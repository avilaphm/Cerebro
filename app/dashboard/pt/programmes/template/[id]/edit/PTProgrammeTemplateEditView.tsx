'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { makeId, countProgrammeWeeks, parseWeekBlocks, formatWeekBlocks, getPhaseStartWeeks, moveExerciseBetweenProgrammeDays, groupBands } from '@/utils/pt/programme';
import { patternChipClass, resolvePattern } from '@/utils/pt/patterns';
import type {
  PTExercise, PTProgramme, PTProgrammePhase, PTProgrammeDay, PTProgramTemplate, PTProgrammeExercise,
} from '@/utils/pt/types';
import PTDayEditor from '../../../PTDayEditor';

interface SpeechRecognitionResultItemLike { transcript: string; }
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultItemLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSR() {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function PTProgrammeTemplateEditView({
  template: initial,
  exercises,
}: {
  template: PTProgramTemplate;
  exercises: PTExercise[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [programme, setProgramme] = useState<PTProgramme>(initial.programme);
  const [progName, setProgName] = useState(initial.name);
  const [progGoal, setProgGoal] = useState(initial.goal ?? '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const [editingPhase, setEditingPhase] = useState<number | null>(null);
  const [activePhaseTab, setActivePhaseTab] = useState(0);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [boardView, setBoardView] = useState(false);
  const [dragEx, setDragEx] = useState<{ dayIndex: number; exId: string } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [boardEditExId, setBoardEditExId] = useState<string | null>(null);
  const libById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const [weekBlocksInput, setWeekBlocksInput] = useState<Record<number, string>>({});
  const [listeningForPhase, setListeningForPhase] = useState<number | null>(null);
  const srPhaseRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef('');

  const update = (fn: (p: PTProgramme) => PTProgramme) =>
    setProgramme((cur) => fn(structuredClone(cur)));

  const patchPhase = (i: number, patch: Partial<PTProgrammePhase>) => update((p) => {
    p.phases[i] = { ...p.phases[i], ...patch }; return p;
  });

  const applyWeekBlocksInput = (phaseIdx: number) => {
    const val = weekBlocksInput[phaseIdx] ?? formatWeekBlocks(programme.phases[phaseIdx]?.week_blocks);
    const parsed = parseWeekBlocks(val);
    if (parsed.length > 0) {
      const totalWeeks = parsed.reduce((sum, b) => sum + b.weeks, 0);
      patchPhase(phaseIdx, { week_blocks: parsed, weeks: String(totalWeeks) });
    } else if (val.trim() === '') {
      patchPhase(phaseIdx, { week_blocks: undefined });
    }
  };

  const addPhase = () => update((p) => {
    p.phases.push({ id: makeId('phase'), title: `Phase ${p.phases.length + 1}`, focus: '', weeks: '4', progression: '', days: [] });
    return p;
  });

  const removePhase = (i: number) => update((p) => { p.phases.splice(i, 1); return p; });

  const addDay = (phaseIdx: number) => update((p) => {
    const ph = p.phases[phaseIdx];
    ph.days.push({ id: makeId('day'), title: `Day ${ph.days.length + 1}`, focus: '', exercises: [] });
    return p;
  });

  const patchDay = (pi: number, di: number, patch: Partial<PTProgrammeDay>) => update((p) => {
    p.phases[pi].days[di] = { ...p.phases[pi].days[di], ...patch }; return p;
  });

  const moveExerciseToDay = (fromDay: number, exId: string, toDay: number, beforeExId?: string) =>
    update((p) => {
      const ph = p.phases[activePhaseTab];
      if (!ph) return p;
      p.phases[activePhaseTab] = moveExerciseBetweenProgrammeDays(ph, fromDay, exId, toDay, beforeExId);
      return p;
    });

  const getBoardMatches = (name: string) =>
    name.length >= 2 ? exercises.filter((e) => e.name.toLowerCase().includes(name.toLowerCase())).slice(0, 6) : [];

  const patchBoardExercise = (pi: number, di: number, exId: string, patch: Partial<PTProgrammeExercise>) =>
    update((p) => {
      const day = p.phases[pi].days[di];
      day.exercises = day.exercises.map((ex) => (ex.id === exId ? { ...ex, ...patch } : ex));
      return p;
    });

  const deleteBoardExercise = (pi: number, di: number, exId: string) =>
    update((p) => {
      const exs = p.phases[pi].days[di].exercises;
      let current = '';
      const resolved = exs.map((ex) => {
        if (ex.section_start !== undefined) current = ex.section_start || '';
        return { ex, section: current };
      });
      const filtered = resolved.filter(({ ex }) => ex.id !== exId);
      let prevSection: string | null = null;
      const rebuilt = filtered.map(({ ex, section }) => {
        const firstInSection = section !== prevSection;
        prevSection = section;
        return { ...ex, section_start: firstInSection && section ? section : undefined };
      });
      p.phases[pi].days[di] = { ...p.phases[pi].days[di], exercises: rebuilt };
      return p;
    });

  const toggleSelectMode = () => {
    setSelectMode((v) => { if (v) setSelectedDays(new Set()); return !v; });
  };

  const toggleDaySelection = (di: number) => {
    setSelectedDays((cur) => {
      const next = new Set(cur);
      if (next.has(di)) next.delete(di); else next.add(di);
      return next;
    });
  };

  const deleteSelectedDays = () => {
    const hadActive = activeDay !== null && selectedDays.has(activeDay);
    const indices = Array.from(selectedDays).sort((a, b) => b - a);
    update((p) => { indices.forEach((di) => { p.phases[activePhaseTab].days.splice(di, 1); }); return p; });
    setSelectedDays(new Set());
    setSelectMode(false);
    if (hadActive) setActiveDay(null);
  };

  const startDictationForPhase = (phaseIdx: number) => {
    const SR = getSR();
    if (!SR) return;
    voiceTranscriptRef.current = weekBlocksInput[phaseIdx] ?? formatWeekBlocks(programme.phases[phaseIdx]?.week_blocks);
    const r = new SR();
    srPhaseRef.current = r;
    r.continuous = true; r.interimResults = false; r.lang = 'en-AU';
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result?.isFinal) {
          const t = result[0]?.transcript ?? '';
          if (t) voiceTranscriptRef.current = (voiceTranscriptRef.current + ' ' + t).trim();
        }
      }
      setWeekBlocksInput((cur) => ({ ...cur, [phaseIdx]: voiceTranscriptRef.current }));
    };
    r.onend = () => { setListeningForPhase(null); srPhaseRef.current = null; };
    r.start(); setListeningForPhase(phaseIdx);
  };

  const stopPhraseDictation = () => {
    srPhaseRef.current?.stop();
    if (listeningForPhase === null) return;
    const parsed = parseWeekBlocks(voiceTranscriptRef.current);
    if (parsed.length > 0) {
      const totalWeeks = parsed.reduce((sum, b) => sum + b.weeks, 0);
      patchPhase(listeningForPhase, { week_blocks: parsed, weeks: String(totalWeeks) });
    }
  };

  const save = async () => {
    setSaving(true);
    setStatus('Saving…');
    const { error } = await supabase
      .from('pt_program_templates')
      .update({
        name: progName.trim(),
        goal: progGoal.trim() || null,
        duration_weeks: countProgrammeWeeks(programme),
        phase_count: programme.phases.length,
        programme,
      })
      .eq('id', initial.id);
    if (error) {
      setStatus(`Error: ${error.message}`);
      setSaving(false);
    } else {
      setStatus('Saved.');
      setTimeout(() => router.push(`/dashboard/pt/programmes/template/${initial.id}`), 600);
    }
  };

  const phase = programme.phases[activePhaseTab] ?? null;
  const currentDay = phase && activeDay !== null ? phase.days[activeDay] ?? null : null;

  return (
    <div className={`${boardView ? 'max-w-7xl' : 'max-w-4xl'} px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10`}>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link href={`/dashboard/pt/programmes/template/${initial.id}`} className="text-black/30 hover:text-black text-sm transition-colors">
          ← {initial.name}
        </Link>
        <span className="text-black/20">/</span>
        <span className="text-sm text-black/50">Edit template</span>
      </div>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <input
            value={progName}
            onChange={(e) => setProgName(e.target.value)}
            className="font-display text-2xl font-light border-b border-black/20 outline-none bg-transparent mb-2 block"
          />
          <input
            value={progGoal}
            onChange={(e) => setProgGoal(e.target.value)}
            placeholder="Goal (optional)"
            className="text-sm text-black/50 border-b border-black/10 outline-none bg-transparent block"
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {status && <span className="text-xs text-black/40">{status}</span>}
          <button
            onClick={() => void save()}
            disabled={saving || !progName.trim()}
            className="border border-black bg-black px-5 py-3 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-30 sm:py-2.5"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      {/* Phases */}
      <div className="mb-8">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Phases</p>
        <div className="space-y-3">
          {programme.phases.map((ph, i) => {
            const startWeek = getPhaseStartWeeks(programme.phases)[i] ?? 1;
            return (
              <div key={ph.id}>
                {editingPhase === i ? (
                  <div className="border border-black/20 p-5 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Phase name</label>
                        <input value={ph.title} onChange={(e) => patchPhase(i, { title: e.target.value })}
                          className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
                      </div>
                      <div>
                        <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Duration (weeks)</label>
                        <input value={ph.weeks} onChange={(e) => patchPhase(i, { weeks: e.target.value })}
                          className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Focus</label>
                      <input value={ph.focus} onChange={(e) => patchPhase(i, { focus: e.target.value })}
                        className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
                    </div>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Progression notes</label>
                      <input value={ph.progression} onChange={(e) => patchPhase(i, { progression: e.target.value })}
                        className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
                    </div>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">
                        Progressive overload — sets or % per block
                      </label>
                      <p className="text-[0.6rem] text-black/30 mb-2">e.g. &quot;2 sets for 2 weeks...&quot; or &quot;75% for 1 week, 85% for 3 weeks&quot;</p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          value={weekBlocksInput[i] ?? formatWeekBlocks(ph.week_blocks)}
                          onChange={(e) => {
                            const val = e.target.value;
                            setWeekBlocksInput((cur) => ({ ...cur, [i]: val }));
                            const parsed = parseWeekBlocks(val);
                            if (parsed.length > 0) {
                              const totalWeeks = parsed.reduce((sum, b) => sum + b.weeks, 0);
                              patchPhase(i, { week_blocks: parsed, weeks: String(totalWeeks) });
                            } else if (val === '') {
                              patchPhase(i, { week_blocks: undefined });
                            }
                          }}
                          placeholder="2 sets for 2 weeks... or 75% for 1 week..."
                          className="flex-1 border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40"
                        />
                        {listeningForPhase === i ? (
                          <div className="flex gap-1">
                            <span className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">● Recording</span>
                            <button type="button" onClick={stopPhraseDictation}
                              className="border border-black bg-black text-white px-3 py-2 text-xs hover:bg-white hover:text-black transition-colors">
                              Done
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => startDictationForPhase(i)}
                            className="border border-black/15 px-3 py-2 text-xs hover:border-black/30 transition-colors">
                            Voice
                          </button>
                        )}
                      </div>
                      {ph.week_blocks && ph.week_blocks.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {ph.week_blocks.map((block, bi) => (
                            <span key={bi} className="flex items-center gap-1">
                              <span className="border border-black/15 bg-black/3 px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.1em]">
                                {block.sets ? `${block.sets} sets` : block.weight_pct} · {block.weeks}w
                              </span>
                              {bi < (ph.week_blocks?.length ?? 0) - 1 && (
                                <span className="text-black/25 text-xs">→</span>
                              )}
                            </span>
                          ))}
                          <span className="text-[0.6rem] text-black/30 ml-1">= {ph.weeks}w total</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { applyWeekBlocksInput(i); setEditingPhase(null); }}
                      className="text-xs border border-black/15 px-4 py-1.5 hover:bg-black/5"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 border border-black/10 px-4 py-4 transition-colors hover:border-black/25 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <button type="button" className="flex-1 text-left" onClick={() => setEditingPhase(i)}>
                      <div className="flex items-center gap-2">
                        <span className="text-[0.55rem] text-black/30">☰</span>
                        <p className="font-medium text-sm">{ph.title || `Phase ${i + 1}`}</p>
                        <span className="text-[0.55rem] text-black/25 ml-auto">starts week {startWeek}</span>
                      </div>
                      <p className="text-xs text-black/40 mt-0.5">
                        {ph.weeks ? `${ph.weeks} weeks` : 'Duration not set'}{ph.focus ? ` · ${ph.focus}` : ''}
                      </p>
                      {ph.week_blocks && ph.week_blocks.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {ph.week_blocks.map((block, bi) => (
                            <span key={bi} className="flex items-center gap-1">
                              <span className="text-[0.55rem] text-black/40 border border-black/10 px-1.5 py-0.5">
                                {block.sets ? `${block.sets} sets` : block.weight_pct} · {block.weeks}w
                              </span>
                              {bi < (ph.week_blocks?.length ?? 0) - 1 && (
                                <span className="text-black/20 text-[0.6rem]">→</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                    <div className="flex flex-wrap items-center gap-3 sm:ml-4">
                      <button type="button" onClick={() => setEditingPhase(i)}
                        className="text-xs text-black/40 hover:text-black border border-black/15 px-3 py-1 hover:bg-black/5 transition-colors">Edit</button>
                      <button type="button" onClick={() => removePhase(i)}
                        className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={addPhase} className="mt-3 border border-black/15 border-dashed px-5 py-3 text-sm text-black/40 hover:border-black/30 hover:text-black transition-colors w-full text-center">
          + Add phase
        </button>
      </div>

      {/* Workouts */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Workouts</p>
          {phase && phase.days.length > 0 && (
            <div className="flex items-center gap-2">
              {selectedDays.size > 0 && (
                <button
                  type="button"
                  onClick={deleteSelectedDays}
                  className="border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-100"
                >
                  Delete {selectedDays.size} day{selectedDays.size !== 1 ? 's' : ''}
                </button>
              )}
              <button
                type="button"
                onClick={toggleSelectMode}
                className={`border px-3 py-1.5 text-xs transition-colors ${selectMode ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black/35'}`}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
              <button
                type="button"
                onClick={() => { setBoardView((v) => !v); setActiveDay(null); setSelectedDays(new Set()); setSelectMode(false); }}
                className={`border px-3 py-1.5 text-xs transition-colors ${boardView ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black/35'}`}
              >
                {boardView ? 'List view' : 'Board view'}
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
          {programme.phases.map((ph, i) => (
            <button
              key={ph.id}
              type="button"
              onClick={() => { setActivePhaseTab(i); setActiveDay(null); setSelectedDays(new Set()); setSelectMode(false); }}
              className={`shrink-0 px-4 py-2 text-xs border transition-colors ${
                activePhaseTab === i ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black/30'
              }`}
            >
              {ph.title || `Phase ${i + 1}`}
            </button>
          ))}
        </div>

        {phase && (
          boardView ? (
            <div className="space-y-3">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">
                {phase.title} — drag exercises between days
              </p>
              {(() => {
                const dayBands = phase.days.map((d) => groupBands(d.exercises));
                const maxBands = Math.max(1, ...dayBands.map((b) => b.length));
                return (
              <div
                className="grid gap-x-3"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(phase.days.length, 1)}, minmax(0, 1fr))`,
                  gridTemplateRows: `auto repeat(${maxBands}, auto)`,
                }}
              >
                {phase.days.map((day, di) => (
                  <div
                    key={day.id}
                    onDragOver={(e) => { e.preventDefault(); if (dragOverDay !== di) setDragOverDay(di); }}
                    onDragLeave={() => setDragOverDay((c) => (c === di ? null : c))}
                    onDrop={(e) => { e.preventDefault(); if (dragEx) moveExerciseToDay(dragEx.dayIndex, dragEx.exId, di); setDragEx(null); setDragOverDay(null); }}
                    style={{ gridRow: `1 / span ${maxBands + 1}`, gridTemplateRows: 'subgrid' }}
                    className={`grid rounded-lg border p-2 transition-colors ${
                      selectedDays.has(di) ? 'border-black/35 bg-black/[0.03]' :
                      dragOverDay === di ? 'border-emerald-400 bg-emerald-50/40' :
                      'border-black/10 bg-black/[0.01]'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-1 px-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {selectMode && (
                          <button
                            type="button"
                            onClick={() => toggleDaySelection(di)}
                            className={`shrink-0 h-3.5 w-3.5 border flex items-center justify-center transition-colors ${selectedDays.has(di) ? 'border-black bg-black' : 'border-black/30 hover:border-black/60'}`}
                          >
                            {selectedDays.has(di) && <span className="text-white text-[0.45rem] leading-none">✓</span>}
                          </button>
                        )}
                        <p className="text-xs font-medium leading-tight truncate">{day.title || `Day ${di + 1}`}</p>
                      </div>
                      <button type="button" onClick={() => { setBoardView(false); setActiveDay(di); }} className="shrink-0 text-[0.6rem] text-black/35 hover:text-black">edit</button>
                    </div>
                    {dayBands[di].map((band, bi) => (
                      <div
                        key={band[0].id}
                        className={`flex flex-col gap-1.5 ${bi > 0 ? 'mt-2 border-t border-dashed border-black/15 pt-2' : ''}`}
                      >
                        {band[0].section_start && <p className="px-1 pb-0.5 text-[0.55rem] uppercase tracking-wider text-black/30">{band[0].section_start}</p>}
                        {band.map((ex) => {
                          const isEditing = boardEditExId === ex.id;
                          const boardMatches = isEditing ? getBoardMatches(ex.name) : [];
                          return (
                            <div
                              key={ex.id}
                              draggable={!isEditing}
                              onDragStart={isEditing ? undefined : (e) => { setDragEx({ dayIndex: di, exId: ex.id }); e.dataTransfer.effectAllowed = 'move'; }}
                              onDragEnd={isEditing ? undefined : () => { setDragEx(null); setDragOverDay(null); }}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragEx) moveExerciseToDay(dragEx.dayIndex, dragEx.exId, di, ex.id); setDragEx(null); setDragOverDay(null); }}
                              className={`relative rounded border bg-white px-2 py-1.5 text-[0.7rem] shadow-sm transition ${isEditing ? 'border-black/30' : dragEx?.exId === ex.id ? 'cursor-grab opacity-40 border-black/10' : 'cursor-grab border-black/10 hover:border-black/25'}`}
                            >
                              {isEditing ? (
                                <div onMouseDown={(e) => e.stopPropagation()}>
                                  <div className="flex items-center gap-1">
                                    <div className="relative flex-1">
                                      <input
                                        autoFocus
                                        draggable={false}
                                        value={ex.name}
                                        onChange={(e) => patchBoardExercise(activePhaseTab, di, ex.id, { name: e.target.value, exercise_id: null, video_url: null })}
                                        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setBoardEditExId(null); }}
                                        placeholder="Exercise name"
                                        className="w-full border border-black/20 bg-white px-1.5 py-0.5 text-[0.7rem] outline-none focus:border-black/40"
                                      />
                                      {boardMatches.length > 0 && (
                                        <div className="exercise-autocomplete no-glass absolute left-0 top-full z-30 w-48 border border-black/15 shadow-md max-h-44 overflow-y-auto">
                                          {boardMatches.map((libEx) => (
                                            <button
                                              key={libEx.id}
                                              type="button"
                                              onMouseDown={() => {
                                                patchBoardExercise(activePhaseTab, di, ex.id, {
                                                  exercise_id: libEx.id,
                                                  name: libEx.name,
                                                  video_url: libEx.video_url,
                                                  cues: libEx.cues.slice(0, 4),
                                                });
                                                setBoardEditExId(null);
                                              }}
                                              className="w-full text-left px-2 py-1.5 text-[0.7rem] hover:bg-black/5 flex items-baseline gap-1.5"
                                            >
                                              <span>{libEx.name}</span>
                                              {libEx.muscles.length > 0 && <span className="text-[0.6rem] text-black/30">{libEx.muscles.slice(0, 2).join(', ')}</span>}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteBoardExercise(activePhaseTab, di, ex.id); setBoardEditExId(null); }}
                                      className="shrink-0 text-black/30 hover:text-red-500 leading-none px-0.5"
                                      title="Delete exercise"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  <p className="mt-0.5 text-[0.62rem] text-black/40">{ex.sets}×{ex.reps}{ex.rest ? ` · ${ex.rest}` : ''}</p>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-start gap-1.5 leading-tight">
                                    <p
                                      className="font-medium cursor-text hover:text-black/60"
                                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setBoardEditExId(ex.id); }}
                                    >
                                      {ex.name}
                                    </p>
                                    {(() => {
                                      const p = resolvePattern(ex, libById);
                                      if (!p) return null;
                                      return (
                                        <span className={`mt-px shrink-0 rounded-full px-1.5 text-[0.48rem] font-medium uppercase tracking-wider leading-[1.8] ring-1 ring-inset ${patternChipClass(p)}`}>
                                          {p}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  <p className="mt-0.5 text-[0.62rem] text-black/40">{ex.sets}×{ex.reps}{ex.rest ? ` · ${ex.rest}` : ''}</p>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {day.exercises.length === 0 && (
                      <p className="px-1 py-4 text-center text-[0.62rem] text-black/25">Drop here</p>
                    )}
                  </div>
                ))}
              </div>
                );
              })()}
            </div>
          ) : currentDay === null ? (
            <div className="space-y-3">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">
                {phase.title} — select a day to edit
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {phase.days.map((day, di) => (
                  <div
                    key={day.id}
                    onClick={() => selectMode ? toggleDaySelection(di) : setActiveDay(di)}
                    className={`relative flex cursor-pointer gap-3 border p-5 text-left transition-all ${
                      selectedDays.has(di)
                        ? 'border-black bg-black/[0.03]'
                        : 'border-black/10 hover:border-black/30 hover:shadow-sm'
                    }`}
                  >
                    {selectMode && (
                      <div className={`mt-0.5 h-4 w-4 shrink-0 border-2 flex items-center justify-center transition-colors ${selectedDays.has(di) ? 'border-black bg-black' : 'border-black/25'}`}>
                        {selectedDays.has(di) && <span className="text-white text-[0.5rem] leading-none">✓</span>}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{day.title || `Day ${di + 1}`}</p>
                      <p className="text-xs text-black/40 mt-0.5">{day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}</p>
                      {day.focus && <p className="text-xs text-black/30 mt-1 truncate">{day.focus}</p>}
                    </div>
                  </div>
                ))}
                {!selectMode && (
                  <button
                    type="button"
                    onClick={() => { addDay(activePhaseTab); setActiveDay(phase.days.length); }}
                    className="border border-black/10 border-dashed p-5 text-center text-sm text-black/30 hover:border-black/25 hover:text-black/50 transition-colors"
                  >
                    + Add day
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setActiveDay(null)} className="text-sm text-black/40 hover:text-black mb-4 transition-colors">
                ← Back to {phase.title}
              </button>

              {currentDay && activeDay !== null && (
                <div>
                  <div className="grid sm:grid-cols-2 gap-3 mb-5">
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Day name</label>
                      <input
                        value={currentDay.title}
                        onChange={(e) => patchDay(activePhaseTab, activeDay, { title: e.target.value })}
                        className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Focus</label>
                      <input
                        value={currentDay.focus}
                        onChange={(e) => patchDay(activePhaseTab, activeDay, { focus: e.target.value })}
                        className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40"
                      />
                    </div>
                  </div>

                  <PTDayEditor
                    exercises={currentDay.exercises}
                    libraryExercises={exercises}
                    weekBlocks={phase.week_blocks}
                    onChange={(updated: PTProgrammeExercise[]) => patchDay(activePhaseTab, activeDay, { exercises: updated })}
                  />
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
