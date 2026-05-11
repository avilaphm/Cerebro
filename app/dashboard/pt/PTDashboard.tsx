'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { countProgrammeWeeks, exerciseFromLibrary, makeId, safeProgramme } from '@/utils/pt/programme';
import type {
  PTClient,
  PTExercise,
  PTProgramAssignment,
  PTProgramTemplate,
  PTProgramme,
  PTProgrammeExercise,
} from '@/utils/pt/types';

type Tab = 'clients' | 'programmes' | 'library' | 'activity';

interface PTEvent {
  id: string;
  created_at: string;
  event_type: string;
  metadata: Record<string, unknown>;
  pt_clients?: { name: string; email: string } | null;
}

const emptyTemplate = {
  name: '',
  goal: '',
  description: '',
};

export default function PTDashboard() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('programmes');
  const [clients, setClients] = useState<PTClient[]>([]);
  const [exercises, setExercises] = useState<PTExercise[]>([]);
  const [templates, setTemplates] = useState<PTProgramTemplate[]>([]);
  const [assignments, setAssignments] = useState<PTProgramAssignment[]>([]);
  const [events, setEvents] = useState<PTEvent[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [programme, setProgramme] = useState<PTProgramme>({ phases: [] });
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [clientForm, setClientForm] = useState({ name: '', email: '', goals: '', notes: '' });
  const [builderNotes, setBuilderNotes] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [dragged, setDragged] = useState<{ phase: number; day: number; exercise: number } | null>(null);
  const [listening, setListening] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [clientRes, exerciseRes, templateRes, assignmentRes, eventRes] = await Promise.all([
      supabase.from('pt_clients').select('*').order('created_at', { ascending: false }),
      supabase.from('pt_exercises').select('*').order('name'),
      supabase.from('pt_program_templates').select('*').order('updated_at', { ascending: false }),
      supabase
        .from('pt_program_assignments')
        .select('*, pt_clients(name, email)')
        .order('updated_at', { ascending: false }),
      supabase
        .from('pt_events')
        .select('*, pt_clients(name, email)')
        .order('created_at', { ascending: false })
        .limit(80),
    ]);

    if (clientRes.error) console.error(clientRes.error);
    if (exerciseRes.error) console.error(exerciseRes.error);
    if (templateRes.error) console.error(templateRes.error);
    if (assignmentRes.error) console.error(assignmentRes.error);
    if (eventRes.error) console.error(eventRes.error);

    setClients((clientRes.data ?? []) as PTClient[]);
    setExercises((exerciseRes.data ?? []) as PTExercise[]);
    setTemplates(((templateRes.data ?? []) as PTProgramTemplate[]).map((row) => ({
      ...row,
      programme: safeProgramme(row.programme),
    })));
    setAssignments(((assignmentRes.data ?? []) as PTProgramAssignment[]).map((row) => ({
      ...row,
      programme: safeProgramme(row.programme),
    })));
    setEvents((eventRes.data ?? []) as PTEvent[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadAll]);

  const selectTemplate = (template: PTProgramTemplate) => {
    setSelectedTemplateId(template.id);
    setSelectedAssignmentId(null);
    setTemplateForm({
      name: template.name,
      goal: template.goal ?? '',
      description: template.description ?? '',
    });
    setProgramme(safeProgramme(template.programme));
  };

  const selectAssignment = (assignment: PTProgramAssignment) => {
    setSelectedAssignmentId(assignment.id);
    setSelectedTemplateId(null);
    setTemplateForm({
      name: assignment.name,
      goal: assignment.goal ?? '',
      description: `Client copy for ${assignment.pt_clients?.name ?? 'client'}`,
    });
    setProgramme(safeProgramme(assignment.programme));
  };

  const createPTClient = async () => {
    if (!clientForm.name.trim() || !clientForm.email.trim()) return;
    setStatus('Creating client...');
    const { error } = await supabase.from('pt_clients').insert({
      name: clientForm.name.trim(),
      email: clientForm.email.trim().toLowerCase(),
      goals: clientForm.goals.trim() || null,
      notes: clientForm.notes.trim() || null,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setClientForm({ name: '', email: '', goals: '', notes: '' });
    setStatus('Client created.');
    await loadAll();
  };

  const inviteClient = async (client: PTClient) => {
    setStatus(`Sending invite to ${client.name}...`);
    const { error } = await supabase.functions.invoke('invite-pt-client', {
      body: { client_id: client.id },
    });
    setStatus(error ? error.message : `Invite sent to ${client.email}.`);
    await loadAll();
  };

  const importExercises = async (file: File) => {
    setStatus('Importing exercise library...');
    const text = await file.text();
    const rows = parseCsv(text);
    const exercisesToImport = rows
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

    if (exercisesToImport.length === 0) {
      setStatus('No exercises found. Use columns: name, muscles, purpose, equipment, video_url, cue_1, cue_2, cue_3, cue_4, tags.');
      return;
    }

    const { error } = await supabase
      .from('pt_exercises')
      .upsert(exercisesToImport, { onConflict: 'name' });

    setStatus(error ? error.message : `${exercisesToImport.length} exercises imported.`);
    await loadAll();
  };

  const generateProgramme = async () => {
    if (!builderNotes.trim()) return;
    setStatus('Generating programme draft...');
    const { data, error } = await supabase.functions.invoke('generate-pt-programme', {
      body: {
        notes: builderNotes,
        exercises: exercises.slice(0, 300),
      },
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    const generated = safeProgramme((data as { programme?: unknown } | null)?.programme);
    setProgramme(generated);
    setTemplateForm((current) => ({
      ...current,
      name: current.name || ((data as { name?: string } | null)?.name ?? 'New PT Programme'),
      goal: current.goal || ((data as { goal?: string } | null)?.goal ?? ''),
      description: current.description || builderNotes.slice(0, 240),
    }));
    setStatus('Programme draft ready to edit.');
  };

  const startDictation = () => {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) {
      setStatus('Browser dictation is not available here. Type the brain dump instead.');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-AU';
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ');
      setBuilderNotes((current) => `${current} ${transcript}`.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim()) return;
    const templatePayload = {
      name: templateForm.name.trim(),
      goal: templateForm.goal.trim() || null,
      description: templateForm.description.trim() || null,
      duration_weeks: countProgrammeWeeks(programme),
      phase_count: programme.phases.length,
      status: 'ready',
      programme,
    };
    const assignmentPayload = {
      name: templateForm.name.trim(),
      goal: templateForm.goal.trim() || null,
      duration_weeks: countProgrammeWeeks(programme),
      phase_count: programme.phases.length,
      programme,
    };

    setStatus('Saving programme...');
    const result = selectedAssignmentId
      ? await supabase.from('pt_program_assignments').update(assignmentPayload).eq('id', selectedAssignmentId)
      : selectedTemplateId
      ? await supabase.from('pt_program_templates').update(templatePayload).eq('id', selectedTemplateId)
      : await supabase.from('pt_program_templates').insert(templatePayload).select('id').single();

    if (result.error) {
      setStatus(result.error.message);
      return;
    }

    const inserted = 'data' in result ? (result.data as { id?: string } | null) : null;
    if (inserted?.id) setSelectedTemplateId(inserted.id);
    setStatus(selectedAssignmentId ? 'Client programme copy saved.' : 'Programme saved.');
    await loadAll();
  };

  const assignTemplate = async (clientId: string, template: PTProgramTemplate) => {
    setStatus('Assigning programme copy...');
    const { error } = await supabase.from('pt_program_assignments').insert({
      client_id: clientId,
      template_id: template.id,
      name: template.name,
      goal: template.goal,
      duration_weeks: template.duration_weeks,
      phase_count: template.phase_count,
      status: 'active',
      programme: template.programme,
    });

    if (!error) {
      await supabase.from('pt_events').insert({
        client_id: clientId,
        event_type: 'programme_assigned',
        metadata: { template_id: template.id, template_name: template.name },
      });
    }

    setStatus(error ? error.message : 'Programme assigned as a client-specific copy.');
    await loadAll();
  };

  const generateWeeklySummary = async () => {
    setStatus('Generating weekly PT summary...');
    const { data, error } = await supabase.functions.invoke('weekly-pt-summary');
    if (error) {
      setStatus(error.message);
      return;
    }
    const summary = (data as { summary?: string } | null)?.summary;
    setStatus(summary ? `Weekly summary generated and emailed. ${summary.slice(0, 180)}` : 'Weekly summary generated.');
  };

  const addExerciseToDay = (phaseIndex: number, dayIndex: number, exercise: PTExercise) => {
    updateProgramme((draft) => {
      draft.phases[phaseIndex].days[dayIndex].exercises.push(exerciseFromLibrary(exercise));
      return draft;
    });
  };

  const updateExercise = (
    phaseIndex: number,
    dayIndex: number,
    exerciseIndex: number,
    patch: Partial<PTProgrammeExercise>,
  ) => {
    updateProgramme((draft) => {
      draft.phases[phaseIndex].days[dayIndex].exercises[exerciseIndex] = {
        ...draft.phases[phaseIndex].days[dayIndex].exercises[exerciseIndex],
        ...patch,
      };
      return draft;
    });
  };

  const moveDraggedExercise = (target: { phase: number; day: number; exercise: number }) => {
    if (!dragged) return;
    updateProgramme((draft) => {
      const from = draft.phases[dragged.phase].days[dragged.day].exercises;
      const [item] = from.splice(dragged.exercise, 1);
      const to = draft.phases[target.phase].days[target.day].exercises;
      to.splice(target.exercise, 0, item);
      return draft;
    });
    setDragged(null);
  };

  const addPhase = () => {
    updateProgramme((draft) => {
      draft.phases.push({
        id: makeId('phase'),
        title: `Phase ${draft.phases.length + 1}`,
        focus: '',
        weeks: '',
        progression: '',
        days: [],
      });
      return draft;
    });
  };

  const addDay = (phaseIndex: number) => {
    updateProgramme((draft) => {
      const phase = draft.phases[phaseIndex];
      phase.days.push({
        id: makeId('day'),
        title: `Day ${phase.days.length + 1}`,
        focus: '',
        exercises: [],
      });
      return draft;
    });
  };

  const updateProgramme = (updater: (draft: PTProgramme) => PTProgramme) => {
    setProgramme((current) => updater(structuredClone(current)));
  };

  const stats = [
    { label: 'Clients', value: clients.length },
    { label: 'Programmes', value: templates.length },
    { label: 'Exercises', value: exercises.length },
    { label: 'Active assignments', value: assignments.filter((a) => a.status === 'active').length },
  ];

  return (
    <div className="min-h-screen bg-[#f7f7f3] text-black">
      <div className="border-b border-black/10 bg-white">
        <div className="p-6 md:p-10">
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
            Dashboard
          </p>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display text-3xl md:text-4xl font-light tracking-[-0.02em] text-black">
                PT Dashboard
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-black/55">
                Programme brain, client library, exercise system, and weekly coaching signal in one place.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {stats.map((item) => (
                <div key={item.label} className="min-w-28 border border-black/10 bg-white px-4 py-3">
                  <p className="text-2xl font-display font-light">{item.value}</p>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-black/35">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex overflow-x-auto border-t border-black/10 px-6 md:px-10">
          {(['programmes', 'clients', 'library', 'activity'] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`border-b-2 px-4 py-3 text-xs uppercase tracking-[0.16em] transition-colors ${
                tab === item ? 'border-black text-black' : 'border-transparent text-black/35 hover:text-black'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 md:p-10">
        {status && (
          <div className="mb-6 border border-black/10 bg-white px-4 py-3 text-sm text-black/60">
            {status}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-black/40">Loading PT system...</p>
        ) : (
          <>
            {tab === 'programmes' && (
              <div className="grid gap-6 xl:grid-cols-[24rem_1fr]">
                <section className="space-y-4">
                  <Panel title="PT Programmes Folder">
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTemplateId(null);
                          setSelectedAssignmentId(null);
                          setTemplateForm(emptyTemplate);
                          setProgramme({ phases: [] });
                          setBuilderNotes('');
                        }}
                        className="w-full border border-black bg-black px-4 py-2.5 text-sm text-white"
                      >
                        New programme
                      </button>
                      {templates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => selectTemplate(template)}
                          className={`w-full border px-4 py-3 text-left transition-colors ${
                            selectedTemplateId === template.id ? 'border-black bg-black text-white' : 'border-black/10 bg-white hover:border-black/30'
                          }`}
                        >
                          <span className="block text-sm font-medium">{template.name}</span>
                          <span className="mt-1 block text-xs opacity-55">
                            {template.phase_count} phases · {template.duration_weeks} weeks
                          </span>
                        </button>
                      ))}
                    </div>
                  </Panel>

                  <Panel title="Client programme copies">
                    <div className="space-y-2">
                      {assignments.length === 0 ? (
                        <p className="text-sm text-black/45">No assigned programmes yet.</p>
                      ) : assignments.map((assignment) => (
                        <button
                          key={assignment.id}
                          type="button"
                          onClick={() => selectAssignment(assignment)}
                          className={`w-full border px-4 py-3 text-left transition-colors ${
                            selectedAssignmentId === assignment.id ? 'border-black bg-black text-white' : 'border-black/10 bg-white hover:border-black/30'
                          }`}
                        >
                          <span className="block text-sm font-medium">{assignment.name}</span>
                          <span className="mt-1 block text-xs opacity-55">
                            {assignment.pt_clients?.name ?? 'Client'} · {assignment.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Panel>

                  <Panel title="Assign programme">
                    <div className="space-y-2">
                      {!selectedTemplate ? (
                        <p className="text-sm text-black/45">Select or save a programme first.</p>
                      ) : clients.length === 0 ? (
                        <p className="text-sm text-black/45">Add a client first.</p>
                      ) : (
                        clients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => assignTemplate(client.id, selectedTemplate)}
                            className="flex w-full items-center justify-between border border-black/10 bg-white px-4 py-3 text-left text-sm hover:border-black/30"
                          >
                            <span>{client.name}</span>
                            <span className="text-xs text-black/35">Assign copy</span>
                          </button>
                        ))
                      )}
                    </div>
                  </Panel>
                </section>

                <section className="space-y-6">
                  <Panel title="Brain dump builder">
                    <div className="grid gap-4 lg:grid-cols-[1fr_14rem]">
                      <textarea
                        value={builderNotes}
                        onChange={(event) => setBuilderNotes(event.target.value)}
                        placeholder="Say or type the phase, goal, weekly split, progressions, exercises, supersets, injuries, and anything you would normally dump into notes."
                        className="min-h-40 w-full border border-black/10 bg-[#fbfbf8] p-4 text-sm leading-relaxed outline-none focus:border-black/40"
                      />
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={startDictation}
                          className="w-full border border-black/10 bg-white px-4 py-3 text-sm hover:border-black/30"
                        >
                          {listening ? 'Listening...' : 'Voice brain dump'}
                        </button>
                        <button
                          type="button"
                          onClick={generateProgramme}
                          className="w-full border border-black bg-black px-4 py-3 text-sm text-white"
                        >
                          Generate draft
                        </button>
                      </div>
                    </div>
                  </Panel>

                  <Panel title="Programme details">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Name" value={templateForm.name} onChange={(name) => setTemplateForm((f) => ({ ...f, name }))} />
                      <Field label="Goal" value={templateForm.goal} onChange={(goal) => setTemplateForm((f) => ({ ...f, goal }))} />
                      <Field label="Description" value={templateForm.description} onChange={(description) => setTemplateForm((f) => ({ ...f, description }))} />
                    </div>
                    <div className="mt-4 flex gap-3">
                      <button type="button" onClick={addPhase} className="border border-black/10 bg-white px-4 py-2 text-sm hover:border-black/30">
                        Add phase
                      </button>
                      <button type="button" onClick={saveTemplate} className="border border-black bg-black px-4 py-2 text-sm text-white">
                        {selectedAssignmentId ? 'Save client copy' : 'Save programme'}
                      </button>
                    </div>
                  </Panel>

                  <ProgrammeEditor
                    programme={programme}
                    exercises={exercises}
                    onProgrammeChange={setProgramme}
                    onAddDay={addDay}
                    onAddExercise={addExerciseToDay}
                    onUpdateExercise={updateExercise}
                    onDragStart={setDragged}
                    onDropExercise={moveDraggedExercise}
                  />
                </section>
              </div>
            )}

            {tab === 'clients' && (
              <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
                <Panel title="Add client">
                  <div className="space-y-3">
                    <Field label="Name" value={clientForm.name} onChange={(name) => setClientForm((f) => ({ ...f, name }))} />
                    <Field label="Email" value={clientForm.email} onChange={(email) => setClientForm((f) => ({ ...f, email }))} />
                    <Field label="Goals" value={clientForm.goals} onChange={(goals) => setClientForm((f) => ({ ...f, goals }))} />
                    <textarea
                      value={clientForm.notes}
                      onChange={(event) => setClientForm((f) => ({ ...f, notes: event.target.value }))}
                      placeholder="Notes"
                      className="min-h-24 w-full border border-black/10 bg-[#fbfbf8] p-3 text-sm outline-none focus:border-black/40"
                    />
                    <button type="button" onClick={createPTClient} className="w-full border border-black bg-black px-4 py-2.5 text-sm text-white">
                      Create client
                    </button>
                  </div>
                </Panel>
                <Panel title="Clients">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {clients.map((client) => (
                      <div key={client.id} className="border border-black/10 bg-white p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium">{client.name}</p>
                            <p className="mt-1 text-xs text-black/45">{client.email}</p>
                          </div>
                          <span className="text-[10px] uppercase tracking-[0.16em] text-black/35">{client.status}</span>
                        </div>
                        {client.goals && <p className="mt-4 text-sm leading-relaxed text-black/55">{client.goals}</p>}
                        <button
                          type="button"
                          onClick={() => inviteClient(client)}
                          className="mt-4 border border-black/10 px-3 py-2 text-xs text-black/60 hover:border-black/30 hover:text-black"
                        >
                          Send invite
                        </button>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}

            {tab === 'library' && (
              <div className="space-y-6">
                <Panel title="Exercise spreadsheet import">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <p className="max-w-3xl text-sm leading-relaxed text-black/55">
                      Import CSV columns: name, muscles, purpose, equipment, video_url, cue_1, cue_2, cue_3, cue_4, tags.
                    </p>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) importExercises(file);
                      }}
                      className="text-sm text-black/60"
                    />
                  </div>
                </Panel>
                <Panel title="Exercise library">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {exercises.map((exercise) => (
                      <div key={exercise.id} className="border border-black/10 bg-white p-4">
                        <p className="font-medium">{exercise.name}</p>
                        <p className="mt-1 text-xs text-black/45">{exercise.muscles.join(', ') || 'No muscle tags'}</p>
                        {exercise.video_url && (
                          <a href={exercise.video_url} target="_blank" className="mt-3 block text-xs text-black/45 hover:text-black">
                            Watch demo
                          </a>
                        )}
                        <ul className="mt-3 space-y-1">
                          {exercise.cues.slice(0, 4).map((cue) => (
                            <li key={cue} className="text-xs leading-relaxed text-black/55">• {cue}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}

            {tab === 'activity' && (
              <Panel title="Client interaction tags">
                <button
                  type="button"
                  onClick={generateWeeklySummary}
                  className="mb-4 border border-black bg-black px-4 py-2 text-sm text-white"
                >
                  Generate weekly summary
                </button>
                <div className="space-y-2">
                  {events.length === 0 ? (
                    <p className="text-sm text-black/45">No client programming events yet.</p>
                  ) : events.map((event) => (
                    <div key={event.id} className="flex items-center justify-between border border-black/10 bg-white px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{event.event_type.replaceAll('_', ' ')}</p>
                        <p className="text-xs text-black/45">{event.pt_clients?.name ?? 'Client'} · {new Date(event.created_at).toLocaleString('en-AU')}</p>
                      </div>
                      <p className="max-w-sm truncate text-xs text-black/35">{JSON.stringify(event.metadata)}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-black/10 bg-white p-5">
      <h2 className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-black/45">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-black/35">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-black/10 bg-[#fbfbf8] px-3 py-2 text-sm outline-none focus:border-black/40"
      />
    </label>
  );
}

function ProgrammeEditor({
  programme,
  exercises,
  onProgrammeChange,
  onAddDay,
  onAddExercise,
  onUpdateExercise,
  onDragStart,
  onDropExercise,
}: {
  programme: PTProgramme;
  exercises: PTExercise[];
  onProgrammeChange: (programme: PTProgramme) => void;
  onAddDay: (phaseIndex: number) => void;
  onAddExercise: (phaseIndex: number, dayIndex: number, exercise: PTExercise) => void;
  onUpdateExercise: (phaseIndex: number, dayIndex: number, exerciseIndex: number, patch: Partial<PTProgrammeExercise>) => void;
  onDragStart: (value: { phase: number; day: number; exercise: number }) => void;
  onDropExercise: (value: { phase: number; day: number; exercise: number }) => void;
}) {
  const updatePhase = (phaseIndex: number, patch: Partial<PTProgramme['phases'][number]>) => {
    const next = structuredClone(programme);
    next.phases[phaseIndex] = { ...next.phases[phaseIndex], ...patch };
    onProgrammeChange(next);
  };

  const updateDay = (phaseIndex: number, dayIndex: number, patch: Partial<PTProgramme['phases'][number]['days'][number]>) => {
    const next = structuredClone(programme);
    next.phases[phaseIndex].days[dayIndex] = { ...next.phases[phaseIndex].days[dayIndex], ...patch };
    onProgrammeChange(next);
  };

  if (programme.phases.length === 0) {
    return (
      <Panel title="Programme editor">
        <p className="text-sm text-black/45">Generate a programme or add a phase to start building.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      {programme.phases.map((phase, phaseIndex) => (
        <section key={phase.id} className="border border-black/10 bg-white p-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Phase" value={phase.title} onChange={(title) => updatePhase(phaseIndex, { title })} />
            <Field label="Weeks" value={phase.weeks} onChange={(weeks) => updatePhase(phaseIndex, { weeks })} />
            <Field label="Focus" value={phase.focus} onChange={(focus) => updatePhase(phaseIndex, { focus })} />
            <Field label="Progression" value={phase.progression} onChange={(progression) => updatePhase(phaseIndex, { progression })} />
          </div>
          <button type="button" onClick={() => onAddDay(phaseIndex)} className="mt-4 border border-black/10 px-3 py-2 text-xs hover:border-black/30">
            Add day
          </button>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {phase.days.map((day, dayIndex) => (
              <div key={day.id} className="border border-black/10 bg-[#fbfbf8] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Day" value={day.title} onChange={(title) => updateDay(phaseIndex, dayIndex, { title })} />
                  <Field label="Focus" value={day.focus} onChange={(focus) => updateDay(phaseIndex, dayIndex, { focus })} />
                </div>
                <select
                  className="mt-3 w-full border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue=""
                  onChange={(event) => {
                    const exercise = exercises.find((item) => item.id === event.target.value);
                    if (exercise) onAddExercise(phaseIndex, dayIndex, exercise);
                    event.target.value = '';
                  }}
                >
                  <option value="">Add exercise from library</option>
                  {exercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
                  ))}
                </select>

                <div className="mt-4 space-y-3">
                  {day.exercises.map((exercise, exerciseIndex) => (
                    <div
                      key={exercise.id}
                      draggable
                      onDragStart={() => onDragStart({ phase: phaseIndex, day: dayIndex, exercise: exerciseIndex })}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => onDropExercise({ phase: phaseIndex, day: dayIndex, exercise: exerciseIndex })}
                      className="cursor-grab border border-black/10 bg-white p-3"
                    >
                      <div className="grid gap-2 md:grid-cols-[1fr_4rem_5rem_5rem]">
                        <input
                          value={exercise.name}
                          onChange={(event) => onUpdateExercise(phaseIndex, dayIndex, exerciseIndex, { name: event.target.value })}
                          className="border border-black/10 px-2 py-1.5 text-sm"
                        />
                        <input
                          value={exercise.sets}
                          placeholder="Sets"
                          onChange={(event) => onUpdateExercise(phaseIndex, dayIndex, exerciseIndex, { sets: event.target.value })}
                          className="border border-black/10 px-2 py-1.5 text-sm"
                        />
                        <input
                          value={exercise.reps}
                          placeholder="Reps"
                          onChange={(event) => onUpdateExercise(phaseIndex, dayIndex, exerciseIndex, { reps: event.target.value })}
                          className="border border-black/10 px-2 py-1.5 text-sm"
                        />
                        <input
                          value={exercise.rest}
                          placeholder="Rest"
                          onChange={(event) => onUpdateExercise(phaseIndex, dayIndex, exerciseIndex, { rest: event.target.value })}
                          className="border border-black/10 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <textarea
                        value={exercise.notes}
                        onChange={(event) => onUpdateExercise(phaseIndex, dayIndex, exerciseIndex, { notes: event.target.value })}
                        className="mt-2 min-h-16 w-full border border-black/10 p-2 text-sm"
                        placeholder="Notes, superset details, week changes"
                      />
                      <input
                        value={exercise.video_url ?? ''}
                        onChange={(event) => onUpdateExercise(phaseIndex, dayIndex, exerciseIndex, { video_url: event.target.value || null })}
                        className="mt-2 w-full border border-black/10 px-2 py-1.5 text-sm"
                        placeholder="YouTube video URL"
                      />
                      <ul className="mt-2 grid gap-2 md:grid-cols-2">
                        {[0, 1, 2, 3].map((cueIndex) => (
                          <li key={cueIndex}>
                            <input
                              value={exercise.cues[cueIndex] ?? ''}
                              onChange={(event) => {
                                const cues = [...exercise.cues];
                                cues[cueIndex] = event.target.value;
                                onUpdateExercise(phaseIndex, dayIndex, exerciseIndex, { cues });
                              }}
                              className="w-full border border-black/10 px-2 py-1.5 text-xs"
                              placeholder={`Cue ${cueIndex + 1}`}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = splitCsvLine(lines[0] ?? '').map((header) => normalizeHeader(header));
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])) as Record<string, string>;
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

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
}

function splitList(value: string) {
  return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

function getSpeechRecognition() {
  const windowWithSpeech = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return windowWithSpeech.SpeechRecognition ?? windowWithSpeech.webkitSpeechRecognition ?? null;
}
