'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { makeId, safeProgramme, exerciseFromLibrary, countProgrammeWeeks } from '@/utils/pt/programme';
import type {
  PTClient, PTExercise, PTProgramme, PTProgrammePhase, PTProgrammeDay, PTProgrammeExercise,
} from '@/utils/pt/types';

interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
}
function getSR() {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function PTProgrammeWizard({ clients, exercises }: { clients: PTClient[]; exercises: PTExercise[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [brainDump, setBrainDump] = useState('');
  const [listening, setListening] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');

  const [programme, setProgramme] = useState<PTProgramme>({ phases: [] });
  const [progName, setProgName] = useState('');
  const [progGoal, setProgGoal] = useState('');

  const [editingPhase, setEditingPhase] = useState<number | null>(null);
  const [activePhaseTab, setActivePhaseTab] = useState(0);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  const update = (fn: (p: PTProgramme) => PTProgramme) =>
    setProgramme((cur) => fn(structuredClone(cur)));

  const generateFromDocument = async () => {
    if (!clientId) return;
    setGenerating(true);
    setGenStatus('Reading client profile…');
    const { data, error } = await supabase.functions.invoke('parse-client-document', {
      body: { client_id: clientId },
    });
    if (error || (data as { error?: string })?.error) {
      setGenStatus((data as { error?: string })?.error ?? error?.message ?? 'Failed.');
      setGenerating(false);
      return;
    }
    const parsed = data as { name?: string; goal?: string; programme?: unknown };
    setProgramme(safeProgramme(parsed.programme));
    setProgName(parsed.name ?? '');
    setProgGoal(parsed.goal ?? '');
    setGenStatus('');
    setGenerating(false);
    setStep(2);
  };

  const generateFromDump = async () => {
    if (!brainDump.trim()) return;
    setGenerating(true);
    setGenStatus('Generating programme…');
    const { data, error } = await supabase.functions.invoke('generate-pt-programme', {
      body: { notes: brainDump, exercises: exercises.slice(0, 300) },
    });
    if (error) {
      setGenStatus(error.message);
      setGenerating(false);
      return;
    }
    const parsed = data as { name?: string; goal?: string; programme?: unknown };
    setProgramme(safeProgramme(parsed.programme));
    setProgName(parsed.name ?? '');
    setProgGoal(parsed.goal ?? '');
    setGenStatus('');
    setGenerating(false);
    setStep(2);
  };

  const startDictation = () => {
    const SR = getSR();
    if (!SR) { setGenStatus('Browser dictation not available. Type instead.'); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = false; r.lang = 'en-AU';
    r.onresult = (e) => {
      const newText = Array.from(e.results).slice(e.resultIndex).map((res) => res[0]?.transcript ?? '').join(' ');
      setBrainDump((cur) => (cur ? `${cur} ${newText}` : newText).trim());
    };
    r.onend = () => setListening(false);
    r.start(); setListening(true);
  };

  const addPhase = () => update((p) => {
    p.phases.push({ id: makeId('phase'), title: `Phase ${p.phases.length + 1}`, focus: '', weeks: '4', progression: '', days: [] });
    return p;
  });

  const removePhase = (i: number) => update((p) => { p.phases.splice(i, 1); return p; });

  const patchPhase = (i: number, patch: Partial<PTProgrammePhase>) => update((p) => {
    p.phases[i] = { ...p.phases[i], ...patch }; return p;
  });

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

  const save = async () => {
    if (!progName.trim() || !clientId) return;
    setSaving(true);
    const payload = {
      client_id: clientId,
      name: progName.trim(),
      goal: progGoal.trim() || null,
      duration_weeks: countProgrammeWeeks(programme),
      phase_count: programme.phases.length,
      status: 'active',
      programme,
    };
    const { error } = await supabase.from('pt_program_assignments').insert(payload);
    if (!error) {
      await supabase.from('pt_events').insert({
        client_id: clientId,
        event_type: 'programme_assigned',
        metadata: { template_name: progName },
      });
      router.push(`/dashboard/pt/clients/${clientId}`);
    } else {
      setSaving(false);
    }
  };

  const phase = programme.phases[activePhaseTab] ?? null;
  const currentDay = phase && activeDay !== null ? phase.days[activeDay] ?? null : null;

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/pt/programmes" className="text-black/30 hover:text-black text-sm transition-colors">
          ← Programmes
        </Link>
        <span className="text-black/20">/</span>
        <span className="text-sm text-black/50">New programme</span>
      </div>

      <div className="flex items-center gap-2 mb-8">
        {([1, 2, 3, 4] as const).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step > s && setStep(s)}
              className={`w-7 h-7 rounded-full text-xs font-medium transition-colors ${
                step === s ? 'bg-black text-white' : step > s ? 'bg-black/20 text-black cursor-pointer hover:bg-black/30' : 'bg-black/8 text-black/30'
              }`}
            >
              {s}
            </button>
            {s < 4 && <div className={`w-8 h-px ${step > s ? 'bg-black/30' : 'bg-black/10'}`} />}
          </div>
        ))}
        <span className="ml-3 text-xs text-black/40">
          {step === 1 ? 'Select client & generate' : step === 2 ? 'Edit phases' : step === 3 ? 'Build workouts' : 'Save & assign'}
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-2">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full max-w-sm border border-black/15 px-3 py-2.5 text-sm outline-none focus:border-black/40"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          </div>

          {selectedClient && (
            <div className="border border-black/8 p-5 max-w-sm">
              <p className="text-xs text-black/40 mb-3">
                {selectedClient.document_url ? '✓ Client profile document uploaded' : 'No document uploaded yet'}
              </p>
              {selectedClient.goals && <p className="text-sm text-black/60">{selectedClient.goals}</p>}
            </div>
          )}

          {selectedClient?.document_url && (
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">Generate from profile</p>
              <button
                onClick={() => void generateFromDocument()}
                disabled={generating}
                className="border border-black bg-black text-white px-6 py-3 text-sm hover:bg-white hover:text-black transition-colors disabled:opacity-40"
              >
                {generating ? genStatus || 'Generating…' : 'Generate programme from client profile'}
              </button>
            </div>
          )}

          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">
              {selectedClient?.document_url ? 'Or brain dump manually' : 'Brain dump'}
            </p>
            <div className="flex gap-3 max-w-2xl">
              <textarea
                value={brainDump}
                onChange={(e) => setBrainDump(e.target.value)}
                placeholder="Describe the phases, goals, schedule, exercises, progressions, injuries, anything…"
                rows={5}
                className="flex-1 border border-black/15 px-4 py-3 text-sm outline-none focus:border-black/40 resize-none"
              />
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={startDictation}
                  className={`border border-black/15 px-4 py-3 text-sm hover:border-black/30 transition-colors ${listening ? 'bg-red-50 border-red-300 text-red-600' : ''}`}
                >
                  {listening ? '● Listening' : 'Voice'}
                </button>
                <button
                  onClick={() => void generateFromDump()}
                  disabled={generating || !brainDump.trim()}
                  className="border border-black bg-black text-white px-4 py-3 text-sm disabled:opacity-30"
                >
                  {generating ? '…' : 'Generate'}
                </button>
              </div>
            </div>
            {genStatus && <p className="mt-2 text-xs text-black/40">{genStatus}</p>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Training phases</p>

          {programme.phases.length === 0 && (
            <p className="text-sm text-black/40">No phases yet. Add one below.</p>
          )}

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
                      <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Progression</label>
                      <input value={ph.progression} onChange={(e) => patchPhase(i, { progression: e.target.value })}
                        className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
                    </div>
                    <button onClick={() => setEditingPhase(null)} className="text-xs border border-black/15 px-4 py-1.5 hover:bg-black/5">Done</button>
                  </div>
                ) : (
                  <div className="border border-black/10 px-5 py-4 flex items-center justify-between group cursor-pointer hover:border-black/25 transition-colors"
                    onClick={() => setEditingPhase(i)}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[0.55rem] text-black/30">☰</span>
                        <p className="font-medium text-sm">{ph.title || `Phase ${i + 1}`}</p>
                      </div>
                      <p className="text-xs text-black/40 mt-0.5">
                        {ph.weeks ? `${ph.weeks} weeks` : 'Duration not set'}{ph.focus ? ` · ${ph.focus}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setEditingPhase(i); }}
                        className="text-xs text-black/40 hover:text-black">Edit</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removePhase(i); }}
                        className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button onClick={addPhase} className="border border-black/15 border-dashed px-5 py-3 text-sm text-black/40 hover:border-black/30 hover:text-black transition-colors w-full text-center">
            + Add phase
          </button>

          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)} className="border border-black/15 px-5 py-2.5 text-sm hover:bg-black/5 transition-colors">
              ← Back
            </button>
            <button
              onClick={() => { setActivePhaseTab(0); setActiveDay(null); setStep(3); }}
              disabled={programme.phases.length === 0}
              className="border border-black bg-black text-white px-5 py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
            >
              Build workouts →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
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
            <div>
              {currentDay === null ? (
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
                            No exercises yet. Add from the library or create custom.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-8">
            <button onClick={() => { setActiveDay(null); setStep(2); }} className="border border-black/15 px-5 py-2.5 text-sm hover:bg-black/5 transition-colors">
              ← Phases
            </button>
            <button
              onClick={() => setStep(4)}
              className="border border-black bg-black text-white px-5 py-2.5 text-sm hover:bg-white hover:text-black transition-colors"
            >
              Finish & assign →
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="max-w-lg space-y-5">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Save and assign to client</p>

          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Programme name</label>
            <input
              value={progName}
              onChange={(e) => setProgName(e.target.value)}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
            />
          </div>
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Goal</label>
            <input
              value={progGoal}
              onChange={(e) => setProgGoal(e.target.value)}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
            />
          </div>

          <div className="border border-black/8 px-5 py-4 bg-[#fafaf8]">
            <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Summary</p>
            <p className="text-sm font-medium">{selectedClient?.name ?? 'No client'}</p>
            <p className="text-xs text-black/40 mt-1">
              {programme.phases.length} phase{programme.phases.length !== 1 ? 's' : ''} ·{' '}
              {countProgrammeWeeks(programme)} weeks ·{' '}
              {programme.phases.reduce((sum, ph) => sum + ph.days.length, 0)} workout days
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {programme.phases.map((ph) => (
                <span key={ph.id} className="text-[0.6rem] uppercase tracking-[0.1em] border border-black/10 px-2 py-0.5 text-black/50">
                  {ph.title} · {ph.weeks}w
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(3)} className="border border-black/15 px-5 py-2.5 text-sm hover:bg-black/5 transition-colors">
              ← Back
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || !progName.trim()}
              className="flex-1 border border-black bg-black text-white py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
            >
              {saving ? 'Saving…' : `Save & assign to ${selectedClient?.name ?? 'client'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
