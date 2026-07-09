'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { makeId, safeProgramme, countProgrammeWeeks, parseWeekBlocks, formatWeekBlocks, DEFAULT_PROGRAMME_PHASES, moveExerciseBetweenProgrammeDays, moveExerciseIntoProgrammeSuperset, appendDaysToFoundationPhase, groupBands } from '@/utils/pt/programme';
import { searchExerciseLibrary } from '@/utils/pt/exercise-search';
import { patternChipClass, resolvePattern } from '@/utils/pt/patterns';
import type {
  PTClient, PTExercise, PTProgramme, PTProgrammePhase, PTProgrammeDay, PTProgrammeExercise,
} from '@/utils/pt/types';
import PTDayEditor from '../PTDayEditor';
import CurrentWorkoutImportModal from '../CurrentWorkoutImportModal';

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

interface ProgrammingAgentDraft {
  mode?: 'new_programme' | 'revise_programme';
  client_id?: string;
  run_id?: string;
  name?: string;
  goal?: string;
  change_summary?: string;
  validation_summary?: Record<string, unknown>;
  phase_nutrition?: unknown;
  programme?: unknown;
}

interface CurrentWorkoutImportResult {
  created_exercises?: Array<{ name: string; exercise_id: string }>;
  matched_count?: number;
}

function draftReviewSummary(draft: ProgrammingAgentDraft, fallback: string) {
  const failures = Array.isArray(draft.validation_summary?.hard_rule_failures)
    ? draft.validation_summary.hard_rule_failures.length
    : 0;
  const findings = Array.isArray(draft.validation_summary?.findings)
    ? draft.validation_summary.findings.length
    : 0;
  const review = failures > 0 ? ` Validation flagged ${failures} hard issue${failures === 1 ? '' : 's'}.` : findings > 0 ? ` Validation has ${findings} review note${findings === 1 ? '' : 's'}.` : '';
  return `${draft.change_summary ?? fallback}${review}`;
}

function getSR() {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const PIPELINE_STEPS = [
  'Saving intake to client brain…',
  'Starting pipeline…',
  'Analysing client…',
  'Analysing movement assessment…',
  'Building exercise intelligence…',
  'Planning methodology (knowledge base RAG)…',
  'Synthesising Foundation (1/5)…',
  'Synthesising 1RM Test (2/5)…',
  'Synthesising Hypertrophy (3/5)…',
  'Synthesising Strength (4/5)…',
  'Synthesising 1RM Retest (5/5)…',
  'Cross-checking against client brain…',
  'Validating…',
];

function inferPhaseWeeks(phases: PTProgrammePhase[]): { foundation: number; hypertrophy: number; strength: number } {
  const pick = (matcher: (title: string) => boolean, fallback: number): number => {
    const ph = phases.find((p) => matcher(p.title.toLowerCase()));
    const n = ph ? parseInt(ph.weeks, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    foundation: pick((t) => t.includes('foundation') || t.includes('phase 1'), 7),
    hypertrophy: pick((t) => t.includes('hypertrophy') || t.includes('phase 2'), 12),
    strength: pick((t) => t.includes('strength') || t.includes('phase 3'), 12),
  };
}

interface FunctionErrorWithContext {
  message?: string;
  context?: {
    clone?: () => Response;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  };
}

async function readJsonResponse<T extends { error?: string }>(res: Response, fallback: string): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return await res.json() as T;
  }
  const text = await res.text();
  return { error: `${fallback}: ${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)}` } as T;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const fnError = error as FunctionErrorWithContext;
  const context = fnError.context;
  try {
    const json = await (context?.clone?.() ?? context)?.json?.();
    if (typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string') {
      return json.error;
    }
  } catch { /* noop */ }
  try {
    const text = await (context?.clone?.() ?? context)?.text?.();
    if (text?.trim()) return text.trim().slice(0, 300);
  } catch { /* noop */ }
  return fnError.message ?? fallback;
}

