'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronDown, FileText, Loader2, Mic, Save, Square, Upload } from 'lucide-react';
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

type IntakeFile = { name: string; document_type: 'intake' | 'movement_assessment' | 'profile' | 'other'; content_text: string };
type EquipmentModeId = 'full_gym' | 'bodyweight' | 'bands_small_dumbbells' | 'bodyweight_band';

const EQUIPMENT_MODES: Array<{
  id: EquipmentModeId;
  label: string;
  description: string;
  directive: string;
  location: 'gym' | 'home';
}> = [
  {
    id: 'full_gym',
    label: 'Gym',
    description: 'Full gym access.',
    directive: 'TRAINING ENVIRONMENT: Gym / full gym access. Use the best exercises for the client from gym equipment unless the selected evidence or coach brief says otherwise.',
    location: 'gym',
  },
  {
    id: 'bodyweight',
    label: 'Bodyweight',
    description: 'No external load.',
    directive: 'TRAINING ENVIRONMENT: Bodyweight only. Do not use barbells, dumbbells, kettlebells, cables, machines, leg press, benches, or loaded exercises. Use bodyweight patterns and create missing exercise cards when the ideal bodyweight variation is not in the library.',
    location: 'home',
  },
  {
    id: 'bands_small_dumbbells',
    label: 'Bands + small DB',
    description: 'Bands and light dumbbells only.',
    directive: 'TRAINING ENVIRONMENT: Bands plus small dumbbells only. Do not use barbells, heavy dumbbells, kettlebells, cables, machines, leg press, or gym-only exercises. Prefer resistance-band, miniband, light-dumbbell, and bodyweight options.',
    location: 'home',
  },
  {
    id: 'bodyweight_band',
    label: 'Bodyweight + band',
    description: 'Bodyweight and bands only.',
    directive: 'TRAINING ENVIRONMENT: Bodyweight plus resistance bands only. Do not use dumbbells, kettlebells, barbells, cables, machines, leg press, or gym-only exercises. Use bodyweight patterns, band-resisted patterns, and band-assisted pull/push variations.',
    location: 'home',
  },
];

type ClientEvidenceSaveMode = 'document' | 'note' | 'ingest';

interface ClientEvidenceSource {
  id: string;
  label: string;
  title: string;
  sourceId?: string;
  createdAt?: string | null;
  content: string;
  preview: string;
  saveMode: ClientEvidenceSaveMode;
  storagePath?: string | null;
}

interface ClientDocumentEvidenceRow {
  id: string;
  created_at: string;
  document_type: IntakeFile['document_type'];
  title: string;
  storage_path: string | null;
  content_text: string | null;
  parsed_summary?: Record<string, unknown> | null;
  analysis?: Record<string, unknown> | null;
  status?: string | null;
}

