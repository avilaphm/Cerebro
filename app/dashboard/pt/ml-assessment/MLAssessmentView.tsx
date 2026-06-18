'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Calendar, Camera, Check, ChevronLeft, ChevronRight, Loader2, Mic, Play, Square, Trash2, UserRound } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import type { PTClient } from '@/utils/pt/types';

export interface MLAssessmentIntakeNote {
  id: string;
  client_id: string;
  content: string;
  created_at: string;
  context?: Record<string, unknown>;
}

export interface MLAssessmentAppointment {
  id: string;
  client_id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  notes: string | null;
  pt_clients?: { id: string; name: string; email: string } | null;
}

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
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type Step = 1 | 2 | 3;

interface VoiceDraft {
  answer: string;
  notes: string;
}

interface MovementDraft {
  notes: string;
  video_path: string | null;
  video_url: string | null;
  video_mime_type: string | null;
  recorded_at: string | null;
}

type ObservationValue = 'yes' | 'no' | '';

interface ObservationDraft {
  value: ObservationValue;
  notes: string;
}

interface VideoState {
  path: string;
  signedUrl: string | null;
  mimeType: string;
  recordedAt: string;
}

const CHAT_QUESTIONS = [
  {
    id: 'injuries_surgeries_pain',
    prompt: 'Any injuries, surgeries, or pain I should know about? Current or old, even minor stuff.',
  },
  {
    id: 'current_activity',
    prompt: 'How active are you both right now? Gym, sport, classes, walking, anything.',
  },
  {
    id: 'gym_outcome',
    prompt: 'Anything specific you’re hoping to get out of your time at the gym?',
  },
  {
    id: 'pt_history',
    prompt: 'Have you trained with a PT before? If yes, what worked, what didn’t?',
  },
] as const;

const LIFESTYLE_QUESTIONS = [
  {
    id: 'typical_day',
    prompt: 'What does a typical day look like for you? Work schedule, energy levels, stress.',
  },
  {
    id: 'sleep',
    prompt: 'How’s your sleep? Roughly how many hours, and do you wake up feeling rested?',
  },
  {
    id: 'nutrition',
    prompt: 'How would you describe your nutrition right now? Not looking for perfection, just a general picture.',
  },
  {
    id: 'medications_professionals',
    prompt: 'Are you on any medications or seeing any health professionals I should know about?',
  },
  {
    id: 'daily_activity',
    prompt: 'Outside of training, how active are you day-to-day? Walking, sport, physical job, desk job.',
  },
  {
    id: 'avoided_movements',
    prompt: 'Are there specific movements that feel uncomfortable or that you’ve been avoiding?',
  },
  {
    id: 'clearance',
    prompt: 'Have you been cleared by a physio or doctor to train? Are you currently seeing anyone?',
  },
  {
    id: 'training_likes_dislikes',
    prompt: 'When you think about training, is there anything you really enjoy or really hate? Example, love lifting, hate cardio.',
  },
  {
    id: 'sessions_per_week',
    prompt: 'How many sessions per week are you thinking?',
  },
  {
    id: 'outside_session_guidance',
    prompt: 'Are you looking for someone to also guide you on what to do outside of our sessions, or just the PT hours?',
  },
] as const;

const OBSERVATION_FIELDS = [
  { id: 'head_position', label: 'Head position', placeholder: 'Forward head?' },
  { id: 'shoulder_height', label: 'Shoulder height', placeholder: 'Level / elevated L or R' },
  { id: 'spinal_curves', label: 'Spinal curves', placeholder: 'Excessive kyphosis / lordosis?' },
  { id: 'hip_level', label: 'Hip level', placeholder: 'Level / shift / rotation' },
  { id: 'knee_alignment', label: 'Knee alignment', placeholder: 'Valgus / varus?' },
  { id: 'foot_position', label: 'Foot position', placeholder: 'Pronation / supination / neutral' },
] as const;

