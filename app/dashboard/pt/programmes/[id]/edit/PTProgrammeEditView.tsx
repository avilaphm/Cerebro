'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import {
  makeId, exerciseFromLibrary, countProgrammeWeeks, parseWeekBlocks, formatWeekBlocks,
} from '@/utils/pt/programme';
import type {
  PTExercise, PTProgramme, PTProgrammePhase, PTProgrammeDay, PTProgrammeExercise, PTProgramAssignment,
} from '@/utils/pt/types';

interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
}
function getSR() {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function PTProgrammeEditView({
  assignment: initial,
  exercises,
}: {
  assignment: PTProgramAssignment;
  exercises: PTExercise[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const client = initial.pt_clients as { name: string; email: string } | null;
  const [programme, setProgramme] = useState<PTProgramme>(initial.programme);
  const [progName, setProgName] = useState(initial.name);
  const [progGoal, setProgGoal] = useState(initial.goal ?? '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const [editingPhase, setEditingPhase] = useState<number | null>(null);
  const [activePhaseTab, setActivePhaseTab] = useState(0);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [weekBlocksInput, setWeekBlocksInput] = useState<Record<number, string>>({});
  const [listeningForPhase, setListeningForPhase] = useState<number | null>(null);

  const update = (fn: (p: PTProgramme) => PTProgramme) =>
    setProgramme((cur) => fn(structuredClone(cur)));

  const patchPhase = (i: number, patch: Partial<PTProgrammePhase>) => update((p) => {
    p.phases[i] = { ...p.phases[i], ...patch }; return p;
  });

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

  const addExerciseFromLibrary = (pi: number, di: number, ex: PTExercise) => update((p) => {
    p.phases[pi].days[di].exercises.push(exerciseFromLibrary(ex)); return p;
  });

  const addBlankExercise = (pi: number, di: number) => update((p) => {
    p.phases[pi].days[di].exercises.push({
      id: makeId('ex'), exercise_id: null, name: '', sets: '3', reps: '8-12', rest: '60 sec', notes: '', video_url: null, cues: [],
    }); return p;
  });

  const patchExercise = (pi: number, di: number, ei: number, patch: Partial<PTProgrammeExercise>) => update((p) => {
    p.phases[pi].days[di].exercises[ei] = { ...p.phases[pi].days[di].exercises[ei], ...patch }; return p;
  });

  const removeExercise = (pi: number, di: number, ei: number) => update((p) => {
    p.phases[pi].days[di].exercises.splice(ei, 1); return p;
  });

  const dropExercise = (pi: number, di: number, targetIdx: number) => {
    if (dragged === null || dragged === targetIdx) return;
    update((p) => {
      const exs = p.phases[pi].days[di].exercises;
      const [item] = exs.splice(dragged, 1);
      exs.splice(targetIdx, 0, item);
      return p;
    });
    setDragged(null);
  };

  const startDictationForPhase = (phaseIdx: number) => {
    const SR = getSR();
    if (!SR) return;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'en-AU';
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result?.isFinal) {
          const transcript = result[0]?.transcript ?? '';
          if (transcript) {
            setWeekBlocksInput((cur) => {
              const next = (cur[phaseIdx] ? `${cur[phaseIdx]} ${transcript}` : transcript).trim();
              const parsed = parseWeekBlocks(next);
              if (parsed.length > 0) patchPhase(phaseIdx, { week_blocks: parsed });
              return { ...cur, [phaseIdx]: next };
            });
          }
        }
      }
    };
    r.onend = () => setListeningForPhase(null);
    r.start(); setListeningForPhase(phaseIdx);
  };

  const save = async () => {
    setSaving(true);
    setStatus('Saving…');
    const { error } = await supabase
      .from('pt_program_assignments')
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
      setTimeout(() => router.push(`/dashboard/pt/clients/${initial.client_id}`), 800);
    }
  };

  const phase = programme.phases[activePhaseTab] ?? null;
  const currentDay = phase && activeDay !== null ? phase.days[activeDay] ?? null : null;

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/dashboard/pt/clients/${initial.client_id}`} className="text-black/30 hover:text-black text-sm transition-colors">
          ← {client?.name ?? 'Client'}
        </Link>
        <span className="text-black/20">/</span>
        <span className="text-sm text-black/50">Edit programme</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
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
        <div className="flex items-center gap-3">
          {status && <span className="text-xs text-black/40">{status}</span>}
          <button
            onClick={() => void save()}
            disabled={saving || !progName.trim()}
            className="border border-black bg-black text-white px-5 py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="mb-8">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Phases</p>
        <div className="space-y-3">
          {programme.phases.map((ph, i) => (
            <div key={ph.id}>
              {editingPhase === i ? (
                <div className="border border-black/20 p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
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
                      Progressive overload — sets per block
                    </label>
                    <p className="text-[0.6rem] text-black/30 mb-2">e.g. "2 sets for 2 weeks, 3 sets for 3 weeks, 4 sets for 4 weeks"</p>
                    <div className="flex gap-2">
                      <input
                        value={weekBlocksInput[i] ?? formatWeekBlocks(ph.week_blocks)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setWeekBlocksInput((cur) => ({ ...cur, [i]: val }));
                          const parsed = parseWeekBlocks(val);
                          if (parsed.length > 0) patchPhase(i, { week_blocks: parsed });
                          else if (val === '') patchPhase(i, { week_blocks: undefined });
                        }}
                        placeholder="2 sets for 2 weeks, 3 sets for 3 weeks…"
                        className="flex-1 border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40"
                      />
                      <button
                        type="button"
                        onClick={() => startDictationForPhase(i)}
                        className={`border px-3 py-2 text-xs transition-colors ${listeningForPhase === i ? 'bg-red-50 border-red-300 text-red-600' : 'border-black/15 hover:border-black/30'}`}
                      >
                        {listeningForPhase === i ? '● Listening' : 'Voice'}
                      </button>
                    </div>
                    {ph.week_blocks && ph.week_blocks.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {ph.week_blocks.map((block, bi) => (
                          <span key={bi} className="flex items-center gap-1">
                            <span className="border border-black/15 bg-black/3 px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.1em]">
                              {block.sets} sets · {block.weeks}w
                            </span>
                            {bi < (ph.week_blocks?.length ?? 0) - 1 && (
                              <span className="text-black/25 text-xs">→</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setEditingPhase(null)} className="text-xs border border-black/15 px-4 py-1.5 hover:bg-black/5">Done</button>
                </div>
              ) : (
                <div className="border border-black/10 px-5 py-4 flex items-center justify-between hover:border-black/25 transition-colors">
                  <button type="button" className="flex-1 text-left" onClick={() => setEditingPhase(i)}>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.55rem] text-black/30">☰</span>
                      <p className="font-medium text-sm">{ph.title || `Phase ${i + 1}`}</p>
                    </div>
                    <p className="text-xs text-black/40 mt-0.5">
                      {ph.weeks ? `${ph.weeks} weeks` : 'Duration not set'}{ph.focus ? ` · ${ph.focus}` : ''}
                    </p>
                    {ph.week_blocks && ph.week_blocks.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {ph.week_blocks.map((block, bi) => (
                          <span key={bi} className="flex items-center gap-1">
                            <span className="text-[0.55rem] text-black/40 border border-black/10 px-1.5 py-0.5">
                              {block.sets} sets · {block.weeks}w
                            </span>
                            {bi < (ph.week_blocks?.length ?? 0) - 1 && (
                              <span className="text-black/20 text-[0.6rem]">→</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                  <div className="flex items-center gap-3 ml-4">
                    <button type="button" onClick={() => setEditingPhase(i)}
                      className="text-xs text-black/40 hover:text-black border border-black/15 px-3 py-1 hover:bg-black/5 transition-colors">Edit</button>
                    <button type="button" onClick={() => removePhase(i)}
                      className="text-xs text-red-400 hover:text-red-600">Remove</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <button onClick={addPhase} className="mt-3 border border-black/15 border-dashed px-5 py-3 text-sm text-black/40 hover:border-black/30 hover:text-black transition-colors w-full text-center">
          + Add phase
        </button>
      </div>

      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Workouts</p>
        <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
          {programme.phases.map((ph, i) => (
            <button
              key={ph.id}
              type="button"
              onClick={() => { setActivePhaseTab(i); setActiveDay(null); }}
              className={`shrink-0 px-4 py-2 text-xs border transition-colors ${
                activePhaseTab === i ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black/30'
              }`}
            >
              {ph.title || `Phase ${i + 1}`}
            </button>
          ))}
        </div>

        {phase && (
          currentDay === null ? (
            <div className="space-y-3">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">
                {phase.title} — select a day to edit
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {phase.days.map((day, di) => (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => setActiveDay(di)}
                    className="border border-black/10 p-5 text-left hover:border-black/30 hover:shadow-sm transition-all"
                  >
                    <p className="font-medium text-sm">{day.title || `Day ${di + 1}`}</p>
                    <p className="text-xs text-black/40 mt-0.5">{day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}</p>
                    {day.focus && <p className="text-xs text-black/30 mt-1 truncate">{day.focus}</p>}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { addDay(activePhaseTab); setActiveDay(phase.days.length); }}
                  className="border border-black/10 border-dashed p-5 text-center text-sm text-black/30 hover:border-black/25 hover:text-black/50 transition-colors"
                >
                  + Add day
                </button>
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

                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Exercises</p>
                    <div className="flex items-center gap-2">
                      <select
                        className="border border-black/10 px-3 py-1.5 text-xs outline-none"
                        defaultValue=""
                        onChange={(e) => {
                          const ex = exercises.find((x) => x.id === e.target.value);
                          if (ex) addExerciseFromLibrary(activePhaseTab, activeDay, ex);
                          e.target.value = '';
                        }}
                      >
                        <option value="">+ From library</option>
                        {exercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>{ex.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addBlankExercise(activePhaseTab, activeDay)}
                        className="border border-black/10 px-3 py-1.5 text-xs hover:border-black/30"
                      >
                        + Custom
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {currentDay.exercises.map((ex, ei) => (
                      <div
                        key={ex.id}
                        draggable
                        onDragStart={() => setDragged(ei)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => dropExercise(activePhaseTab, activeDay, ei)}
                        className="border border-black/10 bg-[#fafaf8] p-4 cursor-grab active:cursor-grabbing"
                      >
                        <div className="grid grid-cols-[1.5rem_1fr_4rem_5rem_5rem_5rem_1.5rem] gap-2 items-center">
                          <span className="text-black/20 text-sm select-none">⠿</span>
                          <input
                            value={ex.name}
                            onChange={(e) => patchExercise(activePhaseTab, activeDay, ei, { name: e.target.value })}
                            placeholder="Exercise name"
                            className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30"
                          />
                          <input
                            value={ex.sets}
                            onChange={(e) => patchExercise(activePhaseTab, activeDay, ei, { sets: e.target.value })}
                            placeholder="Sets"
                            className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 text-center"
                          />
                          <input
                            value={ex.reps}
                            onChange={(e) => patchExercise(activePhaseTab, activeDay, ei, { reps: e.target.value })}
                            placeholder="Reps"
                            className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 text-center"
                          />
                          <input
                            value={ex.rest}
                            onChange={(e) => patchExercise(activePhaseTab, activeDay, ei, { rest: e.target.value })}
                            placeholder="Rest"
                            className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 text-center"
                          />
                          <input
                            value={ex.notes}
                            onChange={(e) => patchExercise(activePhaseTab, activeDay, ei, { notes: e.target.value })}
                            placeholder="Notes"
                            className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30"
                          />
                          <button
                            type="button"
                            onClick={() => removeExercise(activePhaseTab, activeDay, ei)}
                            className="text-black/20 hover:text-red-500 transition-colors text-sm"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                    {currentDay.exercises.length === 0 && (
                      <p className="text-xs text-black/30 py-4 text-center border border-black/8 border-dashed">
                        No exercises yet.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
