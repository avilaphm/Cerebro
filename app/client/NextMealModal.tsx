'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// --- Speech recognition (iOS-safe, mirrors NutritionChatModal) ---
interface SpeechRecognitionResultItemLike { transcript: string; }
interface SpeechRecognitionResultLike { isFinal: boolean; length: number; [index: number]: SpeechRecognitionResultItemLike; }
interface SpeechRecognitionEventLike extends Event { results: ArrayLike<SpeechRecognitionResultLike>; resultIndex: number; }
interface SpeechRecognitionErrorEventLike extends Event { error: string; }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
const MEAL_OPTIONS: { slot: MealSlot; label: string; hint: string }[] = [
  { slot: 'breakfast', label: 'Breakfast', hint: 'Start the day' },
  { slot: 'lunch', label: 'Lunch', hint: 'Midday meal' },
  { slot: 'dinner', label: 'Dinner', hint: 'Evening meal' },
  { slot: 'snack', label: 'Snack', hint: 'Something small' },
];

type Category = 'protein' | 'vegetables' | 'fruit' | 'carbs' | 'dairy' | 'condiments' | 'other';
const CATEGORY_ORDER: Category[] = ['protein', 'vegetables', 'fruit', 'carbs', 'dairy', 'condiments', 'other'];
const CATEGORY_LABELS: Record<Category, string> = {
  protein: 'Protein',
  vegetables: 'Vegetables',
  fruit: 'Fruit',
  carbs: 'Carbs',
  dairy: 'Dairy',
  condiments: 'Sauces & condiments',
  other: 'Other',
};

// Lightweight autocomplete source. Kept small and hardcoded for v1.
const COMMON_INGREDIENTS: { name: string; category: Category }[] = [
  { name: 'chicken breast', category: 'protein' }, { name: 'chicken thigh', category: 'protein' },
  { name: 'beef mince', category: 'protein' }, { name: 'steak', category: 'protein' },
  { name: 'salmon', category: 'protein' }, { name: 'white fish', category: 'protein' },
  { name: 'tuna', category: 'protein' }, { name: 'prawns', category: 'protein' },
  { name: 'pork', category: 'protein' }, { name: 'lamb', category: 'protein' },
  { name: 'eggs', category: 'protein' }, { name: 'tofu', category: 'protein' },
  { name: 'chickpeas', category: 'protein' }, { name: 'black beans', category: 'protein' },
  { name: 'lentils', category: 'protein' }, { name: 'bacon', category: 'protein' },
  { name: 'spinach', category: 'vegetables' }, { name: 'broccoli', category: 'vegetables' },
  { name: 'capsicum', category: 'vegetables' }, { name: 'carrot', category: 'vegetables' },
  { name: 'zucchini', category: 'vegetables' }, { name: 'onion', category: 'vegetables' },
  { name: 'garlic', category: 'vegetables' }, { name: 'tomato', category: 'vegetables' },
  { name: 'mushroom', category: 'vegetables' }, { name: 'cucumber', category: 'vegetables' },
  { name: 'lettuce', category: 'vegetables' }, { name: 'sweet potato', category: 'vegetables' },
  { name: 'potato', category: 'vegetables' }, { name: 'cauliflower', category: 'vegetables' },
  { name: 'green beans', category: 'vegetables' }, { name: 'avocado', category: 'fruit' },
  { name: 'banana', category: 'fruit' }, { name: 'apple', category: 'fruit' },
  { name: 'berries', category: 'fruit' }, { name: 'lemon', category: 'fruit' },
  { name: 'rice', category: 'carbs' }, { name: 'pasta', category: 'carbs' },
  { name: 'bread', category: 'carbs' }, { name: 'wraps', category: 'carbs' },
  { name: 'oats', category: 'carbs' }, { name: 'quinoa', category: 'carbs' },
  { name: 'noodles', category: 'carbs' }, { name: 'couscous', category: 'carbs' },
  { name: 'milk', category: 'dairy' }, { name: 'greek yoghurt', category: 'dairy' },
  { name: 'cheese', category: 'dairy' }, { name: 'feta', category: 'dairy' },
  { name: 'butter', category: 'dairy' }, { name: 'cream', category: 'dairy' },
  { name: 'soy sauce', category: 'condiments' }, { name: 'olive oil', category: 'condiments' },
  { name: 'hot sauce', category: 'condiments' }, { name: 'mustard', category: 'condiments' },
  { name: 'honey', category: 'condiments' }, { name: 'peanut butter', category: 'condiments' },
  { name: 'tomato paste', category: 'condiments' }, { name: 'coconut milk', category: 'condiments' },
];