interface ClientNoteEvidenceRow {
  id: string;
  created_at: string;
  content: string;
  context?: Record<string, unknown> | null;
  is_active?: boolean | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasEvidenceValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function formatEvidenceValue(value: unknown): string {
  if (!hasEvidenceValue(value)) return '';
  if (typeof value === 'string') return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildEvidenceContent(fields: Array<[string, unknown]>): string {
  return fields
    .filter(([, value]) => hasEvidenceValue(value))
    .map(([label, value]) => `${label}\n${formatEvidenceValue(value)}`)
    .join('\n\n')
    .trim();
}

function previewText(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function evidenceDate(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function documentLabel(doc: ClientDocumentEvidenceRow): string {
  const parsedSource = typeof doc.parsed_summary?.source === 'string' ? doc.parsed_summary.source : '';
  const analysisSource = typeof doc.analysis?.source === 'string' ? doc.analysis.source : '';
  if (parsedSource === 'ml_client_intelligence' || analysisSource === 'ml_client_intelligence' || /m\s*&\s*l/i.test(doc.title)) return 'M&L profile';
  if (doc.document_type === 'movement_assessment') return 'Movement';
  if (doc.document_type === 'profile') return 'Profile';
  if (doc.document_type === 'intake') return 'Intake';
  return 'Document';
}

function noteLabel(note: ClientNoteEvidenceRow): string {
  const context = asRecord(note.context);
  if (context.source === 'movement_assessment_intake') return 'PAR-Q';
  if (context.source === 'ml_assessment') {
    if (context.stage === 'final') return 'M&L final';
    if (context.stage === 'part_2_lifestyle') return 'M&L part 2';
    if (context.stage === 'part_1_chat') return 'M&L part 1';
    return 'M&L';
  }
  return 'Note';
}

function noteTitle(note: ClientNoteEvidenceRow): string {
  const context = asRecord(note.context);
  if (context.source === 'movement_assessment_intake') return 'PAR-Q / movement assessment intake';
  if (context.source === 'ml_assessment') {
    if (context.stage === 'final') return 'M & L Assessment completed';
    if (context.stage === 'part_2_lifestyle') return 'M & L Assessment / Part 2';
    if (context.stage === 'part_1_chat') return 'M & L Assessment / Part 1';
    return 'M & L Assessment';
  }
  return note.content.slice(0, 80) || 'Client note';
}

function buildNoteContent(note: ClientNoteEvidenceRow): string {
  const context = asRecord(note.context);
  const contextContent = buildEvidenceContent(Object.entries(context));
  return [
    note.content ? `Note\n${note.content}` : '',
    contextContent ? `Structured context\n${contextContent}` : '',
  ].filter(Boolean).join('\n\n').trim();
}

function buildSelectedEvidenceBlock(sources: ClientEvidenceSource[], selectedIds: string[]): string {
  const selected = sources.filter((source) => selectedIds.includes(source.id) && source.content.trim());
  if (selected.length === 0) return '';
  let total = 0;
  const chunks: string[] = [];
  for (const source of selected) {
    const remaining = 30_000 - total;
    if (remaining <= 0) break;
    const body = source.content.slice(0, Math.min(3_000, remaining));
    total += body.length;
    chunks.push(`SOURCE: ${source.label} - ${source.title}${source.createdAt ? ` (${evidenceDate(source.createdAt)})` : ''}\n${body}`);
  }
  return `SELECTED CLIENT EVIDENCE FOR THIS PROGRAMME\n${chunks.join('\n\n---\n\n')}`;
}

function flattenProgrammeExercises(programme: PTProgramme) {
  return programme.phases.flatMap((phase, phaseIndex) =>
    phase.days.flatMap((day, dayIndex) =>
      day.exercises.map((exercise, exerciseIndex) => ({
        key: `${phaseIndex}:${dayIndex}:${exerciseIndex}`,
        phase: phase.title || `Phase ${phaseIndex + 1}`,
        day: day.title || `Day ${dayIndex + 1}`,
        name: exercise.name,
        sets: exercise.sets,
        reps: exercise.reps,
        rest: exercise.rest,
      })),
    ),
  );
}

function buildProgrammeEditEvents(before: PTProgramme | null, after: PTProgramme) {
  if (!before) return [];
  const oldRows = flattenProgrammeExercises(before);
  const newRows = flattenProgrammeExercises(after);
  const newByKey = new Map(newRows.map((row) => [row.key, row]));
  const removed = oldRows.filter((row) => !newByKey.has(row.key)).slice(0, 20);
  const swapped = oldRows
    .map((oldRow) => {
      const next = newByKey.get(oldRow.key);
      if (!next || oldRow.name.trim().toLowerCase() === next.name.trim().toLowerCase()) return null;
      return { from: oldRow.name, to: next.name, phase: next.phase, day: next.day };
    })
    .filter((row): row is { from: string; to: string; phase: string; day: string } => Boolean(row))
    .slice(0, 20);
  const setChanges = oldRows
    .map((oldRow) => {
      const next = newByKey.get(oldRow.key);
      if (!next || oldRow.name.trim().toLowerCase() !== next.name.trim().toLowerCase()) return null;
      if (oldRow.sets === next.sets && oldRow.reps === next.reps && oldRow.rest === next.rest) return null;
      return {
        exercise: next.name,
        phase: next.phase,
        day: next.day,
        from: { sets: oldRow.sets, reps: oldRow.reps, rest: oldRow.rest },
        to: { sets: next.sets, reps: next.reps, rest: next.rest },
      };
    })
    .filter((row): row is { exercise: string; phase: string; day: string; from: { sets: string; reps: string; rest: string }; to: { sets: string; reps: string; rest: string } } => Boolean(row))
    .slice(0, 20);

  const events: Array<{ event_type: 'programme_exercise_swapped' | 'programme_exercise_removed' | 'programme_sets_changed'; metadata: Record<string, unknown> }> = [];
  if (swapped.length > 0) events.push({ event_type: 'programme_exercise_swapped', metadata: { swaps: swapped } });
  if (removed.length > 0) events.push({ event_type: 'programme_exercise_removed', metadata: { removed } });
  if (setChanges.length > 0) events.push({ event_type: 'programme_sets_changed', metadata: { set_changes: setChanges } });
  return events;
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
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);


  const [clientId, setClientId] = useState('');
  const [brainDump, setBrainDump] = useState('');
  const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
  const [clarifyChecked, setClarifyChecked] = useState(false);
  const [clarifyBusy, setClarifyBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');

  const [programme, setProgramme] = useState<PTProgramme>({
    phases: DEFAULT_PROGRAMME_PHASES.map((ph) => ({ ...ph, id: makeId('phase') })),
  });
  const [progName, setProgName] = useState('');
  const [progGoal, setProgGoal] = useState('');
  const [reproText, setReproText] = useState('');
  const [reproBusy, setReproBusy] = useState(false);
  const [reproStatus, setReproStatus] = useState('');

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
  const [generatedProgrammeBaseline, setGeneratedProgrammeBaseline] = useState<PTProgramme | null>(null);
  const [learnWhy, setLearnWhy] = useState('');
  const [learnStatus, setLearnStatus] = useState('');

  const [intakeFiles, setIntakeFiles] = useState<IntakeFile[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [intakeStatus, setIntakeStatus] = useState('');
  const [brainSaved, setBrainSaved] = useState(false);
  const [uploadDocType, setUploadDocType] = useState<IntakeFile['document_type']>('intake');
  const [daysPerWeek, setDaysPerWeek] = useState<3 | 4 | 5>(3);
  const [equipmentMode, setEquipmentMode] = useState<EquipmentModeId>('full_gym');
  const [clientEvidence, setClientEvidence] = useState<ClientEvidenceSource[]>([]);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceStatus, setEvidenceStatus] = useState('');
  const [openEvidenceId, setOpenEvidenceId] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState('');
  const [savingEvidenceId, setSavingEvidenceId] = useState<string | null>(null);

  const srRef = useRef<SpeechRecognitionLike | null>(null);
  const srPhaseRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef('');
  const voiceBaseRef = useRef('');
  const voiceFinalRef = useRef('');

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;
  const selectedEquipment = EQUIPMENT_MODES.find((mode) => mode.id === equipmentMode) ?? EQUIPMENT_MODES[0];

  const update = (fn: (p: PTProgramme) => PTProgramme) =>
    setProgramme((cur) => fn(structuredClone(cur)));

  const loadClientEvidence = useCallback(async (targetClientId: string) => {
    const client = clients.find((c) => c.id === targetClientId);
    if (!client) {
      setClientEvidence([]);
      setSelectedEvidenceIds([]);
      return;
    }

    setEvidenceLoading(true);
    setEvidenceStatus('');
    const [documentsRes, notesRes, brainRes, exerciseRes, nutritionRes, lifestyleRes] = await Promise.all([
      supabase
        .from('pt_client_documents')
        .select('id, created_at, document_type, title, storage_path, content_text, status, parsed_summary, analysis')
        .eq('client_id', targetClientId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('pt_client_notes')
        .select('id, created_at, content, context, is_active')
        .eq('client_id', targetClientId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('pt_client_brain')
        .select('summary_current, summary_30d, summary_60d, personality_notes, key_phrases, milestones, open_loops, coaching_reasoning, important_decisions, updated_at')
        .eq('client_id', targetClientId)
        .maybeSingle(),
      supabase
        .from('pt_client_exercise_doc')
        .select('strong_movements, weak_movements, disliked_exercises, injury_history, current_limitations, current_1rm, movement_assessment_summary, progression_strategy, updated_at')
        .eq('client_id', targetClientId)
        .maybeSingle(),
      supabase
        .from('pt_client_nutrition_doc')
        .select('typical_meals, favourite_foods, foods_to_avoid, nutrition_obstacles, eating_habits, daily_targets, recent_wins, recurring_gaps, updated_at')
        .eq('client_id', targetClientId)
        .maybeSingle(),
      supabase
        .from('pt_client_lifestyle_doc')
        .select('sleep_baseline, stress_patterns, schedule_notes, social_context, recurring_challenges, wins, goals_context, updated_at')
        .eq('client_id', targetClientId)
        .maybeSingle(),
    ]);

    const nextSources: ClientEvidenceSource[] = [];
    const clientContent = buildEvidenceContent([
      ['Goals', client.goals],
      ['Notes', client.notes],
      ['Lifestyle context', client.lifestyle_context],
      ['Coaching focus', client.coaching_focus],
      ['Event goal', client.event_goal],
      ['Regular training slot', client.regular_training_slot],
      ['Height cm', client.height_cm],
      ['Current weight kg', client.current_weight_kg],
      ['Activity', client.activity_tag],
    ]);
    if (clientContent) {
      nextSources.push({
        id: `client:${client.id}`,
        label: 'Client',
        title: 'Client profile fields',
        content: clientContent,
        preview: previewText(clientContent),
        saveMode: 'ingest',
        createdAt: client.created_at ?? null,
      });
    }

    const documents = (documentsRes.data ?? []) as ClientDocumentEvidenceRow[];
    documents.forEach((doc) => {
      const content = doc.content_text?.trim() || buildEvidenceContent([
        ['Parsed summary', doc.parsed_summary],
        ['Analysis', doc.analysis],
      ]);
      if (!content) return;
      nextSources.push({
        id: `document:${doc.id}`,
        sourceId: doc.id,
        label: documentLabel(doc),
        title: doc.title,
        createdAt: doc.created_at,
        content,
        preview: previewText(content),
        saveMode: 'document',
        storagePath: doc.storage_path,
      });
    });

    const notes = ((notesRes.data ?? []) as ClientNoteEvidenceRow[])
      .filter((note) => {
        const source = asRecord(note.context).source;
        return source === 'movement_assessment_intake' || source === 'ml_assessment' || !source;
      });
    notes.forEach((note) => {
      const content = buildNoteContent(note);
      if (!content) return;
      nextSources.push({
        id: `note:${note.id}`,
        sourceId: note.id,
        label: noteLabel(note),
        title: noteTitle(note),
        createdAt: note.created_at,
        content,
        preview: previewText(content),
        saveMode: 'note',
      });
    });

    const brain = asRecord(brainRes.data);
    const brainContent = buildEvidenceContent([
      ['Current summary', brain.summary_current],
      ['30 day summary', brain.summary_30d],
      ['60 day summary', brain.summary_60d],
      ['Key phrases', brain.key_phrases],
      ['Milestones', brain.milestones],
      ['Open loops', brain.open_loops],
      ['Important decisions', brain.important_decisions],
      ['Personality notes', brain.personality_notes],
      ['Coaching reasoning', brain.coaching_reasoning],
    ]);
    if (brainContent) {
      nextSources.push({
        id: 'brain:master',
        label: 'Brain',
        title: 'Client brain summary',
        createdAt: typeof brain.updated_at === 'string' ? brain.updated_at : null,
        content: brainContent,
        preview: previewText(brainContent),
        saveMode: 'ingest',
      });
    }

    const exerciseDoc = asRecord(exerciseRes.data);
    const exerciseContent = buildEvidenceContent([
      ['Strong movements', exerciseDoc.strong_movements],
      ['Weak movements', exerciseDoc.weak_movements],
      ['Disliked exercises', exerciseDoc.disliked_exercises],
      ['Injury history', exerciseDoc.injury_history],
      ['Current limitations', exerciseDoc.current_limitations],
      ['Current 1RM', exerciseDoc.current_1rm],
      ['Movement assessment summary', exerciseDoc.movement_assessment_summary],
      ['Progression strategy', exerciseDoc.progression_strategy],
    ]);
    if (exerciseContent) {
      nextSources.push({
        id: 'brain:exercise',
        label: 'Exercise',
        title: 'Training and movement intelligence',
        createdAt: typeof exerciseDoc.updated_at === 'string' ? exerciseDoc.updated_at : null,
        content: exerciseContent,
        preview: previewText(exerciseContent),
        saveMode: 'ingest',
      });
    }

    const nutritionDoc = asRecord(nutritionRes.data);
    const nutritionContent = buildEvidenceContent([
      ['Typical meals', nutritionDoc.typical_meals],
      ['Favourite foods', nutritionDoc.favourite_foods],
      ['Foods to avoid', nutritionDoc.foods_to_avoid],
      ['Nutrition obstacles', nutritionDoc.nutrition_obstacles],
      ['Eating habits', nutritionDoc.eating_habits],
      ['Daily targets', nutritionDoc.daily_targets],
      ['Recent wins', nutritionDoc.recent_wins],
      ['Recurring gaps', nutritionDoc.recurring_gaps],
    ]);
    if (nutritionContent) {
      nextSources.push({
        id: 'brain:nutrition',
        label: 'Nutrition',
        title: 'Nutrition context',
        createdAt: typeof nutritionDoc.updated_at === 'string' ? nutritionDoc.updated_at : null,
        content: nutritionContent,
        preview: previewText(nutritionContent),
        saveMode: 'ingest',
      });
    }

    const lifestyleDoc = asRecord(lifestyleRes.data);
    const lifestyleContent = buildEvidenceContent([
      ['Sleep baseline', lifestyleDoc.sleep_baseline],
      ['Stress patterns', lifestyleDoc.stress_patterns],
      ['Schedule notes', lifestyleDoc.schedule_notes],
      ['Social context', lifestyleDoc.social_context],
      ['Recurring challenges', lifestyleDoc.recurring_challenges],
      ['Wins', lifestyleDoc.wins],
      ['Goals context', lifestyleDoc.goals_context],
    ]);
    if (lifestyleContent) {
      nextSources.push({
        id: 'brain:lifestyle',
        label: 'Lifestyle',
        title: 'Lifestyle and schedule context',
        createdAt: typeof lifestyleDoc.updated_at === 'string' ? lifestyleDoc.updated_at : null,
        content: lifestyleContent,
        preview: previewText(lifestyleContent),
        saveMode: 'ingest',
      });
    }

    setClientEvidence(nextSources);
    setSelectedEvidenceIds((current) => {
      const ids = nextSources.map((source) => source.id);
      if (current.length === 0) return ids;
      const currentSet = new Set(current);
      const retained = ids.filter((id) => currentSet.has(id));
      return retained.length > 0 ? retained : ids;
    });
    setOpenEvidenceId((current) => current && nextSources.some((source) => source.id === current) ? current : null);
    if (documentsRes.error || notesRes.error || brainRes.error || exerciseRes.error || nutritionRes.error || lifestyleRes.error) {
      setEvidenceStatus('Some client evidence could not be loaded.');
    } else if (nextSources.length === 0) {
      setEvidenceStatus('No client evidence found yet.');
    }
    setEvidenceLoading(false);
  }, [clients, supabase]);

  useEffect(() => {
    if (!clientId) {
      setClientEvidence([]);
      setSelectedEvidenceIds([]);
      setOpenEvidenceId(null);
      setEvidenceDraft('');
      setEvidenceStatus('');
      return;
    }
    void loadClientEvidence(clientId);
  }, [clientId, loadClientEvidence]);

  const selectedEvidenceBlock = useMemo(
    () => buildSelectedEvidenceBlock(clientEvidence, selectedEvidenceIds),
    [clientEvidence, selectedEvidenceIds],
  );

  const toggleEvidence = (sourceId: string) => {
    setSelectedEvidenceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  };

  const openEvidence = (source: ClientEvidenceSource) => {
    setOpenEvidenceId((current) => current === source.id ? null : source.id);
    setEvidenceDraft(source.content);
    setEvidenceStatus('');
  };

  const saveEvidence = async (source: ClientEvidenceSource) => {
    if (!clientId) return;
    const draft = evidenceDraft.trim();
    if (!draft) {
      setEvidenceStatus('Evidence text cannot be empty.');
      return;
    }
    setSavingEvidenceId(source.id);
    setEvidenceStatus('Saving source…');
    if (source.saveMode === 'document' && source.sourceId) {
      const { error } = await supabase
        .from('pt_client_documents')
        .update({ content_text: draft, status: 'analysed', updated_at: new Date().toISOString() })
        .eq('id', source.sourceId);
      if (error) {
        setEvidenceStatus(error.message);
        setSavingEvidenceId(null);
        return;
      }
    } else if (source.saveMode === 'note' && source.sourceId) {
      const { error } = await supabase
        .from('pt_client_notes')
        .update({ content: draft })
        .eq('id', source.sourceId);
      if (error) {
        setEvidenceStatus(error.message);
        setSavingEvidenceId(null);
        return;
      }
    } else {
      const { data, error } = await supabase.functions.invoke('ingest-client-intake', {
        body: {
          client_id: clientId,
          notes_text: `Coach updated ${source.label} source "${source.title}" inside the programme builder:\n\n${draft}`,
        },
      });
      if (error || (data as { error?: string })?.error) {
        setEvidenceStatus((data as { error?: string })?.error ?? await functionErrorMessage(error, 'Could not save source.'));
        setSavingEvidenceId(null);
        return;
      }
    }
    setClientEvidence((current) =>
      current.map((item) => item.id === source.id ? { ...item, content: draft, preview: previewText(draft) } : item),
    );
    setEvidenceStatus('Source saved. Client intelligence refreshed.');
    setSavingEvidenceId(null);
    await loadClientEvidence(clientId);
  };

  const openEvidenceStorage = async (path: string) => {
    const { data } = await supabase.storage.from('pt-client-docs').createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

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
      const loadedProgramme = safeProgramme(draft.programme);
      setProgramme(loadedProgramme);
      setGeneratedProgrammeBaseline(loadedProgramme);
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

  // ONE smart upload. Read the document, classify it (classify-document), and route it:
  // a workout is reproduced exactly into the editor (build-workout-from-text); client knowledge
  // (intake / movement / M&L assessment / profile) is ingested into the client brain
  // (ingest-client-intake) so it informs generation. Reuses the repro* state.
  const handleSmartDocument = async (fromFile?: File) => {
    if (!clientId) { setReproStatus('Select a client first.'); return; }
    setReproBusy(true);
    setReproStatus('Reading document…');
    try {
      let text = reproText.trim();
      let fname = '';
      if (fromFile) {
        fname = fromFile.name;
        if (fromFile.type === 'application/pdf' || fromFile.name.toLowerCase().endsWith('.pdf')) {
          const form = new FormData();
          form.append('file', fromFile);
          const res = await fetch('/api/pt/parse-pdf', { method: 'POST', body: form });
          const parsed = await readJsonResponse<{ text?: string; error?: string }>(res, 'PDF parse failed');
          if (!res.ok || parsed.error) { setReproStatus(parsed.error ?? 'PDF parse failed.'); setReproBusy(false); return; }
          text = (parsed.text ?? '').trim();
        } else {
          text = (await fromFile.text()).trim();
        }
      }
      if (text.length < 10) { setReproStatus('Upload a document or paste at least a sentence.'); setReproBusy(false); return; }

      setReproStatus('Sorting the document…');
      const { data: clsData, error: clsErr } = await supabase.functions.invoke('classify-document', { body: { text: text.slice(0, 12000) } });
      if (clsErr || (clsData as { error?: string })?.error) {
        setReproStatus((clsData as { error?: string })?.error ?? await functionErrorMessage(clsErr, 'Could not read the document.'));
        setReproBusy(false);
        return;
      }
      const cls = clsData as { kind: 'workout' | 'knowledge'; document_type: string; title: string };

      if (cls.kind === 'workout') {
        setReproStatus('Workout detected - reproducing it exactly…');
        const { data, error } = await supabase.functions.invoke('build-workout-from-text', { body: { text: text.slice(0, 20000) } });
        if (error || (data as { error?: string })?.error) {
          setReproStatus((data as { error?: string })?.error ?? await functionErrorMessage(error, 'Could not reproduce the workout.'));
          setReproBusy(false);
          return;
        }
        const result = data as { phase?: PTProgrammePhase };
        if (!result.phase) { setReproStatus('No workout could be parsed from that document.'); setReproBusy(false); return; }
        void supabase.functions.invoke('ingest-client-intake', {
          body: {
            client_id: clientId,
            files: [{
              name: `Reference workout - ${fname || cls.title || result.phase.title || 'uploaded workout'}`,
              document_type: 'other',
              content_text: [
                'REFERENCE WORKOUT FOR PROGRAMME GENERATION',
                'Pedro uploaded this workout as an example of programming style, exercise selection, structure, progression, and constraints to consider in future programmes.',
                `Selected equipment mode at upload: ${selectedEquipment.label}`,
                '',
                text.slice(0, 100000),
              ].join('\n'),
            }],
          },
        });
        const importedProgramme = safeProgramme({ phases: [result.phase] });
        setProgramme(importedProgramme);
        setGeneratedProgrammeBaseline(importedProgramme);
        setProgName(result.phase.title || cls.title || 'Imported workout');
        setProgGoal(result.phase.focus || '');
        setActivePhaseTab(0);
        setActiveDay(null);
        setReproText('');
        setReproBusy(false);
        setReproStatus('');
        setStep(3);
        return;
      }

      // knowledge -> ingest into the client brain
      setReproStatus('Client info detected - adding to the brain…');
      const { data, error } = await supabase.functions.invoke('ingest-client-intake', {
        body: { client_id: clientId, files: [{ name: fname || cls.title || 'Client document', document_type: cls.document_type, content_text: text.slice(0, 100000) }] },
      });
      if (error || (data as { error?: string })?.error) {
        setReproStatus((data as { error?: string })?.error ?? await functionErrorMessage(error, 'Could not add the document.'));
        setReproBusy(false);
        return;
      }
      setReproText('');
      setBrainSaved(true);
      setReproBusy(false);
      setReproStatus(`Added to the client brain as ${cls.document_type.replace(/_/g, ' ')}.`);
      await loadClientEvidence(clientId);
    } catch (err) {
      setReproStatus(err instanceof Error ? err.message : 'Could not process the document.');
      setReproBusy(false);
    }
  };

  const handleGenerate = async (opts?: { skipClarify?: boolean }) => {
    if (!clientId) {
      setGenStatus('Select a client first — the 3-AI pipeline needs the client brain to generate.');
      return;
    }

    // Pillar B pre-flight: on the first Generate, ask the AI whether it needs anything clarified.
    // If it returns questions, pause here and render them; the coach answers and hits Continue.
    // opts.skipClarify is passed by the Continue/Skip buttons to bypass the check (state set is async).
    if (!clarifyChecked && !opts?.skipClarify) {
      setClarifyBusy(true);
      setGenStatus('Checking I have what I need…');
      try {
        const clarifyRequest = [selectedEquipment.directive, brainDump.trim(), selectedEvidenceBlock].filter(Boolean).join('\n\n');
        const { data: clarifyData } = await supabase.functions.invoke('suggest-clarifying-questions', {
          body: { client_id: clientId, request_text: clarifyRequest },
        });
        const qs = ((clarifyData as { questions?: string[] })?.questions ?? []).filter((q) => typeof q === 'string' && q.trim());
        setClarifyBusy(false);
        setGenStatus('');
        if (qs.length > 0) {
          setClarifyQuestions(qs);
          setClarifyAnswers(qs.map(() => ''));
          return; // pause; the clarify panel renders below on step 1
        }
      } catch {
        setClarifyBusy(false);
        setGenStatus('');
      }
      setClarifyChecked(true);
    }

    // Fold any ANSWERED clarifying questions into the request so the whole pipeline sees them.
    const answered = clarifyQuestions
      .map((q, i) => ({ q, a: (clarifyAnswers[i] ?? '').trim() }))
      .filter((x) => x.a);
    const clarifications = answered.length > 0
      ? `\n\nCoach clarifications:\n${answered.map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n')}`
      : '';
    const coachBrief = `${brainDump}${clarifications}`.trim();
    const equipmentDirective = selectedEquipment.directive;
    const brainNote = [
      equipmentMode !== 'full_gym' ? equipmentDirective : '',
      coachBrief,
    ].filter(Boolean).join('\n\n').trim();
    const effectiveIntake = [
      equipmentDirective,
      coachBrief ? `COACH PROGRAMME BRIEF:\n${coachBrief}` : '',
      selectedEvidenceBlock,
    ].filter(Boolean).join('\n\n---\n\n').trim();

    setGenerating(true);
    setStep(2);

    if (intakeFiles.length > 0 || brainNote) {
      setGenStatus('Saving intake to client brain…');
      const { data: ingestData, error: ingestError } = await supabase.functions.invoke('ingest-client-intake', {
        body: { client_id: clientId, files: intakeFiles, notes_text: brainNote },
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
    const selectedDocumentIds = selectedEvidenceIds
      .filter((id) => id.startsWith('document:'))
      .map((id) => id.replace('document:', ''));
    const hasDocumentEvidence = clientEvidence.some((source) => source.id.startsWith('document:'));
    const { data, error } = await supabase.functions.invoke('pt-programme-orchestrator', {
      body: {
        client_id: clientId,
        phase_weeks: phaseWeeks,
        days_per_week: daysPerWeek,
        intake_text: effectiveIntake,
        selected_document_ids: selectedDocumentIds,
        selected_documents_only: hasDocumentEvidence,
        constraints: {
          equipment: equipmentMode,
          location: selectedEquipment.location,
        },
      },
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
        const generatedProgramme = safeProgramme(draft);
        setProgramme(generatedProgramme);
        setGeneratedProgrammeBaseline(generatedProgramme);
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
    voiceBaseRef.current = brainDump.trim();
    voiceFinalRef.current = '';
    r.continuous = true; r.interimResults = true; r.lang = 'en-AU';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) {
          if (transcript) voiceFinalRef.current = `${voiceFinalRef.current} ${transcript}`.trim();
        } else if (transcript) {
          interim = `${interim} ${transcript}`.trim();
        }
      }
      const next = [voiceBaseRef.current, voiceFinalRef.current, interim]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      setBrainDump(next);
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
    name.length >= 2 ? searchExerciseLibrary(exercises, name, 24) : [];

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
    setLearnStatus('');

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
        const editEvents = buildProgrammeEditEvents(generatedProgrammeBaseline, programme);
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
          metadata: {
            template_name: progName,
            assignment_id: assignment.id,
            generation_run_id: generationRunId,
            equipment_mode: equipmentMode,
            equipment_label: selectedEquipment.label,
          },
        });
        if (editEvents.length > 0) {
          await supabase.from('pt_events').insert(
            editEvents.map((event) => ({
              client_id: clientId,
              event_type: event.event_type,
              metadata: {
                ...event.metadata,
                assignment_id: assignment.id,
                template_id: template.id,
                generation_run_id: generationRunId,
                source: 'programme_wizard_finalise',
                equipment_mode: equipmentMode,
                equipment_label: selectedEquipment.label,
              },
            })),
          );
        }
        if (editEvents.length > 0 || learnWhy.trim()) {
          setLearnStatus('Teaching the generator from your edits…');
          const { data: learnData, error: learnError } = await supabase.functions.invoke('distill-coaching-learnings', {
            body: {
              client_id: clientId,
              why: learnWhy,
              generation_context: {
                equipment_mode: equipmentMode,
                equipment_label: selectedEquipment.label,
                coach_brief: brainDump.trim(),
              },
            },
          });
          if (learnError || (learnData as { error?: string })?.error) {
            setLearnStatus((learnData as { error?: string })?.error ?? 'Programme saved, but the learning step did not finish.');
          } else {
            const result = learnData as { summary?: string; learnings?: string[] };
            setLearnStatus(result.summary ?? 'Programme saved and client learning updated.');
          }
        }
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
  const openEvidenceSource = openEvidenceId ? clientEvidence.find((source) => source.id === openEvidenceId) ?? null : null;
  const finalEditEvents = buildProgrammeEditEvents(generatedProgrammeBaseline, programme);

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
            <section className="max-w-3xl border border-black/10 bg-white/70">
              <div className="flex flex-col gap-3 border-b border-black/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Client intelligence</p>
                  <p className="mt-1 text-sm text-black/60">
                    {evidenceLoading ? 'Loading sources…' : `${clientEvidence.length} source${clientEvidence.length === 1 ? '' : 's'} found · ${selectedEvidenceIds.length} selected`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedEvidenceIds(clientEvidence.map((source) => source.id))}
                    className="border border-black/15 px-3 py-1.5 text-xs text-black/50 transition-colors hover:border-black/30 hover:text-black"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEvidenceIds([])}
                    className="border border-black/15 px-3 py-1.5 text-xs text-black/50 transition-colors hover:border-black/30 hover:text-black"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="px-5 py-4">
                {evidenceLoading ? (
                  <div className="flex items-center gap-2 text-sm text-black/45">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading client evidence
                  </div>
                ) : clientEvidence.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {clientEvidence.map((source) => {
                      const selected = selectedEvidenceIds.includes(source.id);
                      const open = openEvidenceId === source.id;
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => openEvidence(source)}
                          className={`group flex max-w-full items-center gap-2 border px-3 py-2 text-left text-xs transition-colors ${
                            open ? 'border-black bg-black text-white' : selected ? 'border-black/25 bg-white text-black' : 'border-black/10 bg-white text-black/35 hover:border-black/25 hover:text-black'
                          }`}
                        >
                          <span
                            role="checkbox"
                            aria-checked={selected}
                            tabIndex={-1}
                            onClick={(e) => { e.stopPropagation(); toggleEvidence(source.id); }}
                            className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                              selected ? open ? 'border-white bg-white text-black' : 'border-black bg-black text-white' : open ? 'border-white/50' : 'border-black/20'
                            }`}
                          >
                            {selected && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{source.label}</span>
                            <span className={`block max-w-[12rem] truncate ${open ? 'text-white/60' : 'text-black/35'}`}>{source.title}</span>
                          </span>
                          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-black/40">{evidenceStatus || 'No client evidence found yet.'}</p>
                )}

                {openEvidenceSource && (
                  <div className="mt-4 border border-black/10 bg-[#fbfbf8]">
                    <div className="flex flex-col gap-3 border-b border-black/8 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">{openEvidenceSource.label}</p>
                        <p className="mt-1 truncate text-sm font-medium text-black">{openEvidenceSource.title}</p>
                        {openEvidenceSource.createdAt && (
                          <p className="mt-0.5 text-xs text-black/35">{evidenceDate(openEvidenceSource.createdAt)}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {openEvidenceSource.storagePath && (
                          <button
                            type="button"
                            onClick={() => void openEvidenceStorage(openEvidenceSource.storagePath as string)}
                            className="inline-flex items-center gap-1.5 border border-black/15 bg-white px-3 py-1.5 text-xs text-black/50 transition-colors hover:border-black/30 hover:text-black"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            PDF
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void saveEvidence(openEvidenceSource)}
                          disabled={savingEvidenceId === openEvidenceSource.id}
                          className="inline-flex items-center gap-1.5 border border-black bg-black px-3 py-1.5 text-xs text-white transition-colors hover:bg-white hover:text-black disabled:opacity-40"
                        >
                          {savingEvidenceId === openEvidenceSource.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={evidenceDraft}
                      onChange={(e) => setEvidenceDraft(e.target.value)}
                      rows={10}
                      className="block w-full resize-y border-0 bg-transparent px-4 py-4 font-mono text-xs leading-6 text-black/70 outline-none"
                    />
                  </div>
                )}

                {evidenceStatus && clientEvidence.length > 0 && (
                  <p className={`mt-3 text-xs ${/could|fail|error|empty/i.test(evidenceStatus) ? 'text-red-600' : 'text-emerald-700'}`}>{evidenceStatus}</p>
                )}
              </div>
            </section>
          )}

          {selectedClient && (
            <section className="max-w-3xl border border-black/10 bg-white/70 px-5 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Training environment</p>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-black/40">
                This is a hard filter for exercise selection before the AI builds the programme.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EQUIPMENT_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setEquipmentMode(mode.id)}
                    className={`rounded-full border px-4 py-2 text-left text-xs transition-colors sm:text-sm ${
                      equipmentMode === mode.id ? 'border-black bg-black text-white' : 'border-black/15 bg-white text-black/65 hover:border-black/30 hover:text-black'
                    }`}
                  >
                    <span className="block font-medium">{mode.label}</span>
                    <span className={`block text-[0.65rem] sm:text-xs ${equipmentMode === mode.id ? 'text-white/55' : 'text-black/35'}`}>{mode.description}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {selectedClient && (
            <section className="max-w-3xl border border-black/10 bg-white/70 px-5 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Upload document</p>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-black/45">
                PDF or text files are sorted automatically: client evidence is added to the dossier; workout documents are reproduced as editable drafts.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className={`inline-flex items-center gap-2 border border-dashed px-4 py-2 text-sm transition-colors ${reproBusy ? 'cursor-default opacity-40' : 'cursor-pointer border-black/15 text-black/55 hover:border-black/30 hover:text-black'}`}>
                  <Upload className="h-4 w-4" />
                  PDF / text file
                  <input
                    type="file"
                    accept=".pdf,.txt,.md,.text,application/pdf,text/plain,text/markdown"
                    className="hidden"
                    disabled={reproBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleSmartDocument(f); e.target.value = ''; }}
                  />
                </label>
                {reproBusy && <span className="inline-flex items-center gap-2 text-xs text-black/45"><Loader2 className="h-3.5 w-3.5 animate-spin" />Working</span>}
              </div>
              {reproStatus && (
                <p className={`mt-3 text-xs ${/could|fail|no workout|select a client|upload a document|at least a sentence/i.test(reproStatus) ? 'text-red-600' : 'text-black/45'}`}>{reproStatus}</p>
              )}
            </section>
          )}

          {selectedClient && (
            <section className="max-w-3xl border border-black/10 bg-white/70 px-5 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Training days per week</p>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-black/40">
                Foundation stays 3 full-body days. Hypertrophy and Strength use the split below.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {([3, 4, 5] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDaysPerWeek(d)}
                    className={`border px-4 py-2 text-sm transition-colors ${
                      daysPerWeek === d ? 'border-black bg-black text-white' : 'border-black/15 bg-white hover:border-black/30'
                    }`}
                  >
                    {d} days/week
                  </button>
                ))}
              </div>
            </section>
          )}

          {selectedClient && (
            <section className="max-w-3xl border border-black/10 bg-white/70 px-5 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Brain dump</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <textarea
                  value={brainDump}
                  onChange={(e) => setBrainDump(e.target.value)}
                  placeholder="Goals, constraints, schedule, equipment, exercises to include or avoid, anything else..."
                  rows={6}
                  className="min-h-36 flex-1 resize-y border border-black/15 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-black/40"
                />
                <div className="flex flex-col gap-2 sm:w-32">
                  {listening ? (
                    <>
                      <span className="inline-flex items-center justify-center gap-2 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">
                        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        Recording
                      </span>
                      <button type="button" onClick={stopDictation} className="inline-flex items-center justify-center gap-2 border border-black bg-black px-3 py-2 text-xs text-white transition-colors hover:bg-white hover:text-black">
                        <Square className="h-3.5 w-3.5" />
                        Done
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={startDictation}
                      className="inline-flex items-center justify-center gap-2 border border-black/15 bg-white px-4 py-3 text-sm transition-colors hover:border-black/30"
                    >
                      <Mic className="h-4 w-4" />
                      Voice
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Single Generate button */}
          <div className="border-t border-black/10 pt-5">
            {!clientId ? (
              <p className="text-sm text-black/40">Select a client above to generate a programme.</p>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => void handleGenerate()}
                  disabled={generating || clarifyBusy}
                  className="border border-black bg-black text-white px-8 py-3 text-sm hover:bg-white hover:text-black transition-colors disabled:opacity-40"
                >
                  {generating ? genStatus || 'Generating…' : clarifyBusy ? 'Checking…' : 'Generate'}
                </button>
                {brainSaved && <p className="text-xs text-emerald-700">✓ Client brain updated</p>}
                {genStatus && !generating && (
                  <p className={`text-xs ${genStatus.toLowerCase().includes('fail') || genStatus.toLowerCase().includes('timed out') || genStatus.toLowerCase().includes('error') ? 'text-red-600' : 'text-black/40'}`}>{genStatus}</p>
                )}

                {clarifyQuestions.length > 0 && !clarifyChecked && (
                  <div className="mt-2 max-w-2xl border border-black/15 bg-black/[0.02] p-4">
                    <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-2">A few questions first</p>
                    <p className="text-xs text-black/45 mb-3">Answer what you can — it makes the programme far more specific. Leave any blank and I&apos;ll use my best judgement.</p>
                    <div className="space-y-3">
                      {clarifyQuestions.map((q, i) => (
                        <div key={i}>
                          <label className="mb-1 block text-sm text-black/70">{q}</label>
                          <input
                            type="text"
                            value={clarifyAnswers[i] ?? ''}
                            onChange={(e) => setClarifyAnswers((cur) => { const next = [...cur]; next[i] = e.target.value; return next; })}
                            className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { setClarifyChecked(true); void handleGenerate({ skipClarify: true }); }}
                        className="border border-black bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-white hover:text-black"
                      >
                        Continue with these answers
                      </button>
                      <button
                        type="button"
                        onClick={() => { setClarifyChecked(true); setClarifyQuestions([]); void handleGenerate({ skipClarify: true }); }}
                        className="border border-black/15 px-4 py-2 text-xs text-black/50 transition-colors hover:border-black/30 hover:text-black"
                      >
                        Skip and generate anyway
                      </button>
                    </div>
                  </div>
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
                    return (
                  <div className="max-w-full overflow-x-auto pb-3">
                  <div
                    className="grid min-w-full items-start gap-x-3"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(phase.days.length, 1)}, minmax(17rem, 1fr))`,
                    }}
                  >
                    {phase.days.map((day, di) => (
                      <div
                        key={day.id}
                        onDragOver={(e) => { e.preventDefault(); if (dragOverDay !== di) setDragOverDay(di); }}
                        onDragLeave={() => setDragOverDay((current) => (current === di ? null : current))}
                        onDrop={(e) => { e.preventDefault(); if (dragEx) moveExerciseToDay(dragEx.dayIndex, dragEx.exId, di); setDragEx(null); setDragOverDay(null); }}
                        className={`flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-lg border p-2 transition-colors ${dragOverDay === di ? 'border-emerald-400 bg-emerald-50/40' : 'border-black/10 bg-black/[0.01]'}`}
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

          {selectedClient && (
            <div className="border border-black/10 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Teach the next programme</p>
                  <p className="mt-1 text-xs leading-5 text-black/45">
                    {finalEditEvents.length > 0
                      ? `${finalEditEvents.length} edit signal${finalEditEvents.length === 1 ? '' : 's'} detected from the generated draft.`
                      : 'No structural edit signal detected yet.'}
                  </p>
                </div>
                {finalEditEvents.length > 0 && (
                  <span className="shrink-0 border border-emerald-200 bg-emerald-50 px-2 py-1 text-[0.58rem] uppercase tracking-[0.12em] text-emerald-700">
                    Learning ready
                  </span>
                )}
              </div>
              <textarea
                value={learnWhy}
                onChange={(e) => setLearnWhy(e.target.value)}
                placeholder="Why did you change it? e.g. removed deep squats because her knee felt sensitive, kept hip hinges because glutes need more exposure..."
                rows={3}
                className="mt-3 w-full resize-y border border-black/15 px-3 py-2 text-sm leading-6 outline-none focus:border-black/40"
              />
              {learnStatus && <p className="mt-2 text-xs text-black/45">{learnStatus}</p>}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(3)} className="border border-black/15 px-5 py-2.5 text-sm hover:bg-black/5 transition-colors">
              ← Back
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || !progName.trim()}
              className="flex-1 border border-black bg-black text-white py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
            >
              {saving ? (learnStatus ? 'Teaching…' : 'Creating…') : `Create draft${selectedClient ? ` for ${selectedClient.name}` : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
