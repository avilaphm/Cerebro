'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import {
  appendDaysToFoundationPhase,
  countProgrammeWeeks,
  formatWeekBlocks,
  getCursorForWeeksLeft,
  getPhaseStartWeeks,
  getPhaseTotalWeeks,
  getWeeksLeftFromCursor,
  makeId,
  moveExerciseBetweenProgrammeDays,
  moveExerciseIntoProgrammeSuperset,
  parseWeekBlocks,
  safeProgramme,
  groupBands,
} from '@/utils/pt/programme';
import { patternChipClass, resolvePattern } from '@/utils/pt/patterns';
import type {
  PTExercise, PTProgramme, PTProgrammePhase, PTProgrammeDay, PTProgrammeExercise, PTProgramAssignment,
} from '@/utils/pt/types';
import PTDayEditor from '../../PTDayEditor';
import CurrentWorkoutImportModal from '../../CurrentWorkoutImportModal';

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
interface SpeechRecognitionErrorEventLike {
  error?: string;
}
interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror?: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

interface ProgrammingAgentDraft {
  mode?: 'new_programme' | 'revise_programme';
  assignment_id?: string | null;
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

interface PhaseRebuildChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

interface PhaseRebuildMessagePayload {
  run_id?: string;
  ready?: boolean;
  assistant_message?: string;
  messages?: PhaseRebuildChatMessage[];
  missing_questions?: string[];
  captured?: Record<string, unknown>;
  one_rm_map?: Record<string, number>;
  error?: string;
}

interface PhaseRebuildPayload {
  run_id?: string;
  phase?: PTProgrammePhase;
  one_rm_map?: Record<string, number>;
  resolved_loads?: unknown[];
  weekly_set_volume?: Record<string, number>;
  movement_pattern_coverage?: Record<string, number>;
  split_selected?: string;
  unilateral_bilateral_balance?: unknown;
  client_needs_applied?: unknown;
  assumptions?: string[];
  web_research_used?: boolean;
  questions_answered?: string[];
  review_notes?: string[];
  matched_count?: number;
  error?: string;
}

interface PhaseNutritionRow {
  id?: string;
  phase_index: number;
  phase_title: string;
  phase_type: string;
  training_context: Record<string, unknown>;
  recommendations: Record<string, unknown>;
  review_status: string;
}

function formatCapturedValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (value === null || value === undefined || value === '') return 'Not set';
  return String(value);
}

function toNutritionRows(items: unknown[]): PhaseNutritionRow[] {
  return items.map((item, index) => {
    const record = typeof item === 'object' && item !== null && !Array.isArray(item)
      ? item as Record<string, unknown> : {};
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      phase_index: typeof record.phase_index === 'number' ? record.phase_index : index,
      phase_title: typeof record.phase_title === 'string' ? record.phase_title : `Phase ${index + 1}`,
      phase_type: typeof record.phase_type === 'string' ? record.phase_type : 'general',
      training_context: typeof record.training_context === 'object' && record.training_context !== null
        ? record.training_context as Record<string, unknown> : {},
      recommendations: typeof record.recommendations === 'object' && record.recommendations !== null
        ? record.recommendations as Record<string, unknown> : {},
      review_status: typeof record.review_status === 'string' ? record.review_status : 'draft',
    };
  });
}

function extractRecText(rec: Record<string, unknown>): string {
  return Object.values(rec).filter((v) => typeof v === 'string').join('\n\n');
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), length - 1);
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

const BIG_5_ALIASES: Array<[string, string[]]> = [
  ['BB Squat', ['squat', 'bb squat', 'barbell squat', 'back squat']],
  ['BB Deadlift', ['deadlift', 'bb deadlift', 'barbell deadlift', 'conventional deadlift', 'romanian deadlift', 'rdl']],
  ['BB Bench Press', ['bench press', 'bb bench', 'barbell bench', 'chest press', 'bb chest press']],
  ['BB Shoulder Press', ['shoulder press', 'overhead press', 'ohp', 'bb shoulder press', 'barbell shoulder press', 'military press']],
  ['Pull-up', ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup']],
];

function matchCanonicalLift(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [canonical, aliases] of BIG_5_ALIASES) {
    if (aliases.some((alias) => lower.includes(alias))) return canonical;
  }
  return null;
}

function resolveKgFromPct(pctStr: string, oneRmKg: number): number | null {
  const pct = Number.parseFloat(pctStr.replace('%', '').trim());
  if (!Number.isFinite(pct) || pct <= 0 || pct > 200) return null;
  return Math.round(oneRmKg * (pct / 100) * 4) / 4;
}