interface ConfirmIngredient {
  id: string;
  name: string;
  category: Category;
  confidence: 'high' | 'medium' | 'low';
  source: 'detected' | 'added';
  // Low-confidence detections start pending: the client answers a yes/no card
  // before they join the confirmed chips.
  pending: boolean;
}

const MAX_PHOTOS = 10;

interface PhotoEntry {
  preview: string;
  base64: string;
  mimeType: string;
}

interface DetectResponse {
  ok: boolean;
  ingredients?: { name: string; category: Category; confidence: 'high' | 'medium' | 'low' }[];
  error?: string;
}

interface MealOption {
  name: string;
  description: string;
  whyThisOne: string;
  prepTimeMinutes: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: { name: string; quantity: string }[];
  steps: string[];
}

interface GenContext {
  mode: 'full_day' | 'gap_fill';
  remaining: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
}

interface GenerateResponse {
  ok: boolean;
  meals?: MealOption[];
  context?: GenContext;
  error?: string;
}

type Step = 'mealType' | 'capture' | 'analyzing' | 'confirm' | 'generating' | 'options' | 'done';

interface Props {
  clientId: string;
  onClose: () => void;
  onLogged?: () => void;
}

let idCounter = 0;
const nextId = () => `ing-${Date.now()}-${idCounter++}`;

