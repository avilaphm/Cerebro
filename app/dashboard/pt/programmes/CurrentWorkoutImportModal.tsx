'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { PTProgrammeDay } from '@/utils/pt/types';

interface ImportImage {
  name: string;
  mime_type: string;
  base64: string;
}

interface ImportResult {
  ok?: boolean;
  days?: PTProgrammeDay[];
  created_exercises?: Array<{ name: string; exercise_id: string }>;
  missing_exercises?: string[];
  matched_count?: number;
  extracted_text?: string;
  error?: string;
}

interface FunctionErrorWithContext {
  message?: string;
  context?: {
    clone?: () => Response;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  };
}

type PdfParseResponse = { text?: string; error?: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (days: PTProgrammeDay[], result: ImportResult) => void;
}

async function fileToImportImage(file: File): Promise<ImportImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mime_type: file.type || 'image/png',
    base64: dataUrl.split(',')[1] ?? dataUrl,
  };
}

async function readPdfText(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/pt/parse-pdf', { method: 'POST', body: form });
  const contentType = res.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await res.json() as PdfParseResponse
    : { error: await res.text() };
  if (!res.ok || payload.error || !payload.text?.trim()) {
    throw new Error(payload.error ?? 'Could not read PDF.');
  }
  return payload.text.trim();
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

export default function CurrentWorkoutImportModal({ open, onClose, onImported }: Props) {
  const supabase = createClient();
  const MAX_IMAGES = 8;
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImportImage[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  if (!open) return null;

  const resetAndClose = () => {
    if (busy) return;
    setText('');
    setImages([]);
    setPreview(null);
    setStatus('');
    onClose();
  };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    const imageFiles = selected
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, Math.max(0, MAX_IMAGES - images.length));
    const pdfFiles = selected.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

    if (imageFiles.length === 0 && pdfFiles.length === 0) {
      setStatus('Upload screenshots, images, or PDFs.');
      return;
    }

    setPreview(null);
    try {
      if (imageFiles.length > 0) {
        setStatus(`Reading ${imageFiles.length === 1 ? 'screenshot' : 'screenshots'}...`);
        const loaded = await Promise.all(imageFiles.map(fileToImportImage));
        setImages((cur) => [...cur, ...loaded].slice(0, MAX_IMAGES));
      }
      if (pdfFiles.length > 0) {
        setStatus(`Reading ${pdfFiles.length === 1 ? pdfFiles[0].name : `${pdfFiles.length} PDFs`}...`);
        const pdfTexts = await Promise.all(pdfFiles.map(readPdfText));
        setText((current) => [current.trim(), ...pdfTexts.map((pdfText, index) => `PDF: ${pdfFiles[index].name}\n${pdfText}`)]
          .filter(Boolean)
          .join('\n\n'));
      }
      setStatus(pdfFiles.length > 0 ? 'PDF added to workout text.' : '');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const runImport = async (mode: 'preview' | 'commit') => {
    if (text.trim().length < 5 && images.length === 0) {
      setStatus('Paste workout text or add at least one screenshot.');
      return;
    }

    setBusy(true);
    setStatus(mode === 'preview' ? 'Reading current workout...' : 'Creating missing exercise cards and adding days...');
    const { data, error } = await supabase.functions.invoke('import-current-workout', {
      body: { mode, text, images },
    });
    setBusy(false);

    const result = data as ImportResult | null;
    if (error || result?.error || !result?.days) {
      setStatus(result?.error ?? await functionErrorMessage(error, 'Could not import the current workout.'));
      return;
    }

    if (mode === 'preview') {
      setPreview(result);
      const missing = result.missing_exercises?.length ?? 0;
      setStatus(`${result.days.length} day${result.days.length === 1 ? '' : 's'} found. ${missing} new exercise card${missing === 1 ? '' : 's'} will be created when you add it.`);
      return;
    }

    onImported(result.days, result);
    resetAndClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="no-glass flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-black/10 bg-[#fbfaf7] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-sm font-medium">Add current workout to Foundation</p>
            <p className="mt-1 text-xs text-black/45">Paste text or upload screenshots/PDFs. Imported days are appended after the generated Foundation days. Up to {MAX_IMAGES} screenshots.</p>
          </div>
          <button type="button" onClick={resetAndClose} className="text-xl leading-none text-black/35 hover:text-black">x</button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Workout text</label>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setPreview(null); }}
              rows={7}
              placeholder={'Paste the client current programme here, or add screenshots/PDFs below.\nExample: Day 1 - Lower body. Leg press 3x10, RDL 3x8, split squat 3x10...'}
              className="w-full resize-y border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Screenshots or PDF</label>
            <input
              type="file"
              accept="image/*,.pdf,application/pdf"
              multiple
              onChange={(e) => { void addImages(e.target.files); e.currentTarget.value = ''; }}
              className="block w-full border border-black/10 bg-white px-3 py-2 text-xs"
            />
            {images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {images.map((image, index) => (
                  <button
                    key={`${image.name}-${index}`}
                    type="button"
                    onClick={() => { setImages((cur) => cur.filter((_, i) => i !== index)); setPreview(null); }}
                    className="border border-black/10 bg-white px-2 py-1 text-[0.65rem] text-black/55 hover:border-black/30 hover:text-black"
                  >
                    {image.name} x
                  </button>
                ))}
              </div>
            )}
          </div>

          {preview?.days && (
            <div className="space-y-3 border border-black/10 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Preview</p>
                <p className="text-xs text-black/45">{preview.matched_count ?? 0} matched · {preview.missing_exercises?.length ?? 0} new</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {preview.days.map((day, dayIndex) => (
                  <div key={`${day.title}-${dayIndex}`} className="border border-black/8 p-3">
                    <p className="text-xs font-medium">{day.title || `Day ${dayIndex + 1}`}</p>
                    <p className="mt-0.5 text-[0.65rem] text-black/40">{day.exercises.length} exercise{day.exercises.length === 1 ? '' : 's'}</p>
                    <div className="mt-2 space-y-1">
                      {day.exercises.slice(0, 8).map((exercise, exerciseIndex) => (
                        <p key={`${exercise.name}-${exerciseIndex}`} className="truncate text-[0.7rem] text-black/65">
                          {exercise.name} {exercise.sets || exercise.reps ? `· ${exercise.sets}x${exercise.reps}` : ''}
                        </p>
                      ))}
                      {day.exercises.length > 8 && <p className="text-[0.65rem] text-black/35">+{day.exercises.length - 8} more</p>}
                    </div>
                  </div>
                ))}
              </div>
              {(preview.missing_exercises?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Exercise cards to create</p>
                  <p className="mt-1 text-xs text-black/55">{preview.missing_exercises?.join(', ')}</p>
                </div>
              )}
            </div>
          )}

          {status && <p className="text-xs text-black/55">{status}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-black/10 px-5 py-4">
          <button type="button" onClick={resetAndClose} disabled={busy} className="border border-black/15 px-4 py-2 text-sm hover:border-black/35 disabled:opacity-40">
            Cancel
          </button>
          <button type="button" onClick={() => void runImport('preview')} disabled={busy || (text.trim().length < 5 && images.length === 0)} className="border border-black/15 px-4 py-2 text-sm hover:border-black/35 disabled:opacity-40">
            Preview
          </button>
          <button type="button" onClick={() => void runImport('commit')} disabled={busy || (text.trim().length < 5 && images.length === 0)} className="border border-black bg-black px-4 py-2 text-sm text-white hover:bg-white hover:text-black disabled:opacity-30">
            Add to Foundation
          </button>
        </div>
      </div>
    </div>
  );
}
