'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { makeId, safeProgramme, exerciseFromLibrary, countProgrammeWeeks, parseWeekBlocks, formatWeekBlocks, DEFAULT_PROGRAMME_PHASES, getPhaseStartWeeks } from '@/utils/pt/programme';
import type {
  PTClient, PTExercise, PTProgramme, PTProgrammePhase, PTProgrammeDay,
} from '@/utils/pt/types';
import PTDayEditor from '../PTDayEditor';

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

  const [editingPhase, setEditingPhase] = useState<number | null>(null);
  const [activePhaseTab, setActivePhaseTab] = useState(0);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [weekBlocksInput, setWeekBlocksInput] = useState<Record<number, string>>({});
  const [listeningForPhase, setListeningForPhase] = useState<number | null>(null);
  const [agentDraftSummary, setAgentDraftSummary] = useState('');
  const [generationRunId, setGenerationRunId] = useState<string | null>(null);
  const [validationSummary, setValidationSummary] = useState<Record<string, unknown>>({});
  const [phaseNutritionDraft, setPhaseNutritionDraft] = useState<unknown[]>([]);

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
    const draftKey = new URLSearchParams(window.location.search).get('draftKey');
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
        const json = await res.json() as { text?: string; error?: string };
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
      setIntakeStatus((data as { error?: string })?.error ?? error?.message ?? 'Ingest failed.');
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

    if (intakeFiles.length > 0 || brainDump.trim()) {
      setGenStatus('Saving intake to client brain…');
      const { data: ingestData, error: ingestError } = await supabase.functions.invoke('ingest-client-intake', {
        body: { client_id: clientId, files: intakeFiles, notes_text: brainDump },
      });
      if (ingestError || (ingestData as { error?: string })?.error) {
        setGenStatus((ingestData as { error?: string })?.error ?? ingestError?.message ?? 'Brain save failed.');
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
      setGenStatus((data as { error?: string })?.error ?? error?.message ?? 'Generation failed.');
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
        case 'METHODOLOGY_PLAN': return 'Planning methodology (knowledge base RAG)…';
        case 'PROGRAMME_SYNTHESIS_FOUNDATION': return 'Synthesising Foundation (1/5)…';
        case 'PROGRAMME_SYNTHESIS_1RM_TEST': return 'Synthesising 1RM Test (2/5)…';
        case 'PROGRAMME_SYNTHESIS_HYPERTROPHY': return 'Synthesising Hypertrophy (3/5)…';
        case 'PROGRAMME_SYNTHESIS_STRENGTH': return 'Synthesising Strength (4/5)…';
        case 'PROGRAMME_SYNTHESIS_1RM_RETEST': return 'Synthesising 1RM Retest (5/5)…';
        case 'VALIDATION': return 'Validating…';
        default:
          if (cmd?.startsWith('PROGRAMME_SYNTHESIS_')) return 'Synthesising phase…';
          return 'Working…';
      }
    };

    const pollDeadline = Date.now() + 7 * 60_000;
    while (Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: row } = await supabase
        .from('pt_program_generation_runs')
        .select('status, current_command, programme_draft, validation_summary, failure_reason')
        .eq('id', kickoff.run_id)
        .maybeSingle();
      if (!row) continue;
      setGenStatus(commandLabel(row.current_command));
      if (row.status === 'failed') {
        setGenStatus(row.failure_reason ?? 'Pipeline failed.');
        setGenerating(false);
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
    setGenStatus('Pipeline still running after 7 minutes — open the review page to check progress.');
    setGenerating(false);
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
        status: 'active',
        programme,
        generation_run_id: generationRunId,
        coach_review_status: 'approved',
        validation_summary: validationSummary,
        nutrition_sync: { phase_nutrition: phaseNutritionDraft },
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

  return (
    <div className="max-w-4xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
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
          {step === 1 ? 'Generate' : step === 2 ? 'Edit phases' : step === 3 ? 'Build workouts' : 'Save template'}
        </span>
      </div>

      {agentDraftSummary && (
        <div className="mb-6 border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Programming agent draft</p>
          <p className="mt-1 text-xs leading-relaxed text-black/55">{agentDraftSummary}</p>
        </div>
      )}

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
                {genStatus && !generating && <p className="text-xs text-black/40">{genStatus}</p>}
              </div>
            )}
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
                      <p className="text-[0.6rem] text-black/30 mb-2">
                        e.g. "2 sets for 2 weeks..." or "75% for 1 week, 85% for 3 weeks"
                      </p>
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
                      onClick={() => {
                        applyWeekBlocksInput(i);
                        setEditingPhase(null);
                      }}
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
                      <button type="button" onClick={(e) => { e.stopPropagation(); removePhase(i); }}
                        className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
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

                      <PTDayEditor
                        exercises={currentDay.exercises}
                        libraryExercises={exercises}
                        weekBlocks={phase.week_blocks}
                        onChange={(updated) => patchDay(activePhaseTab, activeDay, { exercises: updated })}
                      />
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
        </div>
      )}

      {step === 4 && (
        <div className="max-w-lg space-y-5">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Save as global template{clientId && selectedClient ? ` · also assign to ${selectedClient.name}` : ''}</p>

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
              {saving ? 'Saving…' : clientId && selectedClient ? `Save & assign to ${selectedClient.name}` : 'Save template'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