export default function PTProgrammeEditView({
  assignment: initial,
  exercises,
  highlight,
  phaseNutrition,
  nutritionDraftFromRun,
}: {
  assignment: PTProgramAssignment;
  exercises: PTExercise[];
  highlight?: { note?: string; phase?: string; day?: string; section?: string };
  phaseNutrition?: unknown[];
  nutritionDraftFromRun?: unknown[] | null;
}) {
  const supabase = createClient();
  const router = useRouter();

  const client = initial.pt_clients as { name: string; email: string } | null;
  const initialCursorPhaseIndex = clampIndex(initial.current_phase_index ?? 0, initial.programme.phases.length);
  const initialCursorWeeksLeft = getWeeksLeftFromCursor(
    initial.programme.phases[initialCursorPhaseIndex],
    initial.current_block_index,
    initial.current_week,
  );
  const [programme, setProgramme] = useState<PTProgramme>(initial.programme);
  const [progName, setProgName] = useState(initial.name);
  const [progGoal, setProgGoal] = useState(initial.goal ?? '');
  const [assignmentStatus, setAssignmentStatus] = useState(initial.status);
  const [cursorPhaseIndex, setCursorPhaseIndex] = useState(initialCursorPhaseIndex);
  const [cursorWeeksLeft, setCursorWeeksLeft] = useState(initialCursorWeeksLeft);
  const [cursorTouched, setCursorTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const [voiceBuildOpen, setVoiceBuildOpen] = useState(false);
  const [voiceBrief, setVoiceBrief] = useState('');
  const [voiceBuildRunId, setVoiceBuildRunId] = useState<string | null>(null);
  const [voiceBuildMessages, setVoiceBuildMessages] = useState<PhaseRebuildChatMessage[]>([]);
  const [voiceBuildCaptured, setVoiceBuildCaptured] = useState<Record<string, unknown>>({});
  const [voiceBuildBusy, setVoiceBuildBusy] = useState(false);
  const [voiceBuildStatus, setVoiceBuildStatus] = useState('');
  const [voiceBuildReady, setVoiceBuildReady] = useState(false);
  const [voiceBuildListening, setVoiceBuildListening] = useState(false);
  const [boardView, setBoardView] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [dragEx, setDragEx] = useState<{ dayIndex: number; exId: string } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [boardEditExId, setBoardEditExId] = useState<string | null>(null);
  const libById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const [currentWorkoutImportOpen, setCurrentWorkoutImportOpen] = useState(false);
  const [currentWorkoutImportStatus, setCurrentWorkoutImportStatus] = useState('');
  const highlightedPhase = Number.parseInt(highlight?.phase ?? '', 10);
  const highlightedDay = Number.parseInt(highlight?.day ?? '', 10);
  const [activePhaseTab, setActivePhaseTab] = useState(Number.isFinite(highlightedPhase) ? highlightedPhase : 0);
  const [activeDay, setActiveDay] = useState<number | null>(Number.isFinite(highlightedDay) ? highlightedDay : null);
  const [weekBlocksInput, setWeekBlocksInput] = useState<Record<number, string>>({});
  const [listeningForPhase, setListeningForPhase] = useState<number | null>(null);
  const [agentDraftSummary, setAgentDraftSummary] = useState('');
  const [generationRunId, setGenerationRunId] = useState<string | null>(initial.generation_run_id ?? null);
  const [validationSummary, setValidationSummary] = useState<Record<string, unknown>>(initial.validation_summary ?? {});
  const [nutritionRows, setNutritionRows] = useState<PhaseNutritionRow[]>(
    (phaseNutrition ?? []).length > 0
      ? toNutritionRows(phaseNutrition as unknown[])
      : (nutritionDraftFromRun ?? []).length > 0
      ? toNutritionRows(nutritionDraftFromRun as unknown[])
      : []
  );
  const [nutritionExpanded, setNutritionExpanded] = useState<Record<number, boolean>>({});
  const [nutritionApplyOpen, setNutritionApplyOpen] = useState(false);
  const [applyPhaseIdx, setApplyPhaseIdx] = useState(0);
  const [applyTargets, setApplyTargets] = useState({ protein_g: 150, carbs_g: 200, fat_g: 65, fibre_g: 30, calories: 2000 });
  const [applyBusy, setApplyBusy] = useState(false);
  const srPhaseRef = useRef<SpeechRecognitionLike | null>(null);
  const srVoiceBuildRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef('');
  const voiceBuildTranscriptRef = useRef('');

  const update = (fn: (p: PTProgramme) => PTProgramme) =>
    setProgramme((cur) => fn(structuredClone(cur)));

  useEffect(() => {
    const draftKey = new URLSearchParams(window.location.search).get('draftKey');
    if (!draftKey) return;

    const raw = sessionStorage.getItem(draftKey);
    if (!raw) return;

    try {
      const draft = JSON.parse(raw) as ProgrammingAgentDraft;
      if (draft.mode !== 'revise_programme') return;
      if (draft.assignment_id && draft.assignment_id !== initial.id) return;

      if (typeof draft.name === 'string') setProgName(draft.name);
      if (typeof draft.goal === 'string') setProgGoal(draft.goal);
      if (typeof draft.run_id === 'string') setGenerationRunId(draft.run_id);
      if (draft.validation_summary) setValidationSummary(draft.validation_summary);
      if (Array.isArray(draft.phase_nutrition)) setNutritionRows(toNutritionRows(draft.phase_nutrition));
      setProgramme(safeProgramme(draft.programme));
      setAgentDraftSummary(draftReviewSummary(draft, 'AI revision draft loaded. Review before saving.'));
      setStatus('AI draft loaded.');
    } catch {
      setStatus('Could not load AI draft.');
    }
  }, [initial.id]);

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
      + (created > 0 ? ` and created ${created} exercise card${created === 1 ? '' : 's'} for videos later. Save changes to keep the imported days.` : '. Save changes to keep the imported days.'),
    );
  };

  const startVoiceBuildDictation = () => {
    const SR = getSR();
    if (!SR) {
      setVoiceBuildStatus('Browser dictation is not available. Use Chrome desktop/Android, or type the brief.');
      return;
    }
    srVoiceBuildRef.current?.abort?.();
    voiceBuildTranscriptRef.current = voiceBrief.trim();
    const recognition = new SR();
    srVoiceBuildRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-AU';
    recognition.onresult = (event) => {
      let next = voiceBuildTranscriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) {
          const text = result[0]?.transcript?.trim() ?? '';
          if (text) next = `${next}${next ? '\n' : ''}${text}`;
        }
      }
      voiceBuildTranscriptRef.current = next;
      setVoiceBrief(next);
      setVoiceBuildReady(false);
    };
    recognition.onerror = (event) => {
      if (srVoiceBuildRef.current !== recognition) return;
      setVoiceBuildListening(false);
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setVoiceBuildStatus('Microphone is blocked for this site. In Chrome, click the tune/lock icon beside the address bar and allow Microphone, or keep typing the brief here.');
        return;
      }
      if (event.error === 'no-speech') {
        setVoiceBuildStatus('I did not catch any words. Your typed brief is still here; try recording again or keep typing.');
        return;
      }
      setVoiceBuildStatus(`Could not record voice${event.error ? ` (${event.error})` : ''}. Your typed brief is still here; try again or keep typing.`);
    };
    recognition.onend = () => {
      if (srVoiceBuildRef.current !== recognition) return;
      srVoiceBuildRef.current = null;
      setVoiceBuildListening(false);
    };
    try {
      recognition.start();
      setVoiceBuildListening(true);
      setVoiceBuildStatus(
        voiceBrief.trim()
          ? 'Recording. I will add this to the brief you already typed.'
          : 'Recording. Speak the phase, then stop and ask the agent to check it.',
      );
    } catch {
      srVoiceBuildRef.current = null;
      setVoiceBuildListening(false);
      setVoiceBuildStatus('Could not start dictation. Your typed brief is still here; try again or keep typing.');
    }
  };

  const stopVoiceBuildDictation = () => {
    srVoiceBuildRef.current?.stop();
    setVoiceBuildListening(false);
  };

  const sendVoiceBuildMessage = async () => {
    const message = voiceBrief.trim();
    if (message.length < 2) {
      setVoiceBuildStatus('Type or record a message for the agent first.');
      return;
    }
    setVoiceBuildBusy(true);
    setVoiceBuildStatus('Agent is reading the client context and your message...');
    const { data, error } = await supabase.functions.invoke('rebuild-programme-phase', {
      body: {
        action: 'message',
        assignment_id: initial.id,
        client_id: initial.client_id,
        phase_index: activePhaseTab,
        run_id: voiceBuildRunId,
        message,
      },
    });
    setVoiceBuildBusy(false);
    const payload = data as PhaseRebuildMessagePayload | null;
    if (error || payload?.error) {
      setVoiceBuildStatus(payload?.error ?? 'Could not continue the phase-builder chat.');
      return;
    }
    if (payload?.run_id) setVoiceBuildRunId(payload.run_id);
    if (payload?.messages) setVoiceBuildMessages(payload.messages);
    if (payload?.captured) setVoiceBuildCaptured(payload.captured);
    if (payload?.one_rm_map) {
      setValidationSummary((cur) => ({ ...cur, one_rm_map: payload.one_rm_map }));
    }
    setVoiceBrief('');
    setVoiceBuildReady(Boolean(payload?.ready));
    setVoiceBuildStatus(
      payload?.ready
        ? 'The agent has enough detail. Generate the replacement phase when ready.'
        : 'Answer the agent, then send another message.',
    );
  };

  const generateVoiceBuildPhase = async () => {
    const hasChat = voiceBuildMessages.some((message) => message.role === 'user');
    if (!hasChat && voiceBrief.trim().length < 2) {
      setVoiceBuildStatus('Send at least one message to the agent before generating.');
      return;
    }
    const currentPhaseTitle = programme.phases[activePhaseTab]?.title ?? `Phase ${activePhaseTab + 1}`;
    if (!window.confirm(`Replace "${currentPhaseTitle}" with an AI draft from this brief? You can still review it before saving.`)) return;
    setVoiceBuildBusy(true);
    setVoiceBuildStatus(`Rebuilding ${currentPhaseTitle} from the brief, client history, and 1RM results...`);
    const { data, error } = await supabase.functions.invoke('rebuild-programme-phase', {
      body: {
        action: 'generate',
        assignment_id: initial.id,
        client_id: initial.client_id,
        phase_index: activePhaseTab,
        run_id: voiceBuildRunId,
        transcript: voiceBrief.trim(),
      },
    });
    setVoiceBuildBusy(false);
    const payload = data as PhaseRebuildPayload | null;
    if (error || payload?.error || !payload?.phase) {
      setVoiceBuildStatus(payload?.error ?? error?.message ?? 'Could not rebuild that phase.');
      return;
    }
    const replacementPhase: PTProgrammePhase = {
      ...payload.phase,
      id: programme.phases[activePhaseTab]?.id ?? payload.phase.id ?? makeId('phase'),
    };
    update((p) => {
      p.phases[activePhaseTab] = replacementPhase;
      return p;
    });
    setValidationSummary((cur) => ({
      ...cur,
      ...(payload.run_id ? { phase_rebuild_chat_run_id: payload.run_id } : {}),
      ...(payload.one_rm_map ? { one_rm_map: payload.one_rm_map } : {}),
      ...(payload.resolved_loads ? { resolved_loads: payload.resolved_loads } : {}),
      ...(payload.weekly_set_volume ? { weekly_set_volume: payload.weekly_set_volume } : {}),
      ...(payload.movement_pattern_coverage ? { movement_pattern_coverage: payload.movement_pattern_coverage } : {}),
      ...(payload.split_selected ? { split_selected: payload.split_selected } : {}),
      ...(payload.unilateral_bilateral_balance ? { unilateral_bilateral_balance: payload.unilateral_bilateral_balance } : {}),
      ...(payload.client_needs_applied ? { client_needs_applied: payload.client_needs_applied } : {}),
      phase_rebuild_assumptions: payload.assumptions ?? [],
      phase_rebuild_web_research_used: Boolean(payload.web_research_used),
      phase_rebuild_review_notes: payload.review_notes ?? [],
      phase_rebuild_questions_answered: payload.questions_answered ?? [],
    }));
    setActiveDay(null);
    setBoardView(true);
    setVoiceBuildReady(false);
    setVoiceBuildOpen(false);
    setVoiceBrief('');
    setVoiceBuildStatus(
      `Replaced ${currentPhaseTitle} with an editable draft`
      + (payload.matched_count !== undefined ? ` (${payload.matched_count} linked exercise${payload.matched_count === 1 ? '' : 's'})` : '')
      + '. Review it, adjust anything needed, then Save changes.',
    );
  };

  const addDay = (phaseIdx: number) => update((p) => {
    const ph = p.phases[phaseIdx];
    ph.days.push({ id: makeId('day'), title: `Day ${ph.days.length + 1}`, focus: '', exercises: [] });
    return p;
  });

  const patchDay = (pi: number, di: number, patch: Partial<PTProgrammeDay>) => update((p) => {
    p.phases[pi].days[di] = { ...p.phases[pi].days[di], ...patch }; return p;
  });

  const getBoardMatches = (name: string) =>
    name.length >= 2 ? exercises.filter((e) => e.name.toLowerCase().includes(name.toLowerCase())).slice(0, 6) : [];

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
    // Seed transcript from current input or existing blocks
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
      // Update visible input only — no parsing until Done is clicked
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

  const save = async (nextStatus: PTProgramAssignment['status'] = assignmentStatus) => {
    setSaving(true);
    const publishing = nextStatus === 'active' && assignmentStatus !== 'active';
    setStatus(publishing ? 'Publishing…' : 'Saving…');
    if (publishing) {
      await supabase
        .from('pt_program_assignments')
        .update({ status: 'paused' })
        .eq('client_id', initial.client_id)
        .eq('status', 'active')
        .neq('id', initial.id);
    }
    const { error } = await supabase
      .from('pt_program_assignments')
      .update({
        name: progName.trim(),
        goal: progGoal.trim() || null,
        duration_weeks: countProgrammeWeeks(programme),
        phase_count: programme.phases.length,
        status: nextStatus,
        programme,
        generation_run_id: generationRunId,
        coach_review_status: 'approved',
        validation_summary: validationSummary,
        ...(cursorChanged ? {
          current_phase_index: cursor.phaseIndex,
          current_block_index: cursor.blockIndex,
          current_week: cursor.week,
        } : {}),
      })
      .eq('id', initial.id);
    if (error) {
      setStatus(`Error: ${error.message}`);
      setSaving(false);
    } else {
      if (nutritionRows.length > 0) {
        await supabase.from('pt_phase_nutrition').upsert(
          nutritionRows.map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            client_id: initial.client_id,
            assignment_id: initial.id,
            generation_run_id: generationRunId,
            phase_index: row.phase_index,
            phase_title: row.phase_title,
            phase_type: row.phase_type,
            training_context: row.training_context,
            recommendations: row.recommendations,
            review_status: row.review_status,
          })),
          { onConflict: 'assignment_id,phase_index' },
        );
      }
      if (highlight?.note) {
        await supabase.from('pt_client_notes').update({ is_active: false }).eq('id', highlight.note);
      }
      if (cursorChanged) {
        await supabase.from('pt_events').insert({
          client_id: initial.client_id,
          assignment_id: initial.id,
          event_type: 'programme_position_changed',
          metadata: {
            source: 'programme_edit',
            assignment_name: progName.trim(),
            from: {
              phase_index: initial.current_phase_index,
              block_index: initial.current_block_index,
              week: initial.current_week,
            },
            to: {
              phase_index: cursor.phaseIndex,
              phase_title: programme.phases[cursor.phaseIndex]?.title ?? null,
              block_index: cursor.blockIndex,
              week: cursor.week,
              weeks_left: boundedCursorWeeksLeft,
            },
          },
        });
      }
      setAssignmentStatus(nextStatus);
      setStatus(publishing ? 'Published to client.' : 'Saved.');
      setTimeout(() => router.push(`/dashboard/pt/clients/${initial.client_id}`), 800);
    }
  };

  const markNoteDone = async () => {
    if (!highlight?.note) return;
    setSaving(true);
    await supabase.from('pt_client_notes').update({ is_active: false }).eq('id', highlight.note);
    router.push(`/dashboard/pt/clients/${initial.client_id}`);
  };

  const approvePhase = async (phaseIndex: number) => {
    const updated = nutritionRows.map((row) =>
      row.phase_index === phaseIndex ? { ...row, review_status: 'approved' } : row
    );
    setNutritionRows(updated);
    const row = updated.find((r) => r.phase_index === phaseIndex);
    if (!row) return;
    await supabase.from('pt_phase_nutrition').upsert({
      ...(row.id ? { id: row.id } : {}),
      client_id: initial.client_id,
      assignment_id: initial.id,
      generation_run_id: generationRunId,
      phase_index: row.phase_index,
      phase_title: row.phase_title,
      phase_type: row.phase_type,
      training_context: row.training_context,
      recommendations: row.recommendations,
      review_status: 'approved',
    }, { onConflict: 'assignment_id,phase_index' });
  };

  const openApplyTargets = async (defaultPhaseIdx: number) => {
    setApplyPhaseIdx(defaultPhaseIdx);
    const { data } = await supabase
      .from('pt_client_nutrition_doc')
      .select('daily_targets')
      .eq('client_id', initial.client_id)
      .single();
    if (data?.daily_targets) {
      const t = data.daily_targets as Record<string, number>;
      setApplyTargets({
        protein_g: t.protein_g ?? 150,
        carbs_g: t.carbs_g ?? 200,
        fat_g: t.fat_g ?? 65,
        fibre_g: t.fibre_g ?? 30,
        calories: t.calories ?? 2000,
      });
    }
    setNutritionApplyOpen(true);
  };

  const applyToClient = async () => {
    setApplyBusy(true);
    await supabase
      .from('pt_client_nutrition_doc')
      .update({ daily_targets: applyTargets })
      .eq('client_id', initial.client_id);
    setApplyBusy(false);
    setNutritionApplyOpen(false);
    setStatus('Nutrition targets applied to client.');
  };

  const boundedCursorPhaseIndex = clampIndex(cursorPhaseIndex, programme.phases.length);
  const cursorPhase = programme.phases[boundedCursorPhaseIndex] ?? null;
  const cursorPhaseTotalWeeks = getPhaseTotalWeeks(cursorPhase ?? undefined);
  const boundedCursorWeeksLeft = Math.min(Math.max(Math.floor(cursorWeeksLeft || 1), 1), cursorPhaseTotalWeeks);
  const cursor = getCursorForWeeksLeft(cursorPhase ?? undefined, boundedCursorPhaseIndex, boundedCursorWeeksLeft);
  const hasPersistedCursor = initial.current_phase_index !== null && initial.current_phase_index !== undefined;
  const cursorChanged =
    cursorTouched ||
    (hasPersistedCursor && (
      cursor.phaseIndex !== initial.current_phase_index ||
      cursor.blockIndex !== initial.current_block_index ||
      cursor.week !== initial.current_week
    ));

  const setCursorPhase = (phaseIndex: number) => {
    const nextIndex = clampIndex(phaseIndex, programme.phases.length);
    setCursorTouched(true);
    setCursorPhaseIndex(nextIndex);
    setCursorWeeksLeft(getPhaseTotalWeeks(programme.phases[nextIndex]));
  };

  const moveCursorPhase = (delta: number) => {
    setCursorPhase(boundedCursorPhaseIndex + delta);
  };

  const phase = programme.phases[activePhaseTab] ?? null;
  const activePhaseStartWeek = phase ? getPhaseStartWeeks(programme.phases)[activePhaseTab] ?? 1 : 1;
  const activeNutritionRow = nutritionRows.find((row) => row.phase_index === activePhaseTab) ?? null;
  const currentDay = phase && activeDay !== null ? phase.days[activeDay] ?? null : null;
  const oneRmMap = typeof validationSummary.one_rm_map === 'object' && validationSummary.one_rm_map !== null
    ? validationSummary.one_rm_map as Record<string, number>
    : undefined;

  const getLoadTag = (phaseIndex: number, ex: PTProgrammeExercise): string | null => {
    const canonical = matchCanonicalLift(ex.name);
    const oneRm = canonical && oneRmMap ? oneRmMap[canonical] : null;
    const targetPhase = programme.phases[phaseIndex];
    if (!canonical || !oneRm || !targetPhase) return null;
    const blockIndex = phaseIndex === cursor.phaseIndex ? cursor.blockIndex : 0;
    const block = targetPhase.week_blocks?.[Math.min(blockIndex, (targetPhase.week_blocks?.length ?? 1) - 1)];
    const override = ex.week_overrides?.find((item) => item.block_index === blockIndex);
    const pct = override?.weight_pct ?? block?.weight_pct;
    if (!pct) return null;
    const kg = resolveKgFromPct(pct, oneRm);
    if (kg === null) return null;
    return `${pct} -> ${kg}kg`;
  };

  return (
    <div className="max-w-4xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link href={`/dashboard/pt/clients/${initial.client_id}`} className="text-black/30 hover:text-black text-sm transition-colors">
          ← {client?.name ?? 'Client'}
        </Link>
        <span className="text-black/20">/</span>
        <span className="text-sm text-black/50">Edit programme</span>
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
          <span className="text-xs text-black/40">
            {status || (assignmentStatus === 'active' ? 'Visible to client' : 'Not visible to client')}
          </span>
          <button
            onClick={() => void save()}
            disabled={saving || !progName.trim()}
            className="border border-black/20 px-5 py-3 text-sm text-black transition-colors hover:border-black disabled:opacity-30 sm:py-2.5"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {assignmentStatus !== 'active' && (
            <button
              onClick={() => void save('active')}
              disabled={saving || !progName.trim()}
              className="border border-black bg-black px-5 py-3 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-30 sm:py-2.5"
            >
              Publish to client
            </button>
          )}
        </div>
      </div>

      {highlight?.note && (
        <div className="mb-6 border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800">Client note fix</p>
              <p className="mt-1 text-xs text-black/50">
                Opened from the client note. Save changes to clear it, or mark done if no programme edit is needed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void markNoteDone()}
              disabled={saving}
              className="shrink-0 border border-amber-300 bg-white px-4 py-2 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-40"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {agentDraftSummary && (
        <div className="mb-6 border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Programming agent draft</p>
          <p className="mt-1 text-xs leading-relaxed text-black/55">{agentDraftSummary}</p>
        </div>
      )}

      {programme.phases.length > 0 && (
        <div className="mb-8 border border-black/10 bg-[#fbfbf8] px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Client position</p>
              <p className="mt-2 text-sm text-black/55">
                {client?.name ?? 'Client'} is currently in{' '}
                <span className="font-medium text-black">{cursorPhase?.title ?? `Phase ${boundedCursorPhaseIndex + 1}`}</span>
                {' '}with <span className="font-medium text-black">{boundedCursorWeeksLeft}</span>{' '}
                week{boundedCursorWeeksLeft === 1 ? '' : 's'} left.
              </p>
              <p className="mt-1 text-xs text-black/35">
                This changes what the client sees as active. It does not shorten or rewrite the programme.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem] lg:min-w-[24rem]">
              <div>
                <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Active phase</label>
                <select
                  value={boundedCursorPhaseIndex}
                  onChange={(e) => setCursorPhase(Number(e.target.value))}
                  className="w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
                >
                  {programme.phases.map((ph, phaseIndex) => (
                    <option key={ph.id} value={phaseIndex}>{ph.title || `Phase ${phaseIndex + 1}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Weeks left</label>
                <input
                  type="number"
                  min={1}
                  max={cursorPhaseTotalWeeks}
                  value={boundedCursorWeeksLeft}
                  onChange={(e) => {
                    setCursorTouched(true);
                    setCursorWeeksLeft(Number(e.target.value));
                  }}
                  className="w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
                />
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => moveCursorPhase(-1)}
                  disabled={boundedCursorPhaseIndex === 0}
                  className="border border-black/15 px-3 py-2 text-xs transition-colors hover:border-black/35 disabled:opacity-30"
                >
                  Back one phase
                </button>
                <button
                  type="button"
                  onClick={() => moveCursorPhase(1)}
                  disabled={boundedCursorPhaseIndex >= programme.phases.length - 1}
                  className="border border-black/15 px-3 py-2 text-xs transition-colors hover:border-black/35 disabled:opacity-30"
                >
                  Forward one phase
                </button>
                {cursorChanged && (
                  <span className="self-center text-xs text-amber-700">Save changes to apply this position.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Programme steps</p>
          <button onClick={addPhase} className="border border-black/15 px-3 py-1.5 text-xs text-black/45 transition-colors hover:border-black/35 hover:text-black">
            + Add phase
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {programme.phases.map((ph, i) => (
            <button
              key={ph.id}
              type="button"
              onClick={() => {
                setActivePhaseTab(i);
                setActiveDay(null);
                setSelectedDays(new Set());
                setSelectMode(false);
              }}
              className={`flex min-w-[10.5rem] shrink-0 items-center gap-2 border px-3 py-2 text-left transition-colors ${
                activePhaseTab === i ? 'border-black bg-black text-white' : 'border-black/10 bg-white hover:border-black/30'
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[0.65rem] ${
                activePhaseTab === i ? 'border-white/40 text-white' : 'border-black/15 text-black/45'
              }`}>
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{ph.title || `Phase ${i + 1}`}</span>
                <span className={`block truncate text-[0.58rem] ${activePhaseTab === i ? 'text-white/55' : 'text-black/35'}`}>
                  {ph.weeks ? `${ph.weeks} weeks` : 'Duration not set'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {phase && (
        <div className="mb-6 border border-black/15 bg-white p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Selected phase</p>
              <p className="mt-1 text-lg font-medium">{phase.title || `Phase ${activePhaseTab + 1}`}</p>
              <p className="mt-1 text-xs text-black/40">Starts week {activePhaseStartWeek}. Edit this phase, then adjust nutrition and workouts below.</p>
            </div>
            {programme.phases.length > 1 && (
              <button type="button" onClick={() => removePhase(activePhaseTab)}
                className="self-start text-xs text-red-400 transition-colors hover:text-red-600">Remove phase</button>
            )}
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Phase name</label>
                <input value={phase.title} onChange={(e) => patchPhase(activePhaseTab, { title: e.target.value })}
                  className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
              </div>
              <div>
                <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Duration (weeks)</label>
                <input value={phase.weeks} onChange={(e) => patchPhase(activePhaseTab, { weeks: e.target.value })}
                  className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Focus</label>
              <input value={phase.focus} onChange={(e) => patchPhase(activePhaseTab, { focus: e.target.value })}
                className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
            </div>
            <div>
              <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Progression notes</label>
              <input value={phase.progression} onChange={(e) => patchPhase(activePhaseTab, { progression: e.target.value })}
                className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40" />
            </div>
            <div>
              <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">
                Progressive overload — sets or % per block
              </label>
              <p className="mb-2 text-[0.6rem] text-black/30">e.g. &quot;2 sets for 2 weeks...&quot; or &quot;75% for 1 week, 85% for 3 weeks&quot;</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={weekBlocksInput[activePhaseTab] ?? formatWeekBlocks(phase.week_blocks)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWeekBlocksInput((cur) => ({ ...cur, [activePhaseTab]: val }));
                    const parsed = parseWeekBlocks(val);
                    if (parsed.length > 0) {
                      const totalWeeks = parsed.reduce((sum, b) => sum + b.weeks, 0);
                      patchPhase(activePhaseTab, { week_blocks: parsed, weeks: String(totalWeeks) });
                    } else if (val === '') {
                      patchPhase(activePhaseTab, { week_blocks: undefined });
                    }
                  }}
                  onBlur={() => applyWeekBlocksInput(activePhaseTab)}
                  placeholder="2 sets for 2 weeks... or 75% for 1 week..."
                  className="flex-1 border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40"
                />
                {listeningForPhase === activePhaseTab ? (
                  <div className="flex gap-1">
                    <span className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">Recording</span>
                    <button type="button" onClick={stopPhraseDictation}
                      className="border border-black bg-black px-3 py-2 text-xs text-white transition-colors hover:bg-white hover:text-black">
                      Done
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => startDictationForPhase(activePhaseTab)}
                    className="border border-black/15 px-3 py-2 text-xs transition-colors hover:border-black/30">
                    Voice
                  </button>
                )}
              </div>
              {phase.week_blocks && phase.week_blocks.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {phase.week_blocks.map((block, bi) => {
                    const currentOneRmMap = typeof validationSummary.one_rm_map === 'object' && validationSummary.one_rm_map !== null ? validationSummary.one_rm_map as Record<string, number> : null;
                    const kgHints = currentOneRmMap && block.weight_pct
                      ? Object.entries(currentOneRmMap).map(([ex, oneRm]) => {
                          const pct = parseFloat(block.weight_pct!.replace('%', ''));
                          if (!Number.isFinite(pct)) return null;
                          const kg = Math.round(oneRm * (pct / 100) * 4) / 4;
                          const short = ex.replace('BB ', '').replace('Pull-up', 'PU');
                          return `${short} ~${kg}kg`;
                        }).filter(Boolean).join(' | ')
                      : null;
                    return (
                      <span key={bi} className="flex items-center gap-1">
                        <span className="flex flex-col border border-black/15 bg-black/[0.03] px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.1em]">
                          <span>{block.sets ? `${block.sets} sets` : block.weight_pct} · {block.weeks}w</span>
                          {kgHints && <span className="text-amber-700 normal-case tracking-normal">{kgHints}</span>}
                        </span>
                        {bi < (phase.week_blocks?.length ?? 0) - 1 && (
                          <span className="text-xs text-black/25">→</span>
                        )}
                      </span>
                    );
                  })}
                  <span className="ml-1 text-[0.6rem] text-black/30">= {phase.weeks}w total</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeNutritionRow && (
        <div className={`mb-6 border bg-white ${activeNutritionRow.review_status === 'approved' ? 'border-green-200' : 'border-black/15'}`}>
          <button
            type="button"
            className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-black/[0.02]"
            onClick={() => setNutritionExpanded((cur) => ({ ...cur, [activeNutritionRow.phase_index]: !cur[activeNutritionRow.phase_index] }))}
          >
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Nutrition</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {activeNutritionRow.review_status === 'approved' && <span className="text-xs font-medium text-green-600">✓</span>}
                <span className="text-sm font-medium">{activeNutritionRow.phase_title}</span>
                <span className="text-[0.55rem] uppercase tracking-[0.1em] text-black/30">{activeNutritionRow.phase_type}</span>
              </div>
            </div>
            <span className="text-[0.65rem] uppercase tracking-[0.14em] text-black/35">
              {nutritionExpanded[activeNutritionRow.phase_index] ? 'Hide' : 'Open'}
            </span>
          </button>
          {nutritionExpanded[activeNutritionRow.phase_index] && (
            <div className="space-y-3 border-t border-black/10 px-5 py-4">
              {Object.keys(activeNutritionRow.training_context).length > 0 && (
                <div>
                  <p className="mb-1 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Training context</p>
                  <p className="text-xs text-black/50">
                    {Object.entries(activeNutritionRow.training_context).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </p>
                </div>
              )}
              <div>
                <p className="mb-1 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Recommendations</p>
                <textarea
                  value={extractRecText(activeNutritionRow.recommendations)}
                  onChange={(e) => {
                    setNutritionRows((cur) => cur.map((r) =>
                      r.phase_index === activeNutritionRow.phase_index
                        ? { ...r, recommendations: { notes: e.target.value }, review_status: 'draft' }
                        : r
                    ));
                  }}
                  rows={3}
                  className="w-full resize-none border border-black/10 px-3 py-2 text-xs outline-none focus:border-black/40"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeNutritionRow.review_status === 'approved' ? (
                  <span className="text-xs text-green-600">Phase approved</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void approvePhase(activeNutritionRow.phase_index)}
                    className="border border-green-600 px-4 py-1.5 text-xs text-green-700 transition-colors hover:bg-green-50"
                  >
                    Approve this phase
                  </button>
                )}
                {nutritionRows.every((r) => r.review_status === 'approved') && (
                  <button
                    type="button"
                    onClick={() => void openApplyTargets(activePhaseTab)}
                    className="border border-black bg-black px-4 py-1.5 text-xs text-white transition-colors hover:bg-white hover:text-black"
                  >
                    Apply to client daily targets
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workouts section */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Workouts</p>
            {phase && <p className="mt-1 text-sm font-medium">{phase.title || `Phase ${activePhaseTab + 1}`}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {phase && phase.days.length > 0 && (
              <>
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
              </>
            )}
            <button
              type="button"
              onClick={() => setCurrentWorkoutImportOpen(true)}
              className="border border-black/15 px-3 py-1.5 text-xs transition-colors hover:border-black/35"
            >
              + Add current workout
            </button>
            <button
              type="button"
              onClick={() => setVoiceBuildOpen((v) => !v)}
              className={`border px-3 py-1.5 text-xs transition-colors ${voiceBuildOpen ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black/35'}`}
            >
              {voiceBuildOpen ? 'Close builder' : '+ Build with voice/text'}
            </button>
          </div>
        </div>
        {currentWorkoutImportStatus && <p className="mb-4 text-xs text-black/50">{currentWorkoutImportStatus}</p>}

        {voiceBuildOpen && phase && (
          <div className="mb-6 border border-black/15 bg-black/[0.02] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium">Chat with the programme agent</p>
                <p className="mt-1 text-xs leading-relaxed text-black/45">
                  Type, dictate, or do both for <span className="font-medium text-black">{phase.title}</span>. The agent reads client history, movement analysis, injuries, recent training, weekly set volume, movement patterns, and 1RM results before replacing this phase only.
                </p>
              </div>
              <span className="shrink-0 border border-amber-200 bg-amber-50 px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-amber-700">
                Replaces selected phase
              </span>
            </div>
            {voiceBuildMessages.length > 0 && (
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto border border-black/10 bg-white p-3">
                {voiceBuildMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}-${message.content.slice(0, 12)}`}
                    className={`max-w-[90%] border px-3 py-2 text-xs leading-relaxed ${
                      message.role === 'user'
                        ? 'ml-auto border-black bg-black text-white'
                        : 'mr-auto border-black/10 bg-black/[0.03] text-black/70'
                    }`}
                  >
                    <p className="mb-1 text-[0.58rem] uppercase tracking-[0.14em] opacity-60">
                      {message.role === 'user' ? 'Pedro' : 'Agent'}
                    </p>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(voiceBuildCaptured).length > 0 && (
              <div className="mt-3 grid gap-2 border border-black/10 bg-white p-3 sm:grid-cols-2">
                {Object.entries(voiceBuildCaptured).slice(0, 8).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-[0.58rem] uppercase tracking-[0.14em] text-black/35">{key.replaceAll('_', ' ')}</p>
                    <p className="mt-1 break-words text-xs leading-relaxed text-black/65">{formatCapturedValue(value)}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {voiceBuildListening ? (
                <>
                  <span className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">Recording</span>
                  <button
                    type="button"
                    onClick={stopVoiceBuildDictation}
                    className="border border-black bg-black px-3 py-2 text-xs text-white transition-colors hover:bg-white hover:text-black"
                  >
                    Stop recording
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startVoiceBuildDictation}
                  disabled={voiceBuildBusy}
                  className="border border-black/15 px-3 py-2 text-xs transition-colors hover:border-black/35 disabled:border-black/10 disabled:text-black/30 disabled:hover:border-black/10"
                >
                  {voiceBrief.trim() ? 'Add voice to brief' : 'Record voice brief'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void sendVoiceBuildMessage()}
                disabled={voiceBuildBusy || voiceBrief.trim().length < 2}
                className="border border-black/15 px-3 py-2 text-xs transition-colors hover:border-black/35 disabled:border-black/10 disabled:text-black/30 disabled:hover:border-black/10"
              >
                Send to agent
              </button>
              <button
                type="button"
                onClick={() => void generateVoiceBuildPhase()}
                disabled={voiceBuildBusy || (!voiceBuildReady && !voiceBuildMessages.some((message) => message.role === 'user'))}
                className="border border-black bg-black px-3 py-2 text-xs text-white transition-colors hover:bg-white hover:text-black disabled:border-black/10 disabled:bg-white disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
              >
                {voiceBuildBusy ? 'Working...' : voiceBuildReady ? 'Generate replacement phase' : 'Generate anyway'}
              </button>
            </div>
            <textarea
              value={voiceBrief}
              onChange={(e) => {
                setVoiceBrief(e.target.value);
                setVoiceBuildReady(false);
              }}
              rows={5}
              placeholder={'Message the agent. Example: Make this a 4-day hypertrophy phase. Lower A back squat, Upper A chest press and pulldown, Lower B single-leg work and hinge, Upper B shoulder press and rows. Consider her movement analysis and keep weekly set volume balanced.'}
              className="mt-3 w-full resize-y border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
            />
            {voiceBuildStatus && <p className="mt-3 text-xs text-black/50">{voiceBuildStatus}</p>}
          </div>
        )}
        {!voiceBuildOpen && voiceBuildStatus && <p className="mb-4 text-xs text-black/50">{voiceBuildStatus}</p>}

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
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dragEx) moveExerciseToSuperset(dragEx.dayIndex, dragEx.exId, di, band[0].id);
                          setDragEx(null);
                          setDragOverDay(null);
                        }}
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
                                        onKeyDown={(e) => {
                                          if (e.key === 'Escape' || e.key === 'Enter') setBoardEditExId(null);
                                        }}
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
                                        <span className={`mt-px shrink-0 rounded-full px-1.5 text-[0.48rem] font-medium uppercase tracking-wider leading-[1.8] ring-1 ring-inset ${patternChipClass(p)}`}>
                                          {p}
                                        </span>
                                      );
                                    })()}
                                    {(() => {
                                      const tag = getLoadTag(activePhaseTab, ex);
                                      if (!tag) return null;
                                      return (
                                        <span className="mt-px shrink-0 rounded-full bg-amber-50 px-1.5 text-[0.48rem] font-medium uppercase tracking-wider leading-[1.8] text-amber-700 ring-1 ring-inset ring-amber-200">
                                          {tag}
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
                      <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 focus:border-black/40 mb-1.5">Focus</label>
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
                    oneRmMap={oneRmMap}
                    onChange={(updated) => patchDay(activePhaseTab, activeDay, { exercises: updated })}
                  />
                </div>
              )}
            </div>
          )
        )}
      </div>

      <CurrentWorkoutImportModal
        open={currentWorkoutImportOpen}
        onClose={() => setCurrentWorkoutImportOpen(false)}
        onImported={handleCurrentWorkoutImported}
      />

      {/* Apply nutrition modal */}
      {nutritionApplyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">Apply nutrition targets to client</p>
              <button type="button" onClick={() => setNutritionApplyOpen(false)}
                className="text-black/30 hover:text-black text-lg leading-none">✕</button>
            </div>
            {nutritionRows.find((r) => r.phase_index === applyPhaseIdx) && (
              <p className="text-xs text-black/45">
                Phase: {nutritionRows.find((r) => r.phase_index === applyPhaseIdx)?.phase_title}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {(['protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'calories'] as const).map((key) => (
                <div key={key}>
                  <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">
                    {key === 'calories' ? 'Calories (kcal)' : key.replace('_g', ' (g)')}
                  </label>
                  <input
                    type="number"
                    value={applyTargets[key]}
                    onChange={(e) => setApplyTargets((cur) => ({ ...cur, [key]: Number(e.target.value) }))}
                    className="w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/40"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setNutritionApplyOpen(false)}
                className="flex-1 border border-black/20 px-4 py-2.5 text-sm hover:bg-black/5 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={() => void applyToClient()} disabled={applyBusy}
                className="flex-1 border border-black bg-black text-white px-4 py-2.5 text-sm hover:bg-white hover:text-black disabled:opacity-30 transition-colors">
                {applyBusy ? 'Applying…' : 'Apply targets'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
