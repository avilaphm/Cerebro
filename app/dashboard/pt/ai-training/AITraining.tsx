'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Mic, Sparkles, Square, Upload } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { ALL_QUESTIONS, SECTIONS, TOTAL_QUESTIONS } from './questions';
import { useDictation } from './useDictation';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const PROFILE_TITLE = 'Coach Training Profile';
const PROFILE_SOURCE = 'coach_training_profile';
const ACCEPTED_TYPES = '.pdf,.txt,.md,.doc,.docx';
const ACCEPTED_MIME = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const SECTION_OF: Record<string, string> = Object.fromEntries(
  ALL_QUESTIONS.map((q) => [q.key, q.section]),
);
const PROMPT_OF: Record<string, string> = Object.fromEntries(
  ALL_QUESTIONS.map((q) => [q.key, q.prompt]),
);

type SaveState = 'saving' | 'saved';

function appendSpeech(prev: string, add: string): string {
  const clean = add.trim();
  if (!clean) return prev;
  if (!prev.trim()) return clean.charAt(0).toUpperCase() + clean.slice(1);
  return `${prev.trimEnd()} ${clean}`;
}

function compileProfile(answers: Record<string, string>): string {
  const parts: string[] = [
    `# ${PROFILE_TITLE}`,
    `Authored by the coach via AI Training. This is the AUTHORITY for programme generation — follow it unless a specific client's own data overrides it.`,
    `Updated: ${new Date().toISOString().slice(0, 10)}`,
  ];
  for (const section of SECTIONS) {
    const answered = section.questions.filter((q) => (answers[q.key] ?? '').trim());
    if (answered.length === 0) continue;
    parts.push(`\n## Section ${section.id} — ${section.title}`);
    for (const q of answered) {
      parts.push(`\n### ${q.prompt}\n${answers[q.key].trim()}`);
    }
  }
  return parts.join('\n');
}