export default function NextMealModal({ clientId, onClose, onLogged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<Step>('mealType');
  const [mealType, setMealType] = useState<MealSlot | null>(null);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [ingredients, setIngredients] = useState<ConfirmIngredient[]>([]);
  const [includeStaples, setIncludeStaples] = useState(true);
  const [craving, setCraving] = useState('');
  const [addQuery, setAddQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [meals, setMeals] = useState<MealOption[]>([]);
  const [genContext, setGenContext] = useState<GenContext | null>(null);
  const [expandedMeal, setExpandedMeal] = useState<number | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [loggingName, setLoggingName] = useState<string | null>(null);
  const [loggedName, setLoggedName] = useState<string | null>(null);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingIntentRef = useRef(false);
  const cravingBaseRef = useRef('');
  const photosRef = useRef<PhotoEntry[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // Lock background scroll while the flow is open.
  useEffect(() => {
    const scrollEl = document.querySelector<HTMLElement>('.client-liquid > div');
    if (!scrollEl) return;
    const prev = scrollEl.style.overflowY;
    scrollEl.style.overflowY = 'hidden';
    return () => { scrollEl.style.overflowY = prev; };
  }, []);

  useEffect(() => () => {
    recordingIntentRef.current = false;
    recognitionRef.current?.abort();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
  }, []);

  // Attach the live camera stream to the <video> once the overlay has mounted.
  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().then(() => setCameraReady(true)).catch(() => setCameraReady(true));
  }, [cameraOpen]);

  // Animated progress while analyzing or generating. Progress is reset to 0 in the
  // handler before entering these steps, so the effect never sets state synchronously.
  useEffect(() => {
    if (step !== 'analyzing' && step !== 'generating') return;
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / 6000)))));
    }, 150);
    return () => clearInterval(id);
  }, [step]);

  const compressImage = (file: File, maxDim = 1280, quality = 0.82): Promise<{ base64: string; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = url;
    });

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const toAdd = Array.from(files).slice(0, remaining);
    const entries = await Promise.all(
      toAdd.map(async (file) => {
        const preview = URL.createObjectURL(file);
        const { base64, mimeType } = await compressImage(file);
        return { preview, base64, mimeType };
      }),
    );
    setPhotos((prev) => [...prev, ...entries]);
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  };

  // In-app camera: a live getUserMedia preview with a shutter, so several fridge
  // shots can be taken in a row without the native "Use Photo" confirmation each
  // time. Pattern mirrors the Studio / ML-assessment camera already in this app.
  const openCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click(); // fall back to the native single-shot camera
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraReady(false);
      setCameraOpen(true);
    } catch {
      setError('Couldn’t open the camera. You can still add photos from your library.');
      cameraInputRef.current?.click();
    }
  };

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setCameraReady(false);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || photos.length >= MAX_PHOTOS) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, 1280 / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    setPhotos((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, { preview: dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' }]));
  };

  const analyze = async () => {
    if (photos.length === 0) return;
    setError(null);
    setProgress(0);
    setStep('analyzing');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<DetectResponse>('detect-fridge-ingredients', {
        body: {
          client_id: clientId,
          photos: photos.map((p) => ({ base64: p.base64, mime_type: p.mimeType })),
        },
      });
      if (fnErr || !data?.ok || !data.ingredients) {
        // Surface the server's real reason (auth / parse) rather than always
        // blaming photo quality, which sends debugging down the wrong path.
        setError(data?.error ?? 'Something went wrong analysing your photos. Please try again.');
        setStep('capture');
        return;
      }
      if (data.ingredients.length === 0) {
        setError('No ingredients spotted. Try photos with the fridge open and items visible.');
        setStep('capture');
        return;
      }
      setIngredients(
        data.ingredients.map((i) => ({
          id: nextId(),
          name: i.name,
          category: CATEGORY_ORDER.includes(i.category) ? i.category : 'other',
          confidence: i.confidence,
          source: 'detected' as const,
          pending: i.confidence === 'low',
        })),
      );
      setStep('confirm');
    } catch {
      setError('Something went wrong reading your photos. Please try again.');
      setStep('capture');
    }
  };

  const removeIngredient = (id: string) => setIngredients((prev) => prev.filter((i) => i.id !== id));

  // Yes/No answer to a "just checking" card for an unsure detection.
  const confirmPending = (id: string, keep: boolean) => {
    setIngredients((prev) =>
      keep
        ? prev.map((i) => (i.id === id ? { ...i, pending: false } : i))
        : prev.filter((i) => i.id !== id),
    );
  };

  const addIngredient = (name: string, category: Category) => {
    const clean = name.trim();
    if (!clean) return;
    if (ingredients.some((i) => i.name.toLowerCase() === clean.toLowerCase())) {
      setAddQuery('');
      return;
    }
    setIngredients((prev) => [...prev, { id: nextId(), name: clean, category, confidence: 'high', source: 'added', pending: false }]);
    setAddQuery('');
  };

  const pendingItems = useMemo(() => ingredients.filter((i) => i.pending), [ingredients]);
  const confirmedNames = () => ingredients.filter((i) => !i.pending).map((i) => i.name);

  // --- Phase 2: generation ---
  const generate = async (opts?: { exclude?: string[]; fromOptions?: boolean }) => {
    if (!mealType) return;
    const list = confirmedNames();
    if (list.length === 0) return;
    setError(null);
    setProgress(0);
    setStep('generating');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<GenerateResponse>('suggest-next-meal', {
        body: {
          client_id: clientId,
          meal_type: mealType,
          ingredients: list,
          include_staples: includeStaples,
          craving: craving.trim() || undefined,
          exclude: opts?.exclude ?? [],
          count: 5,
        },
      });
      if (fnErr || !data?.ok || !data.meals?.length) {
        setError(data?.error ?? 'Could not build meal options. Please try again.');
        setStep(opts?.fromOptions ? 'options' : 'confirm');
        return;
      }
      setMeals(data.meals);
      setGenContext(data.context ?? null);
      setExpandedMeal(null);
      setStep('options');
    } catch {
      setError('Something went wrong building your options. Please try again.');
      setStep(opts?.fromOptions ? 'options' : 'confirm');
    }
  };

  // Swap a single card for a fresh option, keeping the rest.
  const regenOne = async (index: number) => {
    if (!mealType || regenIndex !== null) return;
    setRegenIndex(index);
    setError(null);
    try {
      const { data } = await supabase.functions.invoke<GenerateResponse>('suggest-next-meal', {
        body: {
          client_id: clientId,
          meal_type: mealType,
          ingredients: confirmedNames(),
          include_staples: includeStaples,
          craving: craving.trim() || undefined,
          exclude: meals.map((m) => m.name),
          count: 1,
        },
      });
      const fresh = data?.ok ? data.meals?.[0] : undefined;
      if (fresh) {
        setMeals((prev) => prev.map((m, i) => (i === index ? fresh : m)));
        setExpandedMeal((cur) => (cur === index ? null : cur));
      } else {
        setError(data?.error ?? 'Could not swap that option. Please try again.');
      }
    } finally {
      setRegenIndex(null);
    }
  };

  // "I made this" -> write a normal nutrition log the tracker will show.
  const logMeal = async (meal: MealOption) => {
    if (loggingName || !mealType) return;
    setLoggingName(meal.name);
    const { error: insErr } = await supabase.from('pt_nutrition_logs').insert({
      client_id: clientId,
      input_type: 'text',
      meal_type: mealType,
      meal_description: meal.name,
      food_items: meal.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: '' })),
      protein_g: meal.protein,
      carbs_g: meal.carbs,
      fat_g: meal.fat,
      calories: meal.calories,
      notes: 'Cooked from a Next Meal suggestion.',
    });
    setLoggingName(null);
    if (insErr) {
      setError('Could not log that meal. Please try again.');
      return;
    }
    setLoggedName(meal.name);
    onLogged?.();
    setStep('done');
  };

  const suggestions = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return [];
    const existing = new Set(ingredients.map((i) => i.name.toLowerCase()));
    return COMMON_INGREDIENTS
      .filter((c) => c.name.includes(q) && !existing.has(c.name))
      .slice(0, 6);
  }, [addQuery, ingredients]);

  const grouped = useMemo(() => {
    const map = new Map<Category, ConfirmIngredient[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    ingredients.filter((i) => !i.pending).forEach((i) => map.get(i.category)!.push(i));
    return CATEGORY_ORDER.map((cat) => ({ cat, items: map.get(cat)! })).filter((g) => g.items.length > 0);
  }, [ingredients]);

  // --- Voice for the craving field ---
  const startVoice = () => {
    const SpeechRecog = getSpeechRecognition();
    if (!SpeechRecog) {
      setError('Voice input is not supported in this browser. Please type instead.');
      return;
    }
    const spawn = () => {
      if (!recordingIntentRef.current) return;
      const rec = new SpeechRecog();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-AU';
      rec.onresult = (e) => {
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
        }
        if (final) {
          const committed = [cravingBaseRef.current, final].filter((s) => s.trim()).join(' ').trim();
          cravingBaseRef.current = committed;
          setCraving(committed);
        }
      };
      rec.onend = () => {
        recognitionRef.current = null;
        if (recordingIntentRef.current) setTimeout(spawn, 80);
        else setRecording(false);
      };
      rec.onerror = (e) => {
        recognitionRef.current = null;
        if (e.error === 'not-allowed') {
          setError('Microphone access denied. Allow it in your browser settings and try again.');
          recordingIntentRef.current = false;
          setRecording(false);
        } else if (recordingIntentRef.current) {
          setTimeout(spawn, e.error === 'no-speech' || e.error === 'aborted' ? 80 : 200);
        } else {
          setRecording(false);
        }
      };
      try {
        rec.start();
        recognitionRef.current = rec;
      } catch {
        if (recordingIntentRef.current) setTimeout(spawn, 300);
        else setRecording(false);
      }
    };
    recordingIntentRef.current = true;
    cravingBaseRef.current = craving;
    setRecording(true);
    setError(null);
    spawn();
  };

  const stopVoice = () => {
    recordingIntentRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  };

  const mealLabel = mealType ? MEAL_OPTIONS.find((m) => m.slot === mealType)!.label : '';

  const stepTitle =
    step === 'mealType' ? 'Help me with my next meal'
    : step === 'capture' ? 'Show me what you have'
    : step === 'analyzing' ? 'Reading your kitchen'
    : step === 'confirm' ? 'Confirm your ingredients'
    : step === 'generating' ? 'Building your options'
    : step === 'options' ? 'Your meal options'
    : "You're all set";

  const goBack = () => {
    setError(null);
    if (step === 'capture') { setStep('mealType'); return; }
    if (step === 'confirm') { setStep('capture'); return; }
    if (step === 'options') { setStep('confirm'); return; }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f0]">
      {/* Header */}
      <div className="flex shrink-0 items-center px-4 pb-3 pt-14">
        <button
          type="button"
          onClick={step === 'capture' || step === 'confirm' || step === 'options' ? goBack : onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white text-black/40 shadow-sm transition-colors hover:text-black"
          aria-label={step === 'capture' || step === 'confirm' || step === 'options' ? 'Back' : 'Close'}
        >
          {step === 'capture' || step === 'confirm' || step === 'options' ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2L4 7l5 5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          )}
        </button>
        <div className="flex-1 px-3 text-center">
          <p className="text-sm font-medium leading-tight">{stepTitle}</p>
          {mealType && step !== 'mealType' && (
            <p className="mt-0.5 text-[0.6rem] uppercase tracking-[0.12em] leading-tight text-black/35">{mealLabel}</p>
          )}
        </div>
        <div className="h-9 w-9 shrink-0" />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
        {/* STEP: meal type */}
        {step === 'mealType' && (
          <div className="mx-auto max-w-md">
            <p className="mb-4 px-1 text-[0.72rem] leading-relaxed text-black/45">
              Pick what you&apos;re about to eat. I&apos;ll use what&apos;s in your fridge and how many calories you have left today to suggest options that fit your plan.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {MEAL_OPTIONS.map((m) => (
                <button
                  key={m.slot}
                  type="button"
                  onClick={() => { setMealType(m.slot); setError(null); setStep('capture'); }}
                  className="flex flex-col items-start gap-1 border border-black/10 bg-white px-4 py-5 text-left transition-colors hover:border-black/40"
                >
                  <span className="text-base font-medium">{m.label}</span>
                  <span className="text-[0.65rem] text-black/35">{m.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP: capture */}
        {step === 'capture' && (
          <div className="mx-auto max-w-md space-y-3">
            <div className="flex items-start gap-2.5 rounded-2xl border border-black/8 bg-white px-3.5 py-3 shadow-sm">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="mt-0.5 shrink-0 text-black/35">
                <path d="M1.5 5h2l1.5-2h6L12.5 5H14.5v8.5h-13V5z" /><circle cx="8" cy="9" r="2.2" />
              </svg>
              <p className="text-[0.65rem] leading-relaxed text-black/45">
                <span className="font-medium text-black/60">Open the fridge fully.</span> Tap the camera and snap as many shots as you like — fridge, freezer, pantry — then hit Done. More angles = better suggestions.
              </p>
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative aspect-square">
                    <img src={p.preview} alt={`kitchen ${i + 1}`} className="h-full w-full rounded-2xl object-cover shadow-sm" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs shadow"
                      aria-label="Remove photo"
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => void openCamera()}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-black py-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M2 7h3l2-2.5h9L18 7h2v11.5H2V7z" /><circle cx="11" cy="13" r="3" />
                </svg>
                {photos.length === 0 ? 'Open camera' : 'Take more'}
              </button>
            )}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="w-full rounded-full border border-black/10 bg-white py-2.5 text-[0.7rem] font-medium text-black/50 transition-colors hover:border-black/30 hover:text-black"
              >
                Choose from library
              </button>
            )}

            {photos.length > 0 && (
              <p className="text-center text-[0.6rem] text-black/30 tabular-nums">{photos.length}/{MAX_PHOTOS} photos</p>
            )}

            {error && <p className="px-1 text-[0.7rem] text-red-500">{error}</p>}

            <input ref={galleryInputRef} type="file" accept="image/*" multiple onChange={(e) => void addPhotos(e.target.files)} className="hidden" />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => void addPhotos(e.target.files)} className="hidden" />
          </div>
        )}

        {/* STEP: analyzing / generating */}
        {(step === 'analyzing' || step === 'generating') && (
          <div className="flex flex-col items-center justify-center gap-6 py-20">
            <div className="relative h-16 w-16">
              <svg className="absolute inset-0 -rotate-90" width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" className="text-black/10" />
                <circle
                  cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-black"
                  style={{
                    strokeDasharray: `${2 * Math.PI * 28}`,
                    strokeDashoffset: `${2 * Math.PI * 28 * (1 - progress / 100)}`,
                    transition: 'stroke-dashoffset 0.3s ease-out',
                  }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{progress}%</span>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {step === 'analyzing'
                  ? (progress < 40 ? 'Looking through your photos…' : progress < 75 ? 'Spotting ingredients…' : 'Almost there…')
                  : (progress < 40 ? 'Checking your macros for today…' : progress < 75 ? 'Cooking up options…' : 'Almost there…')}
              </p>
              <p className="mt-1 text-[0.65rem] text-black/35">This usually takes a few seconds</p>
            </div>
          </div>
        )}

        {/* STEP: confirm */}
        {step === 'confirm' && (
          <div className="mx-auto max-w-md space-y-5">
            <p className="px-1 text-[0.72rem] leading-relaxed text-black/45">
              Here&apos;s what I spotted. Remove anything that&apos;s wrong and add anything I missed.
            </p>

            {/* Yes/No cards for items the AI wasn't sure about */}
            {pendingItems.length > 0 && (
              <div className="space-y-2">
                <p className="px-1 text-[0.58rem] font-medium uppercase tracking-[0.14em] text-amber-500">Just checking</p>
                {pendingItems.map((ing) => (
                  <div key={ing.id} className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                    <p className="min-w-0 text-sm">
                      Do you have <span className="font-medium">{ing.name}</span>?
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => confirmPending(ing.id, true)}
                        className="rounded-full bg-black px-4 py-2 text-[0.72rem] font-medium text-white transition-opacity hover:opacity-90"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmPending(ing.id, false)}
                        className="rounded-full border border-black/15 bg-white px-4 py-2 text-[0.72rem] font-medium text-black/55 transition-colors hover:border-black/35"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {grouped.map(({ cat, items }) => (
              <div key={cat}>
                <p className="mb-2 px-1 text-[0.58rem] font-medium uppercase tracking-[0.14em] text-black/35">{CATEGORY_LABELS[cat]}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map((ing) => (
                    <button
                      key={ing.id}
                      type="button"
                      onClick={() => removeIngredient(ing.id)}
                      className="group inline-flex items-center gap-1.5 rounded-full border border-black/12 bg-white py-1.5 pl-3 pr-2 text-[0.78rem] text-black/80 transition-colors hover:border-black/30"
                    >
                      <span>{ing.name}</span>
                      <span className="flex h-4 w-4 items-center justify-center rounded-full text-black/25 transition-colors group-hover:bg-black/5 group-hover:text-black/60" aria-hidden>×</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Add ingredient */}
            <div>
              <p className="mb-2 px-1 text-[0.58rem] font-medium uppercase tracking-[0.14em] text-black/35">Add something</p>
              <div className="relative">
                <input
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredient(addQuery, 'other'); } }}
                  placeholder="Type an ingredient and press enter"
                  className="w-full border border-black/12 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-black/40"
                />
                {suggestions.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg">
                    {suggestions.map((s) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => addIngredient(s.name, s.category)}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-black/[0.03]"
                      >
                        <span>{s.name}</span>
                        <span className="text-[0.6rem] uppercase tracking-[0.08em] text-black/30">{CATEGORY_LABELS[s.category]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Staples toggle */}
            <button
              type="button"
              onClick={() => setIncludeStaples((v) => !v)}
              className="flex w-full items-center justify-between border border-black/10 bg-white px-4 py-3 text-left transition-colors hover:border-black/25"
            >
              <span className="min-w-0 pr-3">
                <span className="block text-sm font-medium">I have basic staples</span>
                <span className="mt-0.5 block text-[0.65rem] text-black/40">Oil, salt, pepper &amp; common dried spices</span>
              </span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${includeStaples ? 'bg-black' : 'bg-black/15'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${includeStaples ? 'left-[1.375rem]' : 'left-0.5'}`} />
              </span>
            </button>

            {/* Craving */}
            <div>
              <p className="mb-2 px-1 text-[0.58rem] font-medium uppercase tracking-[0.14em] text-black/35">Craving anything? <span className="text-black/25">(optional)</span></p>
              <div className="flex items-center gap-2 border border-black/12 bg-white px-3.5 py-1.5 transition-colors focus-within:border-black/40">
                <input
                  value={craving}
                  onChange={(e) => { setCraving(e.target.value); cravingBaseRef.current = e.target.value; }}
                  placeholder={recording ? 'Listening…' : 'e.g. something warm, tacos, protein pancakes'}
                  className={`min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-black/25 ${recording ? 'text-red-700' : ''}`}
                />
                <button
                  type="button"
                  onClick={recording ? stopVoice : startVoice}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${recording ? 'bg-red-50 text-red-500' : 'text-black/35 hover:bg-black/5 hover:text-black'}`}
                  aria-label={recording ? 'Stop recording' : 'Start voice input'}
                >
                  {recording ? (
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="5" width="10" height="10" rx="2" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="7.5" y="1.5" width="7" height="11" rx="3.5" /><path d="M3.5 11a7.5 7.5 0 0015 0M11 18.5v2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && <p className="px-1 text-[0.7rem] text-red-500">{error}</p>}
          </div>
        )}

        {/* STEP: options — 5 meal suggestions */}
        {step === 'options' && (
          <div className="mx-auto max-w-md space-y-3">
            {genContext && (
              <div className="rounded-2xl border border-black/8 bg-white px-4 py-3 shadow-sm">
                {genContext.mode === 'full_day' ? (
                  <p className="text-[0.7rem] leading-relaxed text-black/55">
                    <span className="font-medium text-black/70">First meal of the day.</span> These options are one part of your {genContext.remaining.calories} kcal / {genContext.remaining.protein_g}g protein for today, sized to leave room for the rest.
                  </p>
                ) : (
                  <p className="text-[0.7rem] leading-relaxed text-black/55">
                    <span className="font-medium text-black/70">{genContext.remaining.calories} kcal &middot; {genContext.remaining.protein_g}g protein left today.</span> Options fit what you have and what&apos;s left.
                  </p>
                )}
              </div>
            )}

            {meals.map((m, i) => {
              const expanded = expandedMeal === i;
              const busy = regenIndex === i;
              return (
                <div key={`${m.name}-${i}`} className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
                  <button type="button" onClick={() => setExpandedMeal(expanded ? null : i)} className="w-full px-4 py-3.5 text-left">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-snug">{m.name}</p>
                      {m.calories != null && <span className="shrink-0 text-xs font-medium tabular-nums">{m.calories} kcal</span>}
                    </div>
                    {m.description && <p className="mt-1 text-[0.7rem] leading-relaxed text-black/45">{m.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.62rem] tabular-nums text-black/40">
                      {m.protein != null && <span>{m.protein}g P</span>}
                      {m.carbs != null && <span>{m.carbs}g C</span>}
                      {m.fat != null && <span>{m.fat}g F</span>}
                      {m.prepTimeMinutes != null && <span className="text-black/35">&middot; {m.prepTimeMinutes} min</span>}
                    </div>
                    {m.whyThisOne && (
                      <p className="mt-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[0.66rem] leading-relaxed text-black/55">{m.whyThisOne}</p>
                    )}
                    <p className="mt-1.5 text-[0.58rem] uppercase tracking-[0.1em] text-black/25">{expanded ? 'Hide recipe' : 'Tap for recipe'}</p>
                  </button>

                  {expanded && (
                    <div className="space-y-3 border-t border-black/8 px-4 py-3">
                      {m.ingredients.length > 0 && (
                        <div>
                          <p className="mb-1 text-[0.56rem] font-medium uppercase tracking-[0.14em] text-black/35">Ingredients</p>
                          <ul className="space-y-0.5">
                            {m.ingredients.map((ing, k) => (
                              <li key={k} className="text-[0.72rem] text-black/60">{ing.name}{ing.quantity ? ` · ${ing.quantity}` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {m.steps.length > 0 && (
                        <div>
                          <p className="mb-1 text-[0.56rem] font-medium uppercase tracking-[0.14em] text-black/35">Steps</p>
                          <ol className="space-y-1">
                            {m.steps.map((s, k) => (
                              <li key={k} className="flex gap-2 text-[0.72rem] leading-relaxed text-black/60">
                                <span className="text-black/30">{k + 1}.</span><span>{s}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 border-t border-black/8 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => void logMeal(m)}
                      disabled={loggingName === m.name}
                      className="flex-1 rounded-full bg-black py-2.5 text-[0.72rem] font-medium text-white transition-opacity disabled:opacity-40"
                    >
                      {loggingName === m.name ? 'Logging…' : 'I made this'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void regenOne(i)}
                      disabled={busy}
                      className="rounded-full border border-black/12 bg-white px-4 py-2.5 text-[0.72rem] font-medium text-black/55 transition-colors hover:border-black/30 disabled:opacity-40"
                    >
                      {busy ? '…' : 'Swap'}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Craving re-ask */}
            <div className="rounded-2xl border border-black/8 bg-white px-4 py-3 shadow-sm">
              <p className="text-[0.66rem] text-black/45">Not what you&apos;re after? Tweak your craving and get five fresh options.</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={craving}
                  onChange={(e) => setCraving(e.target.value)}
                  placeholder="e.g. something warm, tacos"
                  className="min-w-0 flex-1 border border-black/12 bg-white px-3 py-2 text-[0.8rem] outline-none focus:border-black/40"
                />
                <button
                  type="button"
                  onClick={() => void generate({ exclude: meals.map((m) => m.name), fromOptions: true })}
                  className="shrink-0 rounded-full bg-black px-4 py-2 text-[0.72rem] font-medium text-white"
                >
                  New options
                </button>
              </div>
            </div>

            {error && <p className="px-1 text-[0.7rem] text-red-500">{error}</p>}
          </div>
        )}

        {/* STEP: done — logged to the tracker */}
        {step === 'done' && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11l5 5L18 6" /></svg>
            </div>
            <div>
              <p className="text-sm font-medium">Logged to your tracker</p>
              <p className="mx-auto mt-2 max-w-[18rem] text-[0.72rem] leading-relaxed text-black/45">
                {loggedName ? `"${loggedName}" ` : ''}added to your {mealLabel.toLowerCase()}. Nice work.
              </p>
            </div>
            <button type="button" onClick={onClose} className="mt-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90">
              Done
            </button>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      {(step === 'capture' || step === 'confirm') && (
        <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
          {step === 'capture' ? (
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={photos.length === 0}
              className="w-full rounded-full bg-black py-3.5 text-sm font-medium text-white transition-opacity disabled:opacity-20"
            >
              {photos.length === 0 ? 'Add a photo to continue' : `Analyze ${photos.length} photo${photos.length !== 1 ? 's' : ''}`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={confirmedNames().length === 0}
              className="w-full rounded-full bg-black py-3.5 text-sm font-medium text-white transition-opacity disabled:opacity-20"
            >
              Find meals
            </button>
          )}
        </div>
      )}

      {/* In-app camera overlay: live preview + shutter, snap several in a row */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
          {!cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Starting camera…</div>
          )}

          <div className="relative z-10 flex items-center justify-between px-4 pb-3 pt-14">
            <span className="rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white tabular-nums backdrop-blur-sm">{photos.length}/{MAX_PHOTOS}</span>
            <button
              type="button"
              onClick={closeCamera}
              className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black shadow"
            >
              Done
            </button>
          </div>

          <div className="flex-1" />

          {photos.length > 0 && (
            <div className="relative z-10 flex gap-2 overflow-x-auto px-4 pb-3">
              {photos.map((p, i) => (
                <img key={i} src={p.preview} alt={`shot ${i + 1}`} className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-white/40" />
              ))}
            </div>
          )}

          <div className="relative z-10 flex items-center justify-center pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-2">
            <button
              type="button"
              onClick={capturePhoto}
              disabled={photos.length >= MAX_PHOTOS}
              aria-label="Take photo"
              className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/90 transition-transform active:scale-95 disabled:opacity-40"
            >
              <span className="h-16 w-16 rounded-full bg-white" />
            </button>
          </div>

          {photos.length >= MAX_PHOTOS && (
            <p className="relative z-10 pb-4 text-center text-[0.7rem] text-white/70">That&apos;s the max — tap Done to continue.</p>
          )}
        </div>
      )}
    </div>
  );
}