const MOVEMENTS = [
  {
    id: 'overhead_squat',
    title: 'Movement 1: Overhead Squat',
    instructions: 'Feet shoulder-width, arms overhead, squat as deep as comfortable.',
  },
  {
    id: 'single_leg_balance',
    title: 'Movement 2: Single Leg Balance',
    instructions: 'Stand on one leg, arms relaxed, hold 10 seconds each side.',
  },
  {
    id: 'hip_hinge',
    title: 'Movement 3: Hip Hinge',
    instructions: 'Bodyweight RDL pattern. Hands on hips or by sides, push hips back, slight knee bend.',
  },
  {
    id: 'push_up',
    title: 'Movement 4: Push-Up',
    instructions: 'Standard or modified. Choose based on client.',
  },
  {
    id: 'active_straight_leg_raise',
    title: 'Movement 5: Active Straight Leg Raise',
    instructions: 'Lying on back, raise one leg keeping the other flat.',
  },
  {
    id: 'shoulder_mobility',
    title: 'Movement 6: Shoulder Mobility',
    instructions: 'One arm overhead reaching down back, other arm behind reaching up. Can hands touch?',
  },
  {
    id: 'thoracic_rotation',
    title: 'Movement 7: Thoracic Rotation',
    instructions: 'Seated or quadruped, rotate through the upper back.',
  },
  {
    id: 'lunge',
    title: 'Movement 8: Lunge',
    instructions: 'Forward or reverse bodyweight lunge. Watch for control and alignment.',
  },
  {
    id: 'hip_flexor_couch_stretch',
    title: 'Movement 9: Hips - Hip Flexor / Couch Stretch',
    instructions: 'Rate restriction or discomfort left and right. Example: L 7-8/10, R 7/10.',
  },
  {
    id: 'core_strength_leg_lower',
    title: 'Movement 9: Hips - Core Strength',
    instructions: 'Band under the lower back, lower the legs to the ground.',
  },
  {
    id: 'butterfly',
    title: 'Movement 9: Hips - Butterfly',
    instructions: 'Assess adductor position, comfort, and symmetry.',
  },
  {
    id: 'internal_rotation',
    title: 'Movement 9: Hips - Internal Rotation',
    instructions: 'Assess left and right internal rotation.',
  },
  {
    id: 'faber_test',
    title: 'Movement 9: Hips - FABER Test',
    instructions: 'Observe range, pain, and side-to-side difference.',
  },
  {
    id: 'single_leg_glute_bridge',
    title: 'Movement 9: Hips - Single Leg Glute Bridge',
    instructions: 'Watch pelvis control, hamstring cramping, and side difference.',
  },
  {
    id: 'glute_max_push_down',
    title: 'Movement 9: Hips - Glute Max Strength Push Down',
    instructions: 'Assess force, control, and side-to-side difference.',
  },
] as const;

const CONSULT_CLOSE =
  'Awesome, thanks for sharing all of that. What I’d love to do now is take you through a quick movement assessment, about 20 minutes. Nothing crazy, no weights. I just want to see how your body moves so I can build something that’s actually right for you. Sound good?';

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function emptyVoiceDrafts<T extends readonly { id: string }[]>(items: T): Record<T[number]['id'], VoiceDraft> {
  return Object.fromEntries(items.map((item) => [item.id, { answer: '', notes: '' }])) as Record<T[number]['id'], VoiceDraft>;
}

function emptyMovements(): Record<string, MovementDraft> {
  return Object.fromEntries(MOVEMENTS.map((movement) => [
    movement.id,
    {
      notes: '',
      video_path: null,
      video_url: null,
      video_mime_type: null,
      recorded_at: null,
    },
  ])) as Record<string, MovementDraft>;
}