export default function AITraining({
  initialAnswers,
  initialCompleted,
}: {
  initialAnswers: Record<string, string>;
  initialCompleted: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
  const [interim, setInterim] = useState<{ key: string; text: string } | null>(null);
  const [completed, setCompleted] = useState(initialCompleted);
  const [finishing, setFinishing] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  const activeKeyRef = useRef<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const persist = useCallback(
    (key: string, text: string) => {
      setSaveState((s) => ({ ...s, [key]: 'saving' }));
      clearTimeout(saveTimers.current[key]);
      saveTimers.current[key] = setTimeout(async () => {
        const { error } = await supabase
          .from('pt_ai_training_answers')
          .upsert(
            {
              section: SECTION_OF[key],
              question_key: key,
              answer_text: text,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'question_key' },
          );
        setSaveState((s) => ({ ...s, [key]: error ? 'saving' : 'saved' }));
      }, 700);
    },
    [supabase],
  );

  const updateAnswer = useCallback(
    (key: string, text: string) => {
      setAnswers((p) => ({ ...p, [key]: text }));
      persist(key, text);
    },
    [persist],
  );

  const dictation = useDictation({
    onInterim: (text) => {
      const key = activeKeyRef.current;
      if (key) setInterim({ key, text });
    },
    onFinal: (text) => {
      const key = activeKeyRef.current;
      if (!key) return;
      const merged = appendSpeech(answersRef.current[key] ?? '', text);
      setAnswers((p) => ({ ...p, [key]: merged }));
      persist(key, merged);
      setInterim(null);
    },
  });
  useEffect(() => {
    // Track the active question for the dictation callbacks. Interim text is only
    // rendered while that question is listening, so no explicit clear is needed.
    activeKeyRef.current = dictation.listeningKey;
  }, [dictation.listeningKey]);

  const toggleMic = useCallback(
    (key: string) => {
      if (dictation.listeningKey === key) dictation.stop();
      else dictation.start(key);
    },
    [dictation],
  );

  const extractPdfText = useCallback(async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .filter((it): it is TextItem => 'str' in it)
        .map((it) => it.str)
        .join(' ')
        .trim();
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  }, []);

  const handleUpload = useCallback(
    async (key: string, file: File | null) => {
      if (!file) return;
      if (!ACCEPTED_MIME.includes(file.type)) {
        setUploadStatus((s) => ({ ...s, [key]: 'Unsupported file — use PDF, TXT, MD or DOCX.' }));
        return;
      }
      setUploadStatus((s) => ({ ...s, [key]: 'Uploading…' }));
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `ai-training/${key}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: storageError } = await supabase.storage
        .from('pt-knowledge-docs')
        .upload(path, file, { contentType: file.type });
      if (storageError) {
        setUploadStatus((s) => ({ ...s, [key]: `Upload failed: ${storageError.message}` }));
        return;
      }
      const { data: doc, error: insertError } = await supabase
        .from('pt_knowledge_documents')
        .insert({
          title: `AI Training — ${file.name}`,
          description: `Uploaded for: ${PROMPT_OF[key]}`,
          file_path: path,
          file_type: file.type,
          source: 'upload',
        })
        .select('id')
        .single();
      if (insertError || !doc) {
        setUploadStatus((s) => ({ ...s, [key]: `Failed: ${insertError?.message ?? 'unknown error'}` }));
        return;
      }
      setUploadStatus((s) => ({ ...s, [key]: 'Indexing…' }));
      let extractedText: string | undefined;
      if (file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          extractedText = await extractPdfText(file);
        } catch {
          setUploadStatus((s) => ({ ...s, [key]: 'Saved, but text extraction failed.' }));
          return;
        }
      }
      const { error: ingestError } = await supabase.functions.invoke('ingest-knowledge-document', {
        body: { document_id: doc.id, ...(extractedText ? { content_text: extractedText } : {}) },
      });
      setUploadStatus((s) => ({
        ...s,
        [key]: ingestError ? `Saved, indexing failed: ${ingestError.message}` : `✓ ${file.name} added`,
      }));
    },
    [supabase, extractPdfText],
  );

  const answeredCount = useMemo(
    () => ALL_QUESTIONS.filter((q) => (answers[q.key] ?? '').trim()).length,
    [answers],
  );
  const pct = Math.round((answeredCount / TOTAL_QUESTIONS) * 100);

  const finish = useCallback(async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      const content = compileProfile(answersRef.current);
      const { data: existing } = await supabase
        .from('pt_knowledge_documents')
        .select('id')
        .eq('source', PROFILE_SOURCE)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from('pt_knowledge_documents')
          .update({ title: PROFILE_TITLE, content_text: content })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('pt_knowledge_documents')
          .insert({ title: PROFILE_TITLE, source: PROFILE_SOURCE, content_text: content });
      }
      await supabase
        .from('pt_ai_training_status')
        .update({ completed: true, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', 1);
      setCompleted(true);
      setCelebrate(true);
    } catch (e) {
      setFinishError(e instanceof Error ? e.message : 'Could not save your training. Please try again.');
    } finally {
      setFinishing(false);
    }
  }, [supabase]);

  return (
    <div>
      <style>{`
        @keyframes cb-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.05) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes cb-draw { to { stroke-dashoffset: 0 } }
      `}</style>

      {/* Header */}
      <div className="mb-6">
        <p className="text-[0.6rem] font-medium uppercase tracking-[0.22em] text-black/35">Cerebro</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-light tracking-tight">
          <Sparkles className="h-5 w-5 text-black/50" strokeWidth={1.5} /> AI Training
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-black/50">
          Teach the AI how you coach. Answer in your own words — type, or tap the mic and just talk.
          The more you give it, the more every programme it generates thinks like you. You can leave
          and come back; your answers save as you go.
        </p>
      </div>

      {completed && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
          <Check className="h-4 w-4" /> Your AI is trained. Edit anything below and press{' '}
          <span className="font-medium">Update training</span> to re-save.
        </div>
      )}

      {/* Progress */}
      <div className="sticky top-0 z-10 mb-6 rounded-xl border border-black/10 bg-white/85 px-4 py-3 backdrop-blur">
        <div className="mb-1.5 flex items-center justify-between text-xs text-black/50">
          <span>{answeredCount === TOTAL_QUESTIONS ? 'All questions answered' : `${answeredCount} of ${TOTAL_QUESTIONS} answered`}</span>
          <span className="font-medium tabular-nums text-black/70">{pct}% trained</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
          <div className="h-full rounded-full bg-black transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.id}>
            <div className="mb-3">
              <h2 className="text-sm font-medium tracking-tight text-black/80">
                {section.id}. {section.title}
              </h2>
              <p className="text-xs text-black/45">{section.blurb}</p>
            </div>
            <div className="space-y-4">
              {section.questions.map((q) => {
                const listening = dictation.listeningKey === q.key;
                const status = saveState[q.key];
                return (
                  <div key={q.key} className="rounded-2xl border border-black/10 bg-black/[0.015] p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <label className="text-sm text-black/80" htmlFor={`q-${q.key}`}>
                        {q.prompt}
                      </label>
                      {status && (
                        <span className="shrink-0 text-[0.65rem] text-black/35">
                          {status === 'saving' ? 'Saving…' : 'Saved'}
                        </span>
                      )}
                    </div>
                    {q.hint && <p className="mb-2 text-xs text-black/40">{q.hint}</p>}

                    <div className="relative">
                      <textarea
                        id={`q-${q.key}`}
                        value={answers[q.key] ?? ''}
                        onChange={(e) => updateAnswer(q.key, e.target.value)}
                        rows={4}
                        placeholder="Type your answer, or tap the mic and talk…"
                        className="w-full resize-y rounded-lg border border-black/12 bg-white px-3 py-2.5 pr-12 text-sm leading-relaxed text-black/85 outline-none transition-colors focus:border-black/30"
                      />
                      {dictation.supported && (
                        <button
                          type="button"
                          onClick={() => toggleMic(q.key)}
                          aria-label={listening ? 'Stop dictation' : 'Start dictation'}
                          className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                            listening
                              ? 'animate-pulse border-red-500 bg-red-500 text-white'
                              : 'border-black/15 bg-white text-black/60 hover:bg-black/5'
                          }`}
                        >
                          {listening ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Mic className="h-4 w-4" />}
                        </button>
                      )}
                    </div>

                    {listening && (
                      <p className="mt-1.5 text-xs italic text-black/40">
                        {interim?.key === q.key && interim.text ? `“${interim.text}”` : 'Listening…'}
                      </p>
                    )}

                    {q.upload && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-black/15 px-3 py-1.5 text-xs text-black/60 transition-colors hover:bg-black/5">
                          <Upload className="h-3.5 w-3.5" /> {q.upload}
                          <input
                            type="file"
                            accept={ACCEPTED_TYPES}
                            className="hidden"
                            onChange={(e) => {
                              void handleUpload(q.key, e.target.files?.[0] ?? null);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {uploadStatus[q.key] && (
                          <span className="text-[0.7rem] text-black/45">{uploadStatus[q.key]}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Finish */}
      <div className="mt-10 flex flex-col items-start gap-3 border-t border-black/10 pt-6">
        {finishError && <p className="text-sm text-red-600">{finishError}</p>}
        <button
          type="button"
          onClick={() => void finish()}
          disabled={finishing || answeredCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#242424] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {completed ? 'Update training' : 'Finish training'}
        </button>
        <p className="text-xs text-black/40">
          This compiles your answers into your Coach Training Profile — the document every programme
          generation reads. You don&apos;t need to finish everything at once.
        </p>
      </div>

      {/* Celebration */}
      {celebrate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
          onClick={() => setCelebrate(false)}
        >
          <div
            className="flex max-w-sm flex-col items-center gap-4 rounded-3xl bg-white px-8 py-10 text-center shadow-2xl"
            style={{ animation: 'cb-pop 0.5s ease-out both' }}
            onClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 52 52" className="h-16 w-16">
              <circle cx="26" cy="26" r="24" fill="none" stroke="#111" strokeWidth="2" opacity="0.15" />
              <path
                d="M14 27 l8 8 l16 -18"
                fill="none"
                stroke="#111"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeDasharray: 48, strokeDashoffset: 48, animation: 'cb-draw 0.5s ease-out 0.25s forwards' }}
              />
            </svg>
            <div>
              <h3 className="text-lg font-light tracking-tight">Your AI is trained</h3>
              <p className="mt-1 text-sm text-black/50">
                Your Coach Training Profile is saved. Every new programme will now think more like you.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCelebrate(false)}
              className="mt-1 rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#242424]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