export default function PTProgrammeWizard({ clients, exercises }: { clients: PTClient[]; exercises: PTExercise[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);


  const [clientId, setClientId] = useState('');
  const [brainDump, setBrainDump] = useState('');
  const [listening, setListening] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');

  const [programme, setProgramme] = useState<PTProgramme>({
    phases: DEFAULT_PROGRAMME_PHASES.map((ph) => ({ ...ph, id: makeId('phase') })),
  });
  const [progName, setProgName] = useState('');
  const [progGoal, setProgGoal] = useState('');

  const [activePhaseTab, setActivePhaseTab] = useState(0);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [boardView, setBoardView] = useState(false);
  const [dragEx, setDragEx] = useState<{ dayIndex: number; exId: string } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [boardEditExId, setBoardEditExId] = useState<string | null>(null);
  const libById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const [currentWorkoutImportOpen, setCurrentWorkoutImportOpen] = useState(false);
  const [currentWorkoutImportStatus, setCurrentWorkoutImportStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [weekBlocksInput, setWeekBlocksInput] = useState<Record<number, string>>({});
  const [listeningForPhase, setListeningForPhase] = useState<number | null>(null);
  const [agentDraftSummary, setAgentDraftSummary] = useState('');
  const [generationRunId, setGenerationRunId] = useState<string | null>(null);
  const [validationSummary, setValidationSummary] = useState<Record<string, unknown>>({});
  const [phaseNutritionDraft, setPhaseNutritionDraft] = useState<unknown[]>([]);
  const [completedSteps, setCompletedSteps] = useState<Array<{ name: string; elapsed: number }>>([]);

  type IntakeFile = { name: string; document_type: 'intake' | 'movement_assessment' | 'profile' | 'other'; content_text: string };
  const [intakeFiles, setIntakeFiles] = useState<IntakeFile[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [intakeStatus, setIntakeStatus] = useState('');
  const [brainSaved, setBrainSaved] = useState(false);
  const [uploadDocType, setUploadDocType] = useState<IntakeFile['document_type']>('intake');
  const [daysPerWeek, setDaysPerWeek] = useState<3 | 4 | 5>(3);

  const srRef = useRef<SpeechRecognitionLike | null>(null);
  const srPhaseRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef('');

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  const update = (fn: (p: PTProgramme) => PTProgramme) =>
    setProgramme((cur) => fn(structuredClone(cur)));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefillKey = params.get('prefillKey');
    if (prefillKey) {
      const rawPrefill = sessionStorage.getItem(prefillKey);
      if (rawPrefill) {
        try {
          const prefill = JSON.parse(rawPrefill) as { client_id?: string; instructions?: string };
          if (typeof prefill.client_id === 'string') setClientId(prefill.client_id);
          if (typeof prefill.instructions === 'string' && prefill.instructions.trim()) setBrainDump(prefill.instructions.trim());
        } catch { /* noop */ }
      }
    }

    const draftKey = params.get('draftKey');
    if (!draftKey) return;

    const raw = sessionStorage.getItem(draftKey);
    if (!raw) return;

    try {
      const draft = JSON.parse(raw) as ProgrammingAgentDraft;
      if (draft.mode !== 'new_programme') return;

      if (typeof draft.client_id === 'string') setClientId(draft.client_id);
      if (typeof draft.name === 'string') setProgName(draft.name);
      if (typeof draft.goal === 'string') setProgGoal(draft.goal);
      if (typeof draft.run_id === 'string') setGenerationRunId(draft.run_id);
      if (draft.validation_summary) setValidationSummary(draft.validation_summary);
      if (Array.isArray(draft.phase_nutrition)) setPhaseNutritionDraft(draft.phase_nutrition);
      setProgramme(safeProgramme(draft.programme));
      setAgentDraftSummary(draftReviewSummary(draft, 'AI draft loaded. Review and edit before creating.'));
      setStep(2);
    } catch {
      setGenStatus('Could not load the programming agent draft.');
    }
  }, []);

  // Autosave edits back to the draft run so unsaved work survives navigating away.
  // The draft lives in pt_program_generation_runs until step 4 Create turns it into an
  // assignment; the 24h cleanup cron removes drafts that are never saved.
  const lastAutosaveRef = useRef('');
  const autosaveSnapshot = JSON.stringify({ programme, progName, progGoal });
  useEffect(() => {
    if (!generationRunId || generating || step < 2) return;
    if (autosaveSnapshot === lastAutosaveRef.current) return;
    const timer = setTimeout(() => {
      lastAutosaveRef.current = autosaveSnapshot;
      void supabase
        .from('pt_program_generation_runs')
        .update({
          programme_draft: programme,
          validation_summary: { ...validationSummary, name: progName, goal: progGoal },
          updated_at: new Date().toISOString(),
        })
        .eq('id', generationRunId);
    }, 1200);
    return () => clearTimeout(timer);
  }, [autosaveSnapshot, generationRunId, generating, step, programme, progName, progGoal, validationSummary, supabase]);

  const addIntakeFile = async (file: File, docType: IntakeFile['document_type']) => {
    if (intakeFiles.length >= 3) {
      setIntakeStatus('Maximum 3 documents.');
      return;
    }
    if (file.size > 20_000_000) {
      setIntakeStatus(`${file.name} is over 20MB.`);
      return;
    }
    try {
      let text: string;
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setIntakeStatus(`Reading ${file.name}…`);
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/pt/parse-pdf', { method: 'POST', body: form });
        const json = await readJsonResponse<{ text?: string; error?: string }>(res, 'PDF parse failed');
        if (!res.ok || json.error) {
          setIntakeStatus(json.error ?? 'PDF parse failed.');
          return;
        }
        text = json.text ?? '';
      } else {
        text = await file.text();
      }
      const trimmed = text.trim();
      if (!trimmed) {
        setIntakeStatus(`${file.name} appears empty.`);
        return;
      }
      setIntakeFiles((cur) => [...cur, { name: file.name, document_type: docType, content_text: trimmed.slice(0, 100_000) }]);
      setIntakeStatus('');
      setBrainSaved(false);
    } catch (err) {
      setIntakeStatus(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const removeIntakeFile = (idx: number) => {
    setIntakeFiles((cur) => cur.filter((_, i) => i !== idx));
    setBrainSaved(false);
  };

  const saveClientBrain = async () => {
    if (!clientId) {
      setIntakeStatus('Pick a client first.');
      return;
    }
    if (intakeFiles.length === 0 && !brainDump.trim()) {
      setIntakeStatus('Add at least one document or note before saving.');
      return;
    }
    setIngesting(true);
    setIntakeStatus('Distributing intake into the client brain…');
    const { data, error } = await supabase.functions.invoke('ingest-client-intake', {
      body: {
        client_id: clientId,
        files: intakeFiles,
        notes_text: brainDump,
      },
    });
    setIngesting(false);
    if (error || (data as { error?: string })?.error) {
      setIntakeStatus((data as { error?: string })?.error ?? await functionErrorMessage(error, 'Ingest failed.'));
      return;
    }
    const result = data as { distributed_into?: string[]; documents_stored?: number };
    setBrainSaved(true);
    setIntakeStatus(`Brain updated. ${result.documents_stored ?? 0} source(s) stored, distributed into ${result.distributed_into?.length ?? 4} docs. Embedding in the background.`);
  };

  const handleGenerate = async () => {
    if (!clientId) {
      setGenStatus('Select a client first — the 3-AI pipeline needs the client brain to generate.');
      return;
    }
    setGenerating(true);
    setStep(2);

    if (intakeFiles.length > 0 || brainDump.trim()) {
      setGenStatus('Saving intake to client brain…');
      const { data: ingestData, error: ingestError } = await supabase.functions.invoke('ingest-client-intake', {
        body: { client_id: clientId, files: intakeFiles, notes_text: brainDump },
      });
      if (ingestError || (ingestData as { error?: string })?.error) {
        setGenStatus((ingestData as { error?: string })?.error ?? await functionErrorMessage(ingestError, 'Brain save failed.'));
        setGenerating(false);
        return;
      }
      setBrainSaved(true);
    }

    setGenStatus('Starting pipeline…');
    const phaseWeeks = inferPhaseWeeks(programme.phases);
    const { data, error } = await supabase.functions.invoke('pt-programme-orchestrator', {
      body: { client_id: clientId, phase_weeks: phaseWeeks, days_per_week: daysPerWeek, intake_text: brainDump },
    });

    if (error || (data as { error?: string })?.error) {
      setGenStatus((data as { error?: string })?.error ?? await functionErrorMessage(error, 'Generation failed.'));
      setGenerating(false);
      return;
    }

    const kickoff = data as { run_id?: string; status?: string };
    if (!kickoff.run_id) {
      setGenStatus('Pipeline did not return a run id.');
      setGenerating(false);
      return;
    }
    setGenerationRunId(kickoff.run_id);

    const commandLabel = (cmd: string | null | undefined) => {
      switch (cmd) {
        case 'CLIENT_ANALYSIS': return 'Analysing client…';
        case 'MOVEMENT_ANALYSIS': return 'Analysing movement assessment…';
        case 'EXERCISE_INTELLIGENCE': return 'Building exercise intelligence…';
        case 'METHODOLOGY_PLAN': return 'Planning methodology (knowledge base RAG)…';
        case 'PROGRAMME_SYNTHESIS_FOUNDATION': return 'Synthesising Foundation (1/5)…';
        case 'PROGRAMME_SYNTHESIS_1RM_TEST': return 'Synthesising 1RM Test (2/5)…';
        case 'PROGRAMME_SYNTHESIS_HYPERTROPHY': return 'Synthesising Hypertrophy (3/5)…';
        case 'PROGRAMME_SYNTHESIS_STRENGTH': return 'Synthesising Strength (4/5)…';
        case 'PROGRAMME_SYNTHESIS_1RM_RETEST': return 'Synthesising 1RM Retest (5/5)…';
        case 'PROGRAMME_CROSS_CHECK': return 'Cross-checking against client brain…';
        case 'VALIDATION': return 'Validating…';
        default:
          if (cmd?.startsWith('PROGRAMME_SYNTHESIS_')) return 'Synthesising phase…';
          return 'Working…';
      }
    };

    const pollDeadline = Date.now() + 7 * 60_000;
    while (Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const [{ data: row }, { data: steps }] = await Promise.all([
        supabase
          .from('pt_program_generation_runs')
          .select('status, current_command, programme_draft, validation_summary, failure_reason')
          .eq('id', kickoff.run_id)
          .maybeSingle(),
        supabase
          .from('pt_program_generation_steps')
          .select('command_name, status, started_at, completed_at')
          .eq('run_id', kickoff.run_id)
          .eq('status', 'succeeded')
          .order('step_order'),
      ]);
      if (!row) continue;
      if (steps && steps.length > 0) {
        setCompletedSteps(steps.map((s) => ({
          name: commandLabel(s.command_name),
          elapsed: s.started_at && s.completed_at
            ? Math.round((new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) / 1000)
            : 0,
        })));
      }
      setGenStatus(commandLabel(row.current_command));
      if (row.status === 'failed') {
        setGenStatus(row.failure_reason ?? 'Pipeline failed.');
        setGenerating(false);
        setStep(1);
        return;
      }
      if (row.status === 'needs_review' || row.status === 'approved' || row.status === 'saved') {
        const draft = row.programme_draft as unknown;
        const vs = (row.validation_summary ?? {}) as Record<string, unknown>;
        setProgramme(safeProgramme(draft));
        setProgName(typeof vs.name === 'string' ? vs.name : '');
        setProgGoal(typeof vs.goal === 'string' ? vs.goal : '');
        const hf = Array.isArray(vs.hard_failures) ? vs.hard_failures as string[] : [];
        const fnd = Array.isArray(vs.findings) ? vs.findings as string[] : [];
        const missing = Array.isArray(vs.missing_exercises) ? vs.missing_exercises as string[] : [];
        setValidationSummary({ passed: vs.passed === true, hard_rule_failures: hf, findings: fnd, missing_exercises: missing });
        setAgentDraftSummary(
          hf.length
            ? `Generated with ${hf.length} hard rule failure${hf.length === 1 ? '' : 's'}. Review and adjust before saving.`
            : fnd.length
            ? `Generated. ${fnd.length} review note${fnd.length === 1 ? '' : 's'} to skim.`
            : 'Generated cleanly. Review and save.',
        );
        setGenStatus('');
        setGenerating(false);
        setStep(2);
        return;
      }
    }
    setGenStatus('Pipeline timed out. The server may still be running — try again in a few minutes, or refresh and restart.');
    setGenerating(false);
    setStep(1);
  };

  const startDictation = () => {
    const SR = getSR();
    if (!SR) { setGenStatus('Browser dictation not available. Type instead.'); return; }
    const r = new SR();
    srRef.current = r;
    r.continuous = true; r.interimResults = true; r.lang = 'en-AU';
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result?.isFinal) {
          const transcript = result[0]?.transcript ?? '';
          if (transcript) setBrainDump((cur) => (cur ? `${cur} ${transcript}` : transcript).trim());
        }
      }
    };
    r.onend = () => { setListening(false); srRef.current = null; };
    r.start(); setListening(true);
  };

  const stopDictation = () => { srRef.current?.stop(); };

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

  const addPhase = () => update((p) => {
    p.phases.push({ id: makeId('phase'), title: `Phase ${p.phases.length + 1}`, focus: '', weeks: '4', progression: '', days: [] });
    return p;
  });

  const removePhase = (i: number) => update((p) => { p.phases.splice(i, 1); return p; });

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

  const addDay = (phaseIdx: number) => update((p) => {
    const ph = p.phases[phaseIdx];
    ph.days.push({ id: makeId('day'), title: `Day ${ph.days.length + 1}`, focus: '', exercises: [] });
    return p;
  });

  const patchDay = (pi: number, di: number, patch: Partial<PTProgrammeDay>) => update((p) => {
    p.phases[pi].days[di] = { ...p.phases[pi].days[di], ...patch }; return p;
  });

  const deleteDay = (pi: number, di: number) => {
    update((p) => { p.phases[pi].days.splice(di, 1); return p; });
    if (activeDay === di) setActiveDay(null);
  };

  const moveExerciseToDay = (fromDay: number, exId: string, toDay: number, beforeExId?: string) => {
    update((p) => {
      const ph = p.phases[activePhaseTab];
      if (!ph) return p;
      p.phases[activePhaseTab] = moveExerciseBetweenProgrammeDays(ph, fromDay, exId, toDay, beforeExId);
      return p;
    });
  };

  const moveExerciseToSuperset = (fromDay: number, exId: string, toDay: number, targetExId: string) => {
    update((p) => {
      const ph = p.phases[activePhaseTab];
      if (!ph) return p;
      p.phases[activePhaseTab] = moveExerciseIntoProgrammeSuperset(ph, fromDay, exId, toDay, targetExId);
      return p;
    });
  };

  const getBoardMatches = (name: string) =>
    name.length >= 2 ? searchExerciseLibrary(exercises, name, 6) : [];

  const patchBoardExercise = (pi: number, di: number, exId: string, patch: Partial<PTProgrammeExercise>) =>
    update((p) => {
      const day = p.phases[pi].days[di];
      day.exercises = day.exercises.map((ex) => ex.id === exId ? { ...ex, ...patch } : ex);
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

  const handleCurrentWorkoutImported = (days: PTProgrammeDay[], result: CurrentWorkoutImportResult) => {
    let foundationIndex = 0;
    update((p) => {
      const appended = appendDaysToFoundationPhase(p, days);
      foundationIndex = appended.phaseIndex;
      return appended.programme;
    });
    setActivePhaseTab(foundationIndex);
    setActiveDay(null);
    setBoardView(true);
    const created = result.created_exercises?.length ?? 0;
    setCurrentWorkoutImportStatus(
      `Added ${days.length} current workout day${days.length === 1 ? '' : 's'} to Foundation`
      + (created > 0 ? ` and created ${created} exercise card${created === 1 ? '' : 's'} for videos later.` : '.'),
    );
  };

  const save = async () => {
    if (!progName.trim()) return;
    setSaving(true);

    const { data: template, error: tErr } = await supabase
      .from('pt_program_templates')
      .insert({
        name: progName.trim(),
        goal: progGoal.trim() || null,
        duration_weeks: countProgrammeWeeks(programme),
        phase_count: programme.phases.length,
        status: 'ready',
        programme,
        generation_run_id: generationRunId,
        validation_summary: validationSummary,
      })
      .select('id')
      .single();

    if (tErr || !template) { setSaving(false); return; }

    if (clientId) {
      const { data: assignment, error: aErr } = await supabase.from('pt_program_assignments').insert({
        client_id: clientId,
        template_id: template.id,
        name: progName.trim(),
        goal: progGoal.trim() || null,
        duration_weeks: countProgrammeWeeks(programme),
        phase_count: programme.phases.length,
        status: 'draft',
        programme,
        generation_run_id: generationRunId,
        coach_review_status: 'approved',
        validation_summary: validationSummary,
        nutrition_sync: { phase_nutrition: phaseNutritionDraft },
        current_phase_index: 0,
        current_block_index: 0,
        current_week: 1,
      }).select('id').single();
      if (!aErr && assignment) {
        if (phaseNutritionDraft.length > 0) {
          await supabase.from('pt_phase_nutrition').upsert(
            phaseNutritionDraft.map((item, index) => {
              const record = typeof item === 'object' && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : {};
              const recommendations = typeof record.recommendations === 'object' && record.recommendations !== null ? record.recommendations as Record<string, unknown> : {};
              const trainingContext = typeof record.training_context === 'object' && record.training_context !== null ? record.training_context as Record<string, unknown> : {};
              return {
                client_id: clientId,
                assignment_id: assignment.id,
                generation_run_id: generationRunId,
                phase_index: typeof record.phase_index === 'number' ? record.phase_index : index,
                phase_title: typeof record.phase_title === 'string' ? record.phase_title : programme.phases[index]?.title ?? `Phase ${index + 1}`,
                phase_type: typeof record.phase_type === 'string' ? record.phase_type : 'general',
                training_context: trainingContext,
                recommendations,
                review_status: 'approved',
              };
            }),
            { onConflict: 'assignment_id,phase_index' },
          );
        }
        await supabase.from('pt_events').insert({
          client_id: clientId,
          event_type: 'programme_assigned',
          metadata: { template_name: progName },
        });
        router.push(`/dashboard/pt/clients/${clientId}`);
        return;
      }
    }

    router.push(`/dashboard/pt/programmes/template/${template.id}`);
  };

  const phase = programme.phases[activePhaseTab] ?? null;
  const currentDay = phase && activeDay !== null ? phase.days[activeDay] ?? null : null;
  const saveCurrentDay = () => {
    if (!phase || activeDay === null) return;
    if (activeDay < phase.days.length - 1) {
      setActiveDay(activeDay + 1);
      return;
    }
    setActiveDay(null);
  };

  return (
    <div className={`${step === 3 && boardView ? 'max-w-7xl' : 'max-w-4xl'} px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10`}>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link href="/dashboard/pt/programmes" className="text-black/30 hover:text-black text-sm transition-colors">
          ← Programmes
        </Link>
        <span className="text-black/20">/</span>
        <span className="text-sm text-black/50">New programme</span>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-2">
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
          {step === 1 ? 'Generate' : step === 2 ? 'Review' : step === 3 ? 'Edit' : 'Create'}
        </span>
      </div>


      {step === 1 && (
        <div className="space-y-6">
          {/* Client selection */}
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-2">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full max-w-sm border border-black/15 px-3 py-3 text-sm outline-none focus:border-black/40 sm:py-2.5"
            >
              <option value="">— Select a client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          </div>

          {selectedClient && (
            <div className="border border-black/8 p-5 max-w-sm">
              <p className="text-xs text-black/40 mb-3">
                {selectedClient.document_url ? '✓ Client profile document on file' : 'No profile document yet'}
              </p>
              {selectedClient.goals && <p className="text-sm text-black/60">{selectedClient.goals}</p>}
            </div>
          )}

          {/* Document upload */}
          {selectedClient && (
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">Upload intake documents (PDF, text or markdown — up to 3)</p>
              <div className="space-y-2 max-w-2xl">
                {intakeFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between border border-black/10 px-3 py-2 text-xs">
                    <span className="truncate">
                      <span className="text-black/70">{f.name}</span>
                      <span className="ml-2 text-black/40">{f.document_type.replace('_', ' ')} | {f.content_text.length.toLocaleString()} chars</span>
                    </span>
                    <button type="button" onClick={() => removeIntakeFile(i)} className="text-black/40 hover:text-black ml-3">Remove</button>
                  </div>
                ))}
                {intakeFiles.length < 3 && (
                  <div className="flex items-center gap-2">
                    <select
                      value={uploadDocType}
                      onChange={(e) => setUploadDocType(e.target.value as IntakeFile['document_type'])}
                      className="border border-black/15 px-2 py-2 text-xs outline-none focus:border-black/40"
                    >
                      <option value="movement_assessment">Movement assessment</option>
                      <option value="intake">Intake form</option>
                      <option value="profile">Profile</option>
                      <option value="other">Other</option>
                    </select>
                    <label className="cursor-pointer border border-black/15 px-3 py-2 text-xs hover:border-black/30 transition-colors">
                      + Upload document
                      <input
                        type="file"
                        accept=".txt,.md,.text,.pdf,text/plain,text/markdown,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void addIntakeFile(file, uploadDocType);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                )}
                {intakeStatus && <p className="mt-1 text-xs text-black/40">{intakeStatus}</p>}
              </div>
            </div>
          )}

          {/* Training days */}
          {selectedClient && (
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">Training days per week (Phase 2 & 3)</p>
              <p className="text-xs text-black/40 mb-3 max-w-2xl">
                Foundation is always 3 full-body days. For Hypertrophy and Strength, pick the split. 3 days = full body, 4 = upper/lower, 5 = lower/push/pull/lower/upper. Big 5 lifts are auto-distributed so each is trained 2x/week on 4 and 5-day splits.
              </p>
              <div className="flex gap-2">
                {([3, 4, 5] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDaysPerWeek(d)}
                    className={`border px-4 py-2 text-sm transition-colors ${
                      daysPerWeek === d ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black/30'
                    }`}
                  >
                    {d} days/week
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Brain dump */}
          {selectedClient && (
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">Brain dump</p>
              <div className="flex max-w-2xl flex-col gap-3 sm:flex-row">
                <textarea
                  value={brainDump}
                  onChange={(e) => setBrainDump(e.target.value)}
                  placeholder="Describe the phases, goals, schedule, exercises, progressions, injuries, anything…"
                  rows={5}
                  className="flex-1 border border-black/15 px-4 py-3 text-sm outline-none focus:border-black/40 resize-none"
                />
                <div className="flex flex-col gap-2 sm:w-32">
                  {listening ? (
                    <div className="flex flex-col gap-1">
                      <span className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600 text-center">● Recording</span>
                      <button type="button" onClick={stopDictation} className="border border-black bg-black text-white px-3 py-2 text-xs hover:bg-white hover:text-black transition-colors">
                        Done
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startDictation}
                      className="border border-black/15 px-4 py-3 text-sm hover:border-black/30 transition-colors"
                    >
                      Voice
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Single Generate button */}
          <div className="border-t border-black/10 pt-5">
            {!clientId ? (
              <p className="text-sm text-black/40">Select a client above to generate a programme.</p>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => void handleGenerate()}
                  disabled={generating}
                  className="border border-black bg-black text-white px-8 py-3 text-sm hover:bg-white hover:text-black transition-colors disabled:opacity-40"
                >
                  {generating ? genStatus || 'Generating…' : 'Generate'}
                </button>
                {brainSaved && <p className="text-xs text-emerald-700">✓ Client brain updated</p>}
                {genStatus && !generating && (
                  <p className={`text-xs ${genStatus.toLowerCase().includes('fail') || genStatus.toLowerCase().includes('timed out') || genStatus.toLowerCase().includes('error') ? 'text-red-600' : 'text-black/40'}`}>{genStatus}</p>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {step === 2 && (() => {
        const activeStepIdx = PIPELINE_STEPS.indexOf(genStatus as typeof PIPELINE_STEPS[number]);
        const pct = generating
          ? activeStepIdx >= 0
            ? Math.round((activeStepIdx + 1) / PIPELINE_STEPS.length * 100)
            : 5
          : 100;

        if (generating) {
          return (
            <div className="space-y-6 max-w-lg">
              <div>
                <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">
                  Generating programme{selectedClient ? ` for ${selectedClient.name}` : ''}
                </p>
                <div className="mt-4 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-black/50 truncate pr-4">{genStatus || 'Starting…'}</span>
                    <span className="text-xs font-medium text-black shrink-0">{pct}%</span>
                  </div>
                  <div className="h-px bg-black/8 w-full">
                    <div
                      className="h-px bg-black transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  {PIPELINE_STEPS.map((label, idx) => {
                    const done = idx < activeStepIdx;
                    const active = idx === activeStepIdx;
                    const completedStep = completedSteps.find((s) => s.name === label);
                    return (
                      <div key={idx} className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors duration-300 ${
                          done ? 'bg-black' : active ? 'bg-black/12' : 'bg-black/5'
                        }`}>
                          {done && <span className="text-white text-[0.5rem] leading-none">✓</span>}
                          {active && <span className="block w-1.5 h-1.5 rounded-full bg-black animate-pulse" />}
                        </div>
                        <span className={`text-xs transition-colors duration-300 ${
                          done ? 'text-black/30' : active ? 'text-black font-medium' : 'text-black/20'
                        }`}>
                          {label.replace('…', '')}
                          {completedStep && completedStep.elapsed > 0 && (
                            <span className="ml-2 text-black/20">{completedStep.elapsed}s</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-black/25 mt-8">Takes 3–7 minutes. Keep this tab open.</p>
              </div>
            </div>
          );
        }

        if (genStatus && programme.phases.length === 0) {
          return (
            <div className="space-y-4">
              <p className="text-sm text-red-600">{genStatus}</p>
              <button onClick={() => { setGenerating(false); setGenStatus(''); setStep(1); }}
                className="border border-black/15 px-5 py-2.5 text-sm hover:bg-black/5 transition-colors">
                ← Back
              </button>
            </div>
          );
        }

        const hardFailures = Array.isArray(validationSummary?.hard_rule_failures) ? validationSummary.hard_rule_failures as string[] : [];
        const findings = Array.isArray(validationSummary?.findings) ? validationSummary.findings as string[] : [];

        return (
          <div className="space-y-5">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">
              {programme.phases.length} phase{programme.phases.length !== 1 ? 's' : ''} generated
            </p>

            {(agentDraftSummary || hardFailures.length > 0) && (
              <div className={`border px-4 py-3 ${hardFailures.length > 0 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                {hardFailures.length > 0 && (
                  <p className="text-xs font-medium text-red-700 mb-1">{hardFailures.length} validation issue{hardFailures.length !== 1 ? 's' : ''} — review before editing</p>
                )}
                {findings.length > 0 && (
                  <p className="text-xs text-amber-700">{findings.length} review note{findings.length !== 1 ? 's' : ''}</p>
                )}
                {agentDraftSummary && !hardFailures.length && (
                  <p className="text-xs text-amber-800 leading-relaxed">{agentDraftSummary}</p>
                )}
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {programme.phases.map((ph, i) => (
                <div key={ph.id} className="border border-black/10 p-4">
                  <p className="text-[0.55rem] uppercase tracking-[0.12em] text-black/25 mb-1">Phase {i + 1}</p>
                  <p className="font-medium text-sm leading-snug mb-2">{ph.title || `Phase ${i + 1}`}</p>
                  <p className="text-xs text-black/40">
                    {ph.weeks ? `${ph.weeks}w` : '—'}
                    {ph.days.length > 0 && ` · ${ph.days.length} day${ph.days.length !== 1 ? 's' : ''}`}
                  </p>
                  {ph.focus && (
                    <p className="text-xs text-black/30 mt-1.5 truncate">{ph.focus}</p>
                  )}
                  {ph.week_blocks && ph.week_blocks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ph.week_blocks.slice(0, 4).map((block, bi) => (
                        <span key={bi} className="text-[0.5rem] text-black/35 border border-black/8 px-1.5 py-0.5">
                          {block.sets ? `${block.sets}s` : block.weight_pct} · {block.weeks}w
                        </span>
                      ))}
                      {ph.week_blocks.length > 4 && (
                        <span className="text-[0.5rem] text-black/25 border border-black/8 px-1.5 py-0.5">
                          +{ph.week_blocks.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)}
                className="border border-black/15 px-5 py-2.5 text-sm hover:bg-black/5 transition-colors">
                ← Back
              </button>
              <button
                onClick={() => { setActivePhaseTab(0); setActiveDay(null); setStep(3); }}
                disabled={programme.phases.length === 0}
                className="border border-black bg-black text-white px-5 py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
              >
                Edit exercises →
              </button>
            </div>
          </div>
        );
      })()}

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
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">
                  {phase.title} {boardView ? '— drag exercises between days' : '— select a day to edit'}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="flex items-center border border-black/10 text-xs">
                    <button
                      type="button"
                      onClick={() => { const n = Math.max(parseInt(phase.weeks, 10) || 1, 1); if (n > 1) patchPhase(activePhaseTab, { weeks: String(n - 1) }); }}
                      disabled={(parseInt(phase.weeks, 10) || 1) <= 1}
                      className="px-2 py-1.5 text-black/40 hover:text-black hover:bg-black/[0.04] transition-colors disabled:opacity-25"
                    >
                      −
                    </button>
                    <span className="px-2 text-black/55 tabular-nums">{phase.weeks}w</span>
                    <button
                      type="button"
                      onClick={() => { const n = Math.max(parseInt(phase.weeks, 10) || 0, 0); patchPhase(activePhaseTab, { weeks: String(n + 1) }); }}
                      className="px-2 py-1.5 text-black/40 hover:text-black hover:bg-black/[0.04] transition-colors"
                    >
                      +
                    </button>
                  </div>
                  {phase.days.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setBoardView((v) => !v); setActiveDay(null); }}
                      className={`border px-3 py-1.5 text-xs transition-colors ${boardView ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black/35'}`}
                    >
                      {boardView ? 'List view' : 'Board view'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCurrentWorkoutImportOpen(true)}
                    className="border border-black/15 px-3 py-1.5 text-xs transition-colors hover:border-black/35"
                  >
                    + Add current workout
                  </button>
                </div>
              </div>
              {currentWorkoutImportStatus && <p className="mb-4 text-xs text-black/50">{currentWorkoutImportStatus}</p>}

              {boardView ? (
                <div className="space-y-3">
                  {(() => {
                    const dayBands = phase.days.map((d) => groupBands(d.exercises));
                    const maxBands = Math.max(1, ...dayBands.map((b) => b.length));
                    return (
                  <div className="max-w-full overflow-x-auto pb-3">
                  <div
                    className="grid min-w-full items-start gap-x-3"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(phase.days.length, 1)}, minmax(17rem, 1fr))`,
                      gridTemplateRows: `auto repeat(${maxBands}, auto)`,
                    }}
                  >
                    {phase.days.map((day, di) => (
                      <div
                        key={day.id}
                        onDragOver={(e) => { e.preventDefault(); if (dragOverDay !== di) setDragOverDay(di); }}
                        onDragLeave={() => setDragOverDay((current) => (current === di ? null : current))}
                        onDrop={(e) => { e.preventDefault(); if (dragEx) moveExerciseToDay(dragEx.dayIndex, dragEx.exId, di); setDragEx(null); setDragOverDay(null); }}
                        style={{ gridRow: `1 / span ${maxBands + 1}`, gridTemplateRows: 'subgrid' }}
                        className={`grid w-full min-w-0 max-w-full rounded-lg border p-2 transition-colors ${dragOverDay === di ? 'border-emerald-400 bg-emerald-50/40' : 'border-black/10 bg-black/[0.01]'}`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-1 px-1">
                          <div className="min-w-0">
                            <p className="text-xs font-medium leading-tight">{day.title || `Day ${di + 1}`}</p>
                            {day.focus && <p className="mt-0.5 truncate text-[0.62rem] text-black/35">{day.focus}</p>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button type="button" onClick={() => { setBoardView(false); setActiveDay(di); }} className="text-[0.6rem] text-black/35 hover:text-black">edit</button>
                            <button type="button" onClick={() => deleteDay(activePhaseTab, di)} className="text-[0.65rem] text-black/25 hover:text-red-500 transition-colors" title="Delete day">×</button>
                          </div>
                        </div>
                        {dayBands[di].map((band, bi) => (
                          <div
                            key={band[0].id}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (dragEx) moveExerciseToSuperset(dragEx.dayIndex, dragEx.exId, di, band[0].id);
                              setDragEx(null);
                              setDragOverDay(null);
                            }}
                            className={`flex min-w-0 max-w-full flex-col gap-1.5 ${bi > 0 ? 'mt-2 border-t border-dashed border-black/15 pt-2' : ''}`}
                          >
                            {band[0].section_start && <p className="truncate px-1 pb-0.5 text-[0.55rem] uppercase tracking-wider text-black/30">{band[0].section_start}</p>}
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
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (dragEx) {
                                      if (band.length > 1 || ex.superset_id) moveExerciseToSuperset(dragEx.dayIndex, dragEx.exId, di, ex.id);
                                      else moveExerciseToDay(dragEx.dayIndex, dragEx.exId, di, ex.id);
                                    }
                                    setDragEx(null);
                                    setDragOverDay(null);
                                  }}
                                  className={`relative box-border w-full max-w-full min-w-0 rounded border bg-white px-2 py-1.5 text-[0.7rem] shadow-sm transition ${isEditing ? 'border-black/30' : dragEx?.exId === ex.id ? 'cursor-grab opacity-40 border-black/10' : 'cursor-grab border-black/10 hover:border-black/25'}`}
                                >
                                  {isEditing ? (
                                    <div className="min-w-0" onMouseDown={(e) => e.stopPropagation()}>
                                      <div className="flex min-w-0 items-center gap-1">
                                        <div className="relative min-w-0 flex-1">
                                          <input
                                            autoFocus
                                            draggable={false}
                                            value={ex.name}
                                            onChange={(e) => patchBoardExercise(activePhaseTab, di, ex.id, { name: e.target.value, exercise_id: null, video_url: null })}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape' || e.key === 'Enter') setBoardEditExId(null);
                                            }}
                                            placeholder="Exercise name"
                                            className="w-full border border-black/20 bg-white px-1.5 py-0.5 text-[0.7rem] outline-none focus:border-black/40"
                                          />
                                          {boardMatches.length > 0 && (
                                            <div className="exercise-autocomplete no-glass absolute left-0 top-full z-30 max-h-44 w-48 max-w-[calc(100vw-2rem)] overflow-y-auto border border-black/15 shadow-md">
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
                                                  className="flex w-full min-w-0 items-baseline gap-1.5 px-2 py-1.5 text-left text-[0.7rem] hover:bg-black/5"
                                                >
                                                  <span className="min-w-0 flex-1 truncate">{libEx.name}</span>
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
                                      <div className="flex min-w-0 flex-wrap items-start gap-1.5 leading-tight">
                                        <p
                                          className="min-w-0 flex-1 cursor-text break-words font-medium [overflow-wrap:anywhere] hover:text-black/60"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setBoardEditExId(ex.id);
                                          }}
                                        >
                                          {ex.name}
                                        </p>
                                        {(() => {
                                          const p = resolvePattern(ex, libById);
                                          if (!p) return null;
                                          return (
                                            <span className={`mt-px max-w-full truncate rounded-full px-1.5 text-[0.48rem] font-medium uppercase tracking-wider leading-[1.8] ring-1 ring-inset ${patternChipClass(p)}`}>
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
                  </div>
                    );
                  })()}
                </div>
              ) : currentDay === null ? (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {phase.days.map((day, di) => (
                      <div
                        key={day.id}
                        className="relative group border border-black/10 p-5 text-left hover:border-black/30 hover:shadow-sm transition-all cursor-pointer"
                        onClick={() => setActiveDay(di)}
                      >
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); deleteDay(activePhaseTab, di); }}
                          className="absolute right-2 top-2 p-1 text-black/20 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all text-base leading-none"
                          title="Delete day"
                        >
                          ×
                        </button>
                        <p className="font-medium text-sm">{day.title || `Day ${di + 1}`}</p>
                        <p className="text-xs text-black/40 mt-0.5">{day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}</p>
                        {day.focus && <p className="text-xs text-black/30 mt-1 truncate">{day.focus}</p>}
                      </div>
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

                      <PTDayEditor
                        exercises={currentDay.exercises}
                        libraryExercises={exercises}
                        weekBlocks={phase.week_blocks}
                        onChange={(updated) => patchDay(activePhaseTab, activeDay, { exercises: updated })}
                      />

                      <div className="mt-6 flex justify-end border-t border-black/10 pt-4">
                        <button
                          type="button"
                          onClick={saveCurrentDay}
                          className="border border-black bg-black px-5 py-2.5 text-sm text-white transition-colors hover:bg-black hover:text-white"
                        >
                          Save
                        </button>
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
              Finish →
            </button>
          </div>

          <CurrentWorkoutImportModal
            open={currentWorkoutImportOpen}
            onClose={() => setCurrentWorkoutImportOpen(false)}
            onImported={handleCurrentWorkoutImported}
          />
        </div>
      )}

      {step === 4 && (
        <div className="max-w-lg space-y-5">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Review & create</p>

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
            {selectedClient && <p className="text-sm font-medium mb-1">{selectedClient.name}</p>}
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
              {saving ? 'Creating…' : `Create draft${selectedClient ? ` for ${selectedClient.name}` : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