function ageFromDob(dob: string | null | undefined) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function formatDob(dob: string | null | undefined) {
  if (!dob) return 'Not recorded';
  const age = ageFromDob(dob);
  const date = new Date(`${dob}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return age === null ? date : `${date} · ${age}`;
}

function mimeForRecorder() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('quicktime')) return 'mov';
  return 'webm';
}

function cleanFileId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

function extractParqDob(note: MLAssessmentIntakeNote | null) {
  const value = note?.context?.date_of_birth;
  return typeof value === 'string' ? value : null;
}

function extractParqCoachNote(note: MLAssessmentIntakeNote | null) {
  const value = note?.context?.coach_notes;
  return typeof value === 'string' ? value : null;
}

function extractParqFlag(note: MLAssessmentIntakeNote | null) {
  const value = note?.context?.medical_flag;
  return typeof value === 'boolean' ? value : null;
}

function compactAnswers(answers: Record<string, VoiceDraft>, labels: readonly { id: string; prompt: string }[]) {
  return labels.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    answer: answers[question.id]?.answer.trim() ?? '',
    notes: answers[question.id]?.notes.trim() ?? '',
  }));
}

function buildMovementSummary(movements: Record<string, MovementDraft>, observations: Record<string, ObservationDraft>) {
  const movementRows = MOVEMENTS.map((movement) => ({
    id: movement.id,
    title: movement.title,
    instructions: movement.instructions,
    notes: movements[movement.id]?.notes.trim() ?? '',
    video_path: movements[movement.id]?.video_path ?? null,
    video_mime_type: movements[movement.id]?.video_mime_type ?? null,
    recorded_at: movements[movement.id]?.recorded_at ?? null,
  }));

  return {
    source: 'ml_assessment',
    completed_at: new Date().toISOString(),
    general_observations: Object.fromEntries(OBSERVATION_FIELDS.map((field) => [
      field.id,
      {
        label: field.label,
        value: observations[field.id]?.value ?? '',
        notes: observations[field.id]?.notes.trim() ?? '',
      },
    ])),
    movements: movementRows,
  };
}

export default function MLAssessmentView({
  clients,
  intakeNotes,
  appointments,
}: {
  clients: PTClient[];
  intakeNotes: MLAssessmentIntakeNote[];
  appointments: MLAssessmentAppointment[];
}) {
  const supabase = createClient();
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const dictationIntentRef = useRef(false);
  const dictationRef = useRef<{
    key: string;
    recognition: SpeechRecognitionLike;
    committed: string;
    apply: (value: string) => void;
  } | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [selectedClientId, setSelectedClientId] = useState(() => appointments[0]?.client_id ?? clients[0]?.id ?? '');
  const [chatAnswers, setChatAnswers] = useState<Record<string, VoiceDraft>>(() => emptyVoiceDrafts(CHAT_QUESTIONS));
  const [lifestyleAnswers, setLifestyleAnswers] = useState<Record<string, VoiceDraft>>(() => emptyVoiceDrafts(LIFESTYLE_QUESTIONS));
  const [observations, setObservations] = useState<Record<string, ObservationDraft>>(
    () => Object.fromEntries(OBSERVATION_FIELDS.map((field) => [field.id, { value: '', notes: '' }])),
  );
  const [movements, setMovements] = useState(() => emptyMovements());
  const [activeVoiceKey, setActiveVoiceKey] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState('');
  const [activeVideoKey, setActiveVideoKey] = useState<string | null>(null);
  const [deletingVideoKey, setDeletingVideoKey] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const intakeByClient = useMemo(() => {
    const map = new Map<string, MLAssessmentIntakeNote>();
    intakeNotes.forEach((note) => {
      if (!map.has(note.client_id)) map.set(note.client_id, note);
    });
    return map;
  }, [intakeNotes]);

  const appointmentByClient = useMemo(() => {
    const map = new Map<string, MLAssessmentAppointment>();
    appointments.forEach((appointment) => {
      if (!map.has(appointment.client_id)) map.set(appointment.client_id, appointment);
    });
    return map;
  }, [appointments]);

  const selectedIntake = selectedClient ? intakeByClient.get(selectedClient.id) ?? null : null;
  const selectedAppointment = selectedClient ? appointmentByClient.get(selectedClient.id) ?? null : null;
  const selectedDob = extractParqDob(selectedIntake) ?? selectedClient?.date_of_birth ?? null;
  const bookedClients = useMemo(
    () => new Set(appointments.map((appointment) => appointment.client_id)),
    [appointments],
  );

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => {
      const aBooked = bookedClients.has(a.id) ? 0 : 1;
      const bBooked = bookedClients.has(b.id) ? 0 : 1;
      if (aBooked !== bBooked) return aBooked - bBooked;
      return a.name.localeCompare(b.name);
    });
  }, [clients, bookedClients]);

  useEffect(() => {
    if (liveVideoRef.current && streamRef.current) {
      liveVideoRef.current.srcObject = streamRef.current;
    }
  }, [activeVideoKey]);

  useEffect(() => {
    return () => {
      dictationIntentRef.current = false;
      dictationRef.current?.recognition.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const updateChat = (id: string, patch: Partial<VoiceDraft>) => {
    setChatAnswers((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const updateLifestyle = (id: string, patch: Partial<VoiceDraft>) => {
    setLifestyleAnswers((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const updateMovement = (id: string, patch: Partial<MovementDraft>) => {
    setMovements((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const updateObservation = (id: string, patch: Partial<ObservationDraft>) => {
    setObservations((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const stopDictation = () => {
    dictationIntentRef.current = false;
    dictationRef.current?.recognition.stop();
    dictationRef.current = null;
    setActiveVoiceKey(null);
  };

  const startDictation = (key: string, initialText: string, apply: (value: string) => void) => {
    if (activeVoiceKey === key) {
      stopDictation();
      return;
    }

    const SR = getSpeechRecognition();
    if (!SR) {
      setVoiceError('Browser dictation is not available here. Use Chrome desktop/Android, or use the phone keyboard microphone in the text box.');
      return;
    }

    dictationIntentRef.current = false;
    dictationRef.current?.recognition.abort();
    setVoiceError('');

    const spawn = (committedText: string) => {
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-AU';
      dictationRef.current = { key, recognition, committed: committedText.trim(), apply };

      recognition.onresult = (event) => {
        const current = dictationRef.current;
        if (!current || current.key !== key) return;

        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript ?? '';
          if (!transcript) continue;
          if (result.isFinal) {
            current.committed = `${current.committed} ${transcript}`.trim();
          } else {
            interim = `${interim} ${transcript}`.trim();
          }
        }
        current.apply(`${current.committed}${interim ? ` ${interim}` : ''}`.trim());
      };

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
          setVoiceError('Microphone access was blocked. Allow microphone access and try again.');
          dictationIntentRef.current = false;
          setActiveVoiceKey(null);
          return;
        }
        if (event.error && event.error !== 'no-speech') setVoiceError(`Dictation stopped: ${event.error}`);
      };

      recognition.onend = () => {
        const current = dictationRef.current;
        if (!current || current.key !== key) return;
        if (dictationIntentRef.current) {
          window.setTimeout(() => spawn(current.committed), 150);
        } else {
          dictationRef.current = null;
          setActiveVoiceKey(null);
        }
      };

      try {
        recognition.start();
        setActiveVoiceKey(key);
      } catch {
        setVoiceError('Could not start dictation. Try again after a second.');
        setActiveVoiceKey(null);
      }
    };

    dictationIntentRef.current = true;
    spawn(initialText);
  };

  const startVideo = async (movementId: string) => {
    if (!selectedClient) {
      setVideoStatus('Select a client before recording.');
      return;
    }
    if (activeVideoKey) {
      setVideoStatus('Stop the current recording first.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVideoStatus('Camera recording is not available in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 9 / 16 },
        },
        audio: true,
      });
      const mimeType = mimeForRecorder();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      setActiveVideoKey(movementId);
      setVideoStatus('Recording...');

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        void uploadStoppedVideo(movementId, recorder.mimeType || mimeType || 'video/webm');
      };

      recorder.start();
    } catch (error) {
      setVideoStatus(error instanceof Error ? error.message : 'Could not open camera.');
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setActiveVideoKey(null);
    }
  };

  const stopVideo = () => {
    if (!recorderRef.current) return;
    setVideoStatus('Saving video...');
    recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const uploadStoppedVideo = async (movementId: string, mimeType: string) => {
    if (!selectedClient) return;
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const extension = extensionForMime(mimeType);
    const uploadId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint32Array(3))).map((value) => value.toString(16)).join('-');
    const path = `${selectedClient.id}/ml-assessment/${uploadId}-${cleanFileId(movementId)}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('pt-client-docs')
      .upload(path, blob, { contentType: mimeType, upsert: false });

    if (uploadError) {
      setVideoStatus(`Video upload failed: ${uploadError.message}`);
      setActiveVideoKey(null);
      recorderRef.current = null;
      chunksRef.current = [];
      return;
    }

    const { data: signed } = await supabase.storage.from('pt-client-docs').createSignedUrl(path, 3600);
    const recordedAt = new Date().toISOString();
    updateMovement(movementId, {
      video_path: path,
      video_url: signed?.signedUrl ?? null,
      video_mime_type: mimeType,
      recorded_at: recordedAt,
    });
    setVideoStatus('Video saved.');
    setActiveVideoKey(null);
    recorderRef.current = null;
    chunksRef.current = [];
  };

  const refreshVideoUrl = async (movementId: string, path: string) => {
    const { data } = await supabase.storage.from('pt-client-docs').createSignedUrl(path, 3600);
    if (data?.signedUrl) updateMovement(movementId, { video_url: data.signedUrl });
  };

  const deleteVideo = async (movementId: string, path: string) => {
    setDeletingVideoKey(movementId);
    setVideoStatus('Deleting video...');
    const { error } = await supabase.storage.from('pt-client-docs').remove([path]);
    if (error) {
      setVideoStatus(`Delete failed: ${error.message}`);
      setDeletingVideoKey(null);
      return;
    }
    updateMovement(movementId, {
      video_path: null,
      video_url: null,
      video_mime_type: null,
      recorded_at: null,
    });
    setVideoStatus('Video deleted.');
    setDeletingVideoKey(null);
  };

  const insertAssessmentNote = async (stage: 'part_1_chat' | 'part_2_lifestyle' | 'final', context: Record<string, unknown>, content: string) => {
    if (!selectedClient) return false;
    const { error } = await supabase.from('pt_client_notes').insert({
      client_id: selectedClient.id,
      content,
      is_active: true,
      context: {
        source: 'ml_assessment',
        stage,
        saved_at: new Date().toISOString(),
        ...context,
      },
    });
    if (error) {
      setStatus(`Save failed: ${error.message}`);
      return false;
    }

    await supabase.from('pt_events').insert({
      client_id: selectedClient.id,
      event_type: stage === 'final' ? 'ml_assessment_completed' : 'ml_assessment_stage_saved',
      metadata: { source: 'ml_assessment', stage, ...context },
    });
    return true;
  };

  const savePartOneAndNext = async () => {
    if (!selectedClient) { setStatus('Select a client first.'); return; }
    setSaving(true);
    setStatus('Saving Part 1...');
    const answers = compactAnswers(chatAnswers, CHAT_QUESTIONS);
    const ok = await insertAssessmentNote(
      'part_1_chat',
      { answers },
      `M & L Assessment Part 1 saved for ${selectedClient.name}.`,
    );
    setSaving(false);
    if (ok) {
      setStatus('Part 1 saved.');
      setStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const savePartTwoAndNext = async () => {
    if (!selectedClient) { setStatus('Select a client first.'); return; }
    setSaving(true);
    setStatus('Saving Part 2...');
    const answers = compactAnswers(lifestyleAnswers, LIFESTYLE_QUESTIONS);
    const ok = await insertAssessmentNote(
      'part_2_lifestyle',
      { answers, close_script: CONSULT_CLOSE },
      `M & L Assessment Part 2 saved for ${selectedClient.name}.`,
    );
    setSaving(false);
    if (ok) {
      setStatus('Part 2 saved.');
      setStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const finishAssessment = async () => {
    if (!selectedClient) { setStatus('Select a client first.'); return; }
    if (activeVideoKey) { setStatus('Stop the active video before finishing.'); return; }

    setSaving(true);
    setStatus('Saving M & L Assessment...');
    const movementSummary = buildMovementSummary(movements, observations);
    const chat = compactAnswers(chatAnswers, CHAT_QUESTIONS);
    const lifestyle = compactAnswers(lifestyleAnswers, LIFESTYLE_QUESTIONS);

    const ok = await insertAssessmentNote(
      'final',
      {
        client_info: {
          name: selectedClient.name,
          date_of_birth: selectedDob,
          consult_date: new Date().toISOString().slice(0, 10),
          intake_note_id: selectedIntake?.id ?? null,
          appointment_id: selectedAppointment?.id ?? null,
        },
        chat_answers: chat,
        lifestyle_answers: lifestyle,
        movement_assessment_summary: movementSummary,
      },
      `M & L Assessment completed. ${MOVEMENTS.filter((movement) => movements[movement.id]?.video_path).length} videos saved.`,
    );

    if (ok) {
      const weakMovements = MOVEMENTS
        .filter((movement) => movements[movement.id]?.notes.trim())
        .map((movement) => `${movement.title}: ${movements[movement.id].notes.trim()}`)
        .slice(0, 12);

      await supabase.functions.invoke('update-client-brain', {
        body: {
          client_id: selectedClient.id,
          trigger_type: 'note',
          content: `M & L Assessment completed for ${selectedClient.name}.`,
          structured_data: {
            source: 'ml_assessment',
            movement_assessment_summary: movementSummary,
            weak_movements: weakMovements,
            current_limitations: chat.find((answer) => answer.id === 'injuries_surgeries_pain')?.answer || undefined,
          },
        },
      });
      setStatus('M & L Assessment saved to the client profile.');
    }

    setSaving(false);
  };

  const selectedVideoStates = useMemo<Record<string, VideoState | null>>(() => {
    return Object.fromEntries(MOVEMENTS.map((movement) => {
      const draft = movements[movement.id];
      return [movement.id, draft?.video_path ? {
        path: draft.video_path,
        signedUrl: draft.video_url,
        mimeType: draft.video_mime_type ?? 'video/webm',
        recordedAt: draft.recorded_at ?? new Date().toISOString(),
      } : null];
    }));
  }, [movements]);

  const renderQuestion = (
    item: { id: string; prompt: string },
    draft: VoiceDraft,
    update: (id: string, patch: Partial<VoiceDraft>) => void,
    prefix: string,
  ) => {
    const voiceKey = `${prefix}:${item.id}`;
    const isListening = activeVoiceKey === voiceKey;

    return (
      <div key={item.id} className="border border-black/10 bg-white px-4 py-4">
        <p className="text-sm font-medium leading-6 text-black">{item.prompt}</p>
        <div className="mt-3 rounded-none border border-black/10 bg-[#fbfbf8]">
          <div className="flex items-center justify-between border-b border-black/8 px-3 py-2">
            <span className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Answer</span>
            <button
              type="button"
              onClick={() => startDictation(voiceKey, draft.answer, (value) => update(item.id, { answer: value }))}
              className={`inline-flex items-center gap-2 border px-3 py-1.5 text-xs transition-colors ${
                isListening
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-black/15 bg-white text-black/55 hover:border-black/35 hover:text-black'
              }`}
            >
              {isListening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              {isListening ? 'Stop' : 'Record'}
            </button>
          </div>
          <textarea
            value={draft.answer}
            onChange={(event) => update(item.id, { answer: event.target.value })}
            rows={4}
            placeholder={isListening ? 'Listening...' : 'Speak or type the answer here'}
            className="w-full resize-none bg-transparent px-3 py-3 text-base leading-7 outline-none placeholder:text-black/25"
          />
        </div>
        <label className="mt-3 block">
          <span className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Pedro notes</span>
          <textarea
            value={draft.notes}
            onChange={(event) => update(item.id, { notes: event.target.value })}
            rows={2}
            placeholder="Add anything you noticed after she speaks"
            className="mt-2 w-full resize-none border border-black/10 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-black/35"
          />
        </label>
      </div>
    );
  };

  const renderMovement = (movement: typeof MOVEMENTS[number]) => {
    const draft = movements[movement.id];
    const voiceKey = `movement:${movement.id}`;
    const isListening = activeVoiceKey === voiceKey;
    const isRecording = activeVideoKey === movement.id;
    const video = selectedVideoStates[movement.id];

    return (
      <section key={movement.id} className="border border-black/10 bg-white">
        <div className="border-b border-black/8 px-4 py-4">
          <p className="text-base font-medium leading-6 text-black">{movement.title}</p>
          <p className="mt-1 text-sm leading-6 text-black/50">{movement.instructions}</p>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="border border-black/10 bg-[#fbfbf8]">
            <div className="flex items-center justify-between border-b border-black/8 px-3 py-2">
              <span className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Video</span>
              <div className="flex items-center gap-2">
                {video?.path && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <Check className="h-3.5 w-3.5" />
                    Saved
                  </span>
                )}
                {video?.path && (
                  <button
                    type="button"
                    onClick={() => void deleteVideo(movement.id, video.path)}
                    disabled={deletingVideoKey === movement.id || isRecording}
                    className="inline-flex h-7 w-7 items-center justify-center border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                    aria-label={`Delete ${movement.title} video`}
                  >
                    {deletingVideoKey === movement.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>
            <div className="p-3">
              {isRecording && (
                <video
                  ref={liveVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="mx-auto mb-3 aspect-[9/16] max-h-[70vh] w-full max-w-[24rem] bg-black object-cover"
                />
              )}
              {video?.signedUrl && !isRecording && (
                <video
                  src={video.signedUrl}
                  controls
                  playsInline
                  className="mx-auto mb-3 aspect-[9/16] max-h-[70vh] w-full max-w-[24rem] bg-black object-cover"
                />
              )}
              {video?.path && !video.signedUrl && (
                <button
                  type="button"
                  onClick={() => void refreshVideoUrl(movement.id, video.path)}
                  className="mb-3 inline-flex items-center gap-2 border border-black/15 bg-white px-3 py-2 text-xs text-black/55"
                >
                  <Play className="h-3.5 w-3.5" />
                  Load saved video
                </button>
              )}
              <button
                type="button"
                onClick={() => (isRecording ? stopVideo() : void startVideo(movement.id))}
                disabled={!!activeVideoKey && !isRecording}
                className={`inline-flex w-full items-center justify-center gap-2 border px-4 py-3 text-sm font-medium transition-colors disabled:opacity-40 ${
                  isRecording
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-black bg-black text-white hover:bg-black/85'
                }`}
              >
                {isRecording ? <Square className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                {isRecording ? 'Stop and save video' : video?.path ? 'Record again' : 'Open camera and record'}
              </button>
            </div>
          </div>

          <div className="rounded-none border border-black/10 bg-[#fbfbf8]">
            <div className="flex items-center justify-between border-b border-black/8 px-3 py-2">
              <span className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Review notes</span>
              <button
                type="button"
                onClick={() => startDictation(voiceKey, draft.notes, (value) => updateMovement(movement.id, { notes: value }))}
                className={`inline-flex items-center gap-2 border px-3 py-1.5 text-xs transition-colors ${
                  isListening
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-black/15 bg-white text-black/55 hover:border-black/35 hover:text-black'
                }`}
              >
                {isListening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                {isListening ? 'Stop' : 'Record'}
              </button>
            </div>
            <textarea
              value={draft.notes}
              onChange={(event) => updateMovement(movement.id, { notes: event.target.value })}
              rows={4}
              placeholder={isListening ? 'Listening...' : 'Review the video and dictate notes here'}
              className="w-full resize-none bg-transparent px-3 py-3 text-base leading-7 outline-none placeholder:text-black/25"
            />
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="mx-auto max-w-5xl pb-28">
      <div className="sticky top-0 z-20 border-b border-black/8 bg-[#f6f1e8]/95 px-3 py-3 backdrop-blur md:static md:border-b-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-0">
        <div className="border border-black/10 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.2em] text-black/35">M & L Assessment</p>
              <h1 className="mt-2 font-display text-3xl font-light text-black md:text-4xl">Movement and lifestyle consult</h1>
            </div>
            <div className="grid grid-cols-3 gap-1 border border-black/10 bg-[#fbfbf8] p-1">
              {[1, 2, 3].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStep(item as Step)}
                  className={`px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] transition-colors ${
                    step === item ? 'bg-black text-white' : 'text-black/45 hover:bg-black/5 hover:text-black'
                  }`}
                >
                  Part {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <label className="block">
              <span className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Client</span>
              <select
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
                className="mt-2 w-full border border-black/10 bg-white px-3 py-3 text-base outline-none focus:border-black/35"
              >
                {sortedClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}{bookedClients.has(client.id) ? ' · assessment booked' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="flex items-center gap-1.5 text-[0.58rem] uppercase tracking-[0.16em] text-black/35">
                  <UserRound className="h-3.5 w-3.5" />
                  DOB / Age
                </p>
                <p className="mt-1 text-sm text-black/70">{formatDob(selectedDob)}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="flex items-center gap-1.5 text-[0.58rem] uppercase tracking-[0.16em] text-black/35">
                  <Calendar className="h-3.5 w-3.5" />
                  Consult
                </p>
                <p className="mt-1 text-sm text-black/70">
                  {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>
          </div>

          {selectedClient && (
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Name</p>
                <p className="mt-1 text-sm text-black/70">{selectedClient.name}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">PAR-Q</p>
                <p className={`mt-1 text-sm ${extractParqFlag(selectedIntake) ? 'text-amber-700' : 'text-black/70'}`}>
                  {selectedIntake ? (extractParqFlag(selectedIntake) ? 'Medical flag present' : 'All answers No') : 'No PAR-Q note found'}
                </p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Booked</p>
                <p className="mt-1 text-sm text-black/70">
                  {selectedAppointment
                    ? new Date(selectedAppointment.start_at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
                    : 'No upcoming assessment'}
                </p>
              </div>
            </div>
          )}

          {(selectedClient?.notes || selectedClient?.goals || extractParqCoachNote(selectedIntake)) && (
            <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.16em] text-amber-700">Profile notes pulled from client/PAR-Q</p>
              <div className="mt-2 space-y-1 text-sm leading-6 text-black/75">
                {selectedClient?.goals && <p>Goal: {selectedClient.goals}</p>}
                {selectedClient?.notes && <p>Client note: {selectedClient.notes}</p>}
                {extractParqCoachNote(selectedIntake) && <p>PAR-Q note: {extractParqCoachNote(selectedIntake)}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {voiceError && (
        <div className="mt-4 flex items-start gap-2 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {voiceError}
        </div>
      )}

      {videoStatus && (
        <div className="mt-4 border border-black/10 bg-white px-4 py-3 text-sm text-black/55">{videoStatus}</div>
      )}

      <main className="mt-4 space-y-4">
        {step === 1 && (
          <section className="space-y-4">
            <div className="border border-black/10 bg-white px-4 py-4">
              <p className="text-[0.62rem] uppercase tracking-[0.2em] text-black/35">Part 1</p>
              <h2 className="mt-2 font-display text-2xl font-light text-black">Chat</h2>
              <p className="mt-2 text-sm leading-6 text-black/50">Ask the question, press Record, and let the answer write into the field live.</p>
            </div>
            {CHAT_QUESTIONS.map((question) => renderQuestion(question, chatAnswers[question.id], updateChat, 'chat'))}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void savePartOneAndNext()}
                disabled={saving || !selectedClient}
                className="inline-flex flex-1 items-center justify-center gap-2 border border-black bg-black px-5 py-4 text-sm font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-black/85 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                Save Part 1 and Next
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <div className="border border-black/10 bg-white px-4 py-4">
              <p className="text-[0.62rem] uppercase tracking-[0.2em] text-black/35">Part 2</p>
              <h2 className="mt-2 font-display text-2xl font-light text-black">Lifestyle and context</h2>
            </div>
            {LIFESTYLE_QUESTIONS.map((question) => renderQuestion(question, lifestyleAnswers[question.id], updateLifestyle, 'lifestyle'))}
            <div className="border border-black/10 bg-white px-4 py-4">
              <p className="text-[0.62rem] uppercase tracking-[0.18em] text-black/35">Close the conversation</p>
              <p className="mt-2 text-base leading-7 text-black/75">{CONSULT_CLOSE}</p>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center justify-center gap-2 border border-black/15 bg-white px-4 py-4 text-sm text-black/55"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                onClick={() => void savePartTwoAndNext()}
                disabled={saving || !selectedClient}
                className="inline-flex items-center justify-center gap-2 border border-black bg-black px-5 py-4 text-sm font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-black/85 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                Save Part 2 and Next
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4">
            <div className="border border-black/10 bg-white px-4 py-4">
              <p className="text-[0.62rem] uppercase tracking-[0.2em] text-black/35">Part 3</p>
              <h2 className="mt-2 font-display text-2xl font-light text-black">Movement screening</h2>
              <p className="mt-2 text-sm leading-6 text-black/50">Record each movement, then dictate review notes after you watch it back.</p>
            </div>

            <section className="border border-black/10 bg-white">
              <div className="border-b border-black/8 px-4 py-4">
                <p className="text-base font-medium text-black">General observations</p>
                <p className="mt-1 text-sm text-black/50">Standing, relaxed posture.</p>
              </div>
              <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
                {OBSERVATION_FIELDS.map((field) => (
                  <div key={field.id} className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">{field.label}</span>
                      <div className="grid grid-cols-2 overflow-hidden rounded-full border border-black/10 bg-white p-0.5">
                        {(['yes', 'no'] as const).map((value) => {
                          const active = observations[field.id]?.value === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => updateObservation(field.id, { value: active ? '' : value })}
                              className={`rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-[0.12em] transition-colors ${
                                active ? 'bg-black text-white' : 'text-black/40 hover:bg-black/5 hover:text-black'
                              }`}
                            >
                              {value}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <textarea
                      value={observations[field.id]?.notes ?? ''}
                      onChange={(event) => updateObservation(field.id, { notes: event.target.value })}
                      rows={2}
                      placeholder={`${field.placeholder} Notes...`}
                      className="mt-3 w-full resize-none border border-black/10 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-black/35"
                    />
                  </div>
                ))}
              </div>
            </section>

            {MOVEMENTS.map(renderMovement)}

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center justify-center gap-2 border border-black/15 bg-white px-4 py-4 text-sm text-black/55"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                onClick={() => void finishAssessment()}
                disabled={saving || !selectedClient || !!activeVideoKey}
                className="inline-flex items-center justify-center gap-2 border border-black bg-black px-5 py-4 text-sm font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-black/85 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Finish M & L Assessment
              </button>
            </div>
          </section>
        )}
      </main>

      {status && (
        <div className="fixed inset-x-3 bottom-3 z-30 border border-black/10 bg-white px-4 py-3 text-sm text-black/65 shadow-[0_18px_60px_rgba(0,0,0,0.14)] md:left-auto md:w-[28rem]">
          {status}
        </div>
      )}
    </div>
  );
}
