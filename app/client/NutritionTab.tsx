'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, X } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/utils/supabase/client';
import NutritionChatModal from './NutritionChatModal';
import NextMealModal from './NextMealModal';
import RecipeBookModal from './RecipeBookModal';

interface FoodItem {
  name: string;
  quantity: string;
  unit: string;
  weight_g?: number;
}

interface NutritionLog {
  id: string;
  meal_type: string | null;
  meal_description: string;
  food_items: FoodItem[];
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  calories: number | null;
  input_type: string;
  logged_at: string;
}

interface DailyTargets {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  calories: number;
}

interface PhaseNutrition {
  id: string;
  phase_index: number;
  phase_title: string;
  phase_type: string;
  training_context?: {
    phase_weeks?: number;
    programme_name?: string;
    programme_goal?: string;
  } | null;
  recommendations: {
    daily_targets?: Partial<DailyTargets>;
    strategy?: string;
    client_summary?: string;
  } | null;
}

const DEFAULT_TARGETS: DailyTargets = {
  protein_g: 150,
  carbs_g: 200,
  fat_g: 65,
  fibre_g: 30,
  calories: 2000,
};

const MEAL_ORDER = ['breakfast', 'snack', 'lunch', 'dinner'] as const;
type MealSlot = typeof MEAL_ORDER[number];

const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  snack: 'Snack',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getWeekDays(referenceDate: Date): Date[] {
  const day = referenceDate.getDay();
  const monday = addDays(referenceDate, -(day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();
}

function formatDayNum(date: Date): string {
  return date.getDate().toString();
}

function getTotalWeight(items: FoodItem[]): number {
  return items.reduce((s, item) => s + (item.weight_g ?? 0), 0);
}

interface MacroBarProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  color: string;
}

function MacroBar({ label, current, target, unit, color }: MacroBarProps) {
  const pct = Math.min(100, target > 0 ? Math.round((current / target) * 100) : 0);
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-[0.65rem] uppercase tracking-[0.1em] text-black/40 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-black/8 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-20 text-right text-xs tabular-nums text-black/60 shrink-0">
        <span className="font-medium text-black">{current}</span>
        <span className="text-black/35"> / {target}{unit}</span>
      </span>
    </div>
  );
}

// --- Draggable food card ---

interface FoodCardProps {
  log: NutritionLog;
  isDragging?: boolean;
  onEdit: (log: NutritionLog) => void;
  onDelete: (log: NutritionLog) => void;
  deletingId: string | null;
}

function FoodCardInner({ log, isDragging, onEdit, onDelete, deletingId }: FoodCardProps) {
  const totalWeight = getTotalWeight(log.food_items);

  return (
    <div
      className={`px-4 py-3 transition-opacity ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <div className="mt-0.5 cursor-grab active:cursor-grabbing text-black/20 hover:text-black/40 transition-colors shrink-0">
          <GripVertical className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onEdit(log)}
            className="w-full text-left"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{log.meal_description}</p>
                {log.food_items && log.food_items.length > 0 && (
                  <p className="mt-0.5 text-[0.65rem] text-black/35 truncate">
                    {log.food_items.map((f) => `${f.name}${f.quantity ? ` ${f.quantity}${f.unit}` : ''}`).join(', ')}
                  </p>
                )}
                {totalWeight > 0 && (
                  <p className="mt-0.5 text-[0.6rem] text-black/25">~{totalWeight}g estimated</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {log.calories != null && (
                  <p className="text-xs font-medium tabular-nums">{log.calories} kcal</p>
                )}
                <p className="text-[0.6rem] text-black/35 tabular-nums">
                  {[
                    log.protein_g != null ? `${log.protein_g}g P` : null,
                    log.carbs_g != null ? `${log.carbs_g}g C` : null,
                    log.fat_g != null ? `${log.fat_g}g F` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
                {log.fibre_g != null && (
                  <p className="text-[0.6rem] text-black/30 tabular-nums">{log.fibre_g}g fibre</p>
                )}
              </div>
            </div>
          </button>

          <div className="mt-1.5 flex items-center justify-between">
            <p className="text-[0.55rem] text-black/20">
              {new Date(log.logged_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              {log.input_type === 'photo' ? ' · photo' : log.input_type === 'voice' ? ' · voice' : ''}
            </p>
            <button
              type="button"
              onClick={() => onDelete(log)}
              disabled={deletingId === log.id}
              className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-black/30 transition-colors hover:text-red-400 disabled:opacity-30"
            >
              {deletingId === log.id ? '…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DraggableFoodCard({
  log,
  onEdit,
  onDelete,
  deletingId,
}: Omit<FoodCardProps, 'isDragging'>) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: log.id,
    data: { log },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ touchAction: 'none' }}
    >
      <FoodCardInner
        log={log}
        isDragging={isDragging}
        onEdit={onEdit}
        onDelete={onDelete}
        deletingId={deletingId}
      />
    </div>
  );
}

// --- Droppable meal section ---

interface MealSectionProps {
  slot: MealSlot;
  items: NutritionLog[];
  isOver: boolean;
  onEdit: (log: NutritionLog) => void;
  onDelete: (log: NutritionLog) => void;
  deletingId: string | null;
}

function MealSection({ slot, items, isOver, onEdit, onDelete, deletingId }: MealSectionProps) {
  const { setNodeRef } = useDroppable({ id: slot });

  return (
    <div
      ref={setNodeRef}
      className={`border transition-colors ${
        isOver ? 'border-black/40 bg-black/3' : 'border-black/10 bg-white'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/6">
        <p className="text-[0.65rem] uppercase tracking-[0.14em] text-black/50 font-medium">
          {MEAL_LABELS[slot]}
        </p>
        {items.length > 0 && (
          <p className="text-[0.6rem] text-black/30 tabular-nums">
            {Math.round(items.reduce((s, l) => s + (l.calories ?? 0), 0))} kcal
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className={`px-4 py-3 text-xs transition-colors ${isOver ? 'text-black/40' : 'text-black/25'}`}>
          {isOver ? 'Drop here' : 'Nothing logged yet'}
        </p>
      ) : (
        <div className="divide-y divide-black/5">
          {items.map((log) => (
            <DraggableFoodCard
              key={log.id}
              log={log}
              onEdit={onEdit}
              onDelete={onDelete}
              deletingId={deletingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Edit macro sheet ---

interface EditSheetProps {
  log: NutritionLog;
  onSave: (updated: Partial<NutritionLog> & { id: string }) => Promise<void>;
  onClose: () => void;
}

function EditSheet({ log, onSave, onClose }: EditSheetProps) {
  const origWeight = getTotalWeight(log.food_items);

  const [protein, setProtein] = useState(String(log.protein_g ?? ''));
  const [carbs, setCarbs] = useState(String(log.carbs_g ?? ''));
  const [fat, setFat] = useState(String(log.fat_g ?? ''));
  const [fibre, setFibre] = useState(String(log.fibre_g ?? ''));
  const [calories, setCalories] = useState(String(log.calories ?? ''));
  const [weight, setWeight] = useState(origWeight > 0 ? String(origWeight) : '');
  const [meal, setMeal] = useState<MealSlot>((log.meal_type as MealSlot) ?? 'dinner');
  const [saving, setSaving] = useState(false);
  const prevWeightRef = useRef(origWeight);

  // Lock background scroll while sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleWeightChange = (val: string) => {
    setWeight(val);
    const newW = parseFloat(val);
    const prevW = prevWeightRef.current;
    if (!isNaN(newW) && newW > 0 && prevW > 0) {
      const scale = newW / prevW;
      if (log.protein_g != null) setProtein(String(Math.round(log.protein_g * scale)));
      if (log.carbs_g != null) setCarbs(String(Math.round(log.carbs_g * scale)));
      if (log.fat_g != null) setFat(String(Math.round(log.fat_g * scale)));
      if (log.fibre_g != null) setFibre(String(Math.round(log.fibre_g * scale)));
      if (log.calories != null) setCalories(String(Math.round(log.calories * scale)));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const newW = parseFloat(weight);
    const updatedFoodItems = origWeight > 0 && !isNaN(newW) && newW > 0 && newW !== origWeight
      ? log.food_items.map((item) => ({
          ...item,
          weight_g: item.weight_g != null
            ? Math.round(item.weight_g * (newW / origWeight))
            : item.weight_g,
        }))
      : log.food_items;

    await onSave({
      id: log.id,
      meal_type: meal,
      protein_g: protein !== '' ? parseFloat(protein) : null,
      carbs_g: carbs !== '' ? parseFloat(carbs) : null,
      fat_g: fat !== '' ? parseFloat(fat) : null,
      fibre_g: fibre !== '' ? parseFloat(fibre) : null,
      calories: calories !== '' ? parseFloat(calories) : null,
      food_items: updatedFoodItems,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative bg-white rounded-t-3xl px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5 max-h-[85vh] overflow-y-auto overscroll-contain"
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium">Edit entry</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 text-black/40 hover:text-black transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-[0.65rem] text-black/40 mb-3 truncate">{log.meal_description}</p>

        {/* Move to meal */}
        <div className="mb-5">
          <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35 mb-2">Move to meal</p>
          <div className="grid grid-cols-2 gap-2">
            {MEAL_ORDER.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setMeal(slot)}
                className={`py-2.5 text-[0.65rem] font-medium uppercase tracking-[0.08em] border transition-colors ${
                  meal === slot
                    ? 'border-black bg-black text-white'
                    : 'border-black/10 text-black/50 hover:border-black/30'
                }`}
              >
                {MEAL_LABELS[slot]}
              </button>
            ))}
          </div>
        </div>

        {/* Weight (if available) */}
        {origWeight > 0 && (
          <div className="mb-4">
            <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35 mb-2">
              Estimated weight (g) - adjusts macros proportionally
            </p>
            <input
              type="number"
              value={weight}
              onChange={(e) => handleWeightChange(e.target.value)}
              placeholder="0"
              className="w-full border border-black/15 px-3 py-2.5 text-sm outline-none focus:border-black/40 transition-colors"
            />
          </div>
        )}

        {/* Macros */}
        <div className="mb-5">
          <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35 mb-2">Macros</p>
          <div className="space-y-2.5">
            {[
              { label: 'Protein (g)', value: protein, set: setProtein },
              { label: 'Carbs (g)', value: carbs, set: setCarbs },
              { label: 'Fat (g)', value: fat, set: setFat },
              { label: 'Fibre (g)', value: fibre, set: setFibre },
              { label: 'Calories (kcal)', value: calories, set: setCalories },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-28 text-[0.65rem] text-black/45 shrink-0">{label}</span>
                <input
                  type="number"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder="—"
                  className="flex-1 border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40 transition-colors text-right tabular-nums"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="w-full bg-black text-white py-3.5 text-sm font-medium transition-opacity disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// --- Deleted entry ---

interface DeletedEntry {
  log: NutritionLog;
  undoExpiresAt: number;
}

interface Props {
  clientId: string;
}

export default function NutritionTab({ clientId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [targets, setTargets] = useState<DailyTargets>(DEFAULT_TARGETS);
  const [phaseNutrition, setPhaseNutrition] = useState<PhaseNutrition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showNextMeal, setShowNextMeal] = useState(false);
  const [showRecipeBook, setShowRecipeBook] = useState(false);
  const [nutritionJourneyExpanded, setNutritionJourneyExpanded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedEntries, setDeletedEntries] = useState<DeletedEntry[]>([]);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<NutritionLog | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<MealSlot | null>(null);

  const weekDays = useMemo(() => {
    const base = addDays(new Date(), weekOffset * 7);
    return getWeekDays(base);
  }, [weekOffset]);

  // DnD sensors: hold 200ms on touch to distinguish from scroll
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('pt_client_nutrition_doc')
        .select('daily_targets')
        .eq('client_id', clientId)
        .single();
      if (data?.daily_targets) {
        setTargets({ ...DEFAULT_TARGETS, ...(data.daily_targets as Partial<DailyTargets>) });
      }
      const { data: phases } = await supabase
        .from('pt_phase_nutrition')
        .select('id, phase_index, phase_title, phase_type, training_context, recommendations')
        .eq('client_id', clientId)
        .eq('review_status', 'approved')
        .order('phase_index', { ascending: true });
      setPhaseNutrition((phases ?? []) as PhaseNutrition[]);
    })();
  }, [clientId, supabase]);

  const loadLogs = useCallback(async (date: Date) => {
    setLoading(true);
    const { data } = await supabase
      .from('pt_nutrition_logs')
      .select('id, meal_type, meal_description, food_items, protein_g, carbs_g, fat_g, fibre_g, calories, input_type, logged_at')
      .eq('client_id', clientId)
      .gte('logged_at', startOfDay(date).toISOString())
      .lte('logged_at', endOfDay(date).toISOString())
      .order('logged_at', { ascending: true });
    setLogs((data ?? []) as NutritionLog[]);
    setLoading(false);
  }, [clientId, supabase]);

  useEffect(() => {
    void loadLogs(selectedDate);
  }, [loadLogs, selectedDate]);

  const totals = useMemo(() => ({
    protein: Math.round(logs.reduce((s, l) => s + (l.protein_g ?? 0), 0)),
    carbs: Math.round(logs.reduce((s, l) => s + (l.carbs_g ?? 0), 0)),
    fat: Math.round(logs.reduce((s, l) => s + (l.fat_g ?? 0), 0)),
    fibre: Math.round(logs.reduce((s, l) => s + (l.fibre_g ?? 0), 0)),
    calories: Math.round(logs.reduce((s, l) => s + (l.calories ?? 0), 0)),
  }), [logs]);

  const logsByMeal = useMemo(() => {
    const map: Record<MealSlot, NutritionLog[]> = { breakfast: [], snack: [], lunch: [], dinner: [] };
    logs.forEach((log) => {
      const slot = (log.meal_type ?? '').toLowerCase() as MealSlot;
      if (MEAL_ORDER.includes(slot)) map[slot].push(log);
      else map.dinner.push(log);
    });
    return map;
  }, [logs]);

  const activeLog = useMemo(
    () => (activeId ? logs.find((l) => l.id === activeId) ?? null : null),
    [activeId, logs],
  );

  const softDelete = async (log: NutritionLog) => {
    setDeletingId(log.id);
    await supabase.from('pt_nutrition_logs').delete().eq('id', log.id);
    setLogs((prev) => prev.filter((l) => l.id !== log.id));
    setDeletedEntries((prev) => [
      ...prev,
      { log, undoExpiresAt: Date.now() + 10 * 60 * 1000 },
    ]);
    setDeletingId(null);
  };

  const undoDelete = async (entry: DeletedEntry) => {
    setUndoingId(entry.log.id);
    setDeletedEntries((prev) => prev.filter((e) => e.log.id !== entry.log.id));
    const { data } = await supabase
      .from('pt_nutrition_logs')
      .insert({
        client_id: clientId,
        meal_type: entry.log.meal_type,
        meal_description: entry.log.meal_description,
        food_items: entry.log.food_items,
        protein_g: entry.log.protein_g,
        carbs_g: entry.log.carbs_g,
        fat_g: entry.log.fat_g,
        fibre_g: entry.log.fibre_g,
        calories: entry.log.calories,
        input_type: entry.log.input_type,
        logged_at: entry.log.logged_at,
      })
      .select('id, meal_type, meal_description, food_items, protein_g, carbs_g, fat_g, fibre_g, calories, input_type, logged_at')
      .single();
    if (data) {
      setLogs((prev) =>
        [...prev, data as NutritionLog].sort(
          (a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime(),
        ),
      );
    }
    setUndoingId(null);
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
  };

  const handleDragOver = ({ over }: { over: DragEndEvent['over'] }) => {
    setOverId(over ? (String(over.id) as MealSlot) : null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    setOverId(null);
    if (!over) return;

    const logId = String(active.id);
    const newMeal = String(over.id) as MealSlot;
    const log = logs.find((l) => l.id === logId);
    if (!log || log.meal_type === newMeal) return;

    // Optimistic update
    setLogs((prev) =>
      prev.map((l) => (l.id === logId ? { ...l, meal_type: newMeal } : l)),
    );

    await supabase
      .from('pt_nutrition_logs')
      .update({ meal_type: newMeal })
      .eq('id', logId);
  };

  const handleSaveEdit = async (updated: Partial<NutritionLog> & { id: string }) => {
    const { id, ...fields } = updated;
    // Optimistic update
    setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)));
    setEditingLog(null);

    await supabase
      .from('pt_nutrition_logs')
      .update(fields)
      .eq('id', id);
  };

  useEffect(() => {
    if (deletedEntries.length === 0) return;
    const nearest = Math.min(...deletedEntries.map((e) => e.undoExpiresAt));
    const delay = Math.max(0, nearest - Date.now());
    const timer = setTimeout(() => {
      setDeletedEntries((prev) => prev.filter((e) => e.undoExpiresAt > Date.now()));
    }, delay + 100);
    return () => clearTimeout(timer);
  }, [deletedEntries]);

  const today = new Date();
  const canGoForward = weekOffset < 0;
  const nutritionJourneyGoal = useMemo(() => {
    const phase = phaseNutrition[0];
    const summary = phase?.recommendations?.client_summary?.trim()
      || phase?.recommendations?.strategy?.trim()
      || 'Stay consistent with the current nutrition targets.';
    return summary.replace(/\s+/g, ' ');
  }, [phaseNutrition]);
  const nutritionJourneyWeeks = useMemo(
    () => phaseNutrition.reduce((total, phase) => total + (phase.training_context?.phase_weeks ?? 0), 0),
    [phaseNutrition],
  );

  const handleDaySelect = (date: Date) => {
    if (date > today) return;
    setSelectedDate(date);
  };

  const prevWeek = () => {
    setWeekOffset((w) => w - 1);
    const newRef = addDays(weekDays[0], -7);
    const newWeek = getWeekDays(newRef);
    const last = newWeek[newWeek.length - 1];
    setSelectedDate(last > today ? today : last);
  };

  const nextWeek = () => {
    if (weekOffset >= 0) return;
    setWeekOffset((w) => w + 1);
    const newRef = addDays(weekDays[0], 7);
    const newWeek = getWeekDays(newRef);
    const d = newWeek.find((dd) => isSameDay(dd, today)) ?? newWeek[0];
    setSelectedDate(d);
  };

  return (
    <div className="space-y-4">
      {/* Macro overview */}
      <div className="mx-auto max-w-5xl border border-black/10 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">
            {isSameDay(selectedDate, today) ? "Today's Macros" : selectedDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}
          </p>
          <span className="text-xs font-medium tabular-nums">{totals.calories} <span className="text-black/35 font-normal">/ {targets.calories} kcal</span></span>
        </div>
        <div className="space-y-3">
          <MacroBar label="Protein" current={totals.protein} target={targets.protein_g} unit="g" color="#1a1a1a" />
          <MacroBar label="Carbs" current={totals.carbs} target={targets.carbs_g} unit="g" color="#555" />
          <MacroBar label="Fat" current={totals.fat} target={targets.fat_g} unit="g" color="#888" />
          <MacroBar label="Fibre" current={totals.fibre} target={targets.fibre_g} unit="g" color="#bbb" />
        </div>
        {logs.length > 0 && (
          <p className="mt-3 text-[0.6rem] text-black/30">{logs.length} meal{logs.length !== 1 ? 's' : ''} logged</p>
        )}
      </div>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setShowLogModal(true)}
          className="group flex items-start gap-3 border border-black/10 bg-white px-5 py-4 text-left transition-colors hover:border-black/25"
        >
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-black/45">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="7.5" y="1.5" width="7" height="11" rx="3.5" /><path d="M3.5 11a7.5 7.5 0 0015 0M11 18.5v2" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Track your food</span>
            <span className="mt-0.5 block text-[0.65rem] text-black/35">Voice, photo, or type — AI splits it into meals</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setShowNextMeal(true)}
          className="group flex items-start gap-3 border border-black/10 bg-white px-5 py-4 text-left transition-colors hover:border-black/25"
        >
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-black/45">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 7h3l2-2.5h9L18 7h2v11.5H2V7z" /><circle cx="11" cy="13" r="3" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Help me with my next meal</span>
            <span className="mt-0.5 block text-[0.65rem] text-black/35">Snap your fridge — AI suggests a meal that fits your macros</span>
          </span>
        </button>
      </div>

      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => setShowRecipeBook(true)}
          className="group flex w-full items-center justify-center gap-2 border border-black/10 bg-white px-5 py-2.5 text-[0.7rem] font-medium text-black/50 transition-colors hover:border-black/25 hover:text-black"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 3h10v14l-5-3-5 3V3z" /></svg>
          Recipe book
        </button>
      </div>

      {/* Day selector */}
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevWeek}
            className="flex h-10 w-10 items-center justify-center text-black/30 hover:text-black transition-colors shrink-0"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex flex-1 gap-1">
            {weekDays.map((day) => {
              const isFuture = day > today;
              const isSelected = isSameDay(day, selectedDate);
              const isToday = isSameDay(day, today);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => handleDaySelect(day)}
                  disabled={isFuture}
                  className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-center transition-colors border ${
                    isSelected
                      ? 'border-black bg-black text-white'
                      : isToday
                        ? 'border-black/30 text-black'
                        : isFuture
                          ? 'border-transparent text-black/15 cursor-not-allowed'
                          : 'border-transparent text-black/40 hover:border-black/10 hover:text-black'
                  }`}
                >
                  <span className="text-[0.55rem] uppercase tracking-[0.08em]">{formatDayLabel(day)}</span>
                  <span className="text-sm font-medium leading-none">{formatDayNum(day)}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={nextWeek}
            disabled={!canGoForward}
            className="flex h-10 w-10 items-center justify-center text-black/30 hover:text-black transition-colors disabled:opacity-20 shrink-0"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Drag hint */}
      {logs.length > 0 && (
        <div className="mx-auto max-w-5xl">
          <p className="text-[0.6rem] text-black/25 text-center">
            Hold and drag any entry to move it to a different meal
          </p>
        </div>
      )}

      {/* Meals with DnD */}
      <div className="mx-auto max-w-5xl space-y-3">
        {loading ? (
          <p className="text-center text-sm text-black/30 py-8">Loading...</p>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            {MEAL_ORDER.map((slot) => (
              <MealSection
                key={slot}
                slot={slot}
                items={logsByMeal[slot]}
                isOver={overId === slot}
                onEdit={setEditingLog}
                onDelete={(log) => void softDelete(log)}
                deletingId={deletingId}
              />
            ))}

            <DragOverlay dropAnimation={null}>
              {activeLog ? (
                <div className="border border-black/20 bg-white shadow-lg opacity-95">
                  <FoodCardInner
                    log={activeLog}
                    isDragging={false}
                    onEdit={() => undefined}
                    onDelete={() => undefined}
                    deletingId={null}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {/* Recently deleted — undo within 10 min */}
        {deletedEntries.length > 0 && (
          <div className="border border-black/10 bg-white">
            <div className="flex items-center justify-between border-b border-black/6 px-4 py-3">
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-black/40">Recently deleted</p>
              <p className="text-[0.6rem] text-black/25">Restores within 10 min</p>
            </div>
            <div className="divide-y divide-black/5">
              {deletedEntries.map((entry) => (
                <div key={entry.log.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-black/45">{entry.log.meal_description}</p>
                    {entry.log.calories != null && (
                      <p className="mt-0.5 text-[0.6rem] text-black/25 tabular-nums">{entry.log.calories} kcal</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void undoDelete(entry)}
                    disabled={undoingId === entry.log.id}
                    className="shrink-0 text-[0.6rem] font-medium uppercase tracking-[0.1em] text-black/50 transition-colors hover:text-black disabled:opacity-30"
                  >
                    {undoingId === entry.log.id ? '…' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {phaseNutrition.length > 0 && (
        <div className="mx-auto max-w-5xl border border-black/10 bg-white">
        <button
          type="button"
          onClick={() => setNutritionJourneyExpanded((value) => !value)}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[#fcfcfa]"
        >
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35">
              Nutrition journey{nutritionJourneyWeeks > 0 ? ` · ${nutritionJourneyWeeks} week plan` : ''}
            </p>
            <p className="mt-1 line-clamp-1 text-sm font-medium leading-relaxed text-black/60">
              {nutritionJourneyGoal}
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-black/25 transition-transform ${nutritionJourneyExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {nutritionJourneyExpanded && (
          <div className="border-t border-black/10 px-5 pb-5 pt-4">
            {nutritionJourneyGoal && (
              <p className="mb-4 text-sm leading-relaxed text-black/70">{nutritionJourneyGoal}</p>
            )}
            <div className="relative">
              <div className="absolute bottom-3 left-[0.6rem] top-3 w-px bg-black/8" />
              <div className="space-y-1">
                {phaseNutrition.map((phase) => {
                  const phaseTargets = phase.recommendations?.daily_targets;
                  const phaseWeeks = phase.training_context?.phase_weeks ?? null;
                  return (
                    <div key={phase.id} className="flex gap-4 py-3">
                      <div className="relative z-10 flex w-5 shrink-0 justify-center pt-0.5">
                        <div className="h-3.5 w-3.5 rounded-full border border-black/15 bg-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <p className="text-sm font-medium leading-snug text-black">{phase.phase_title}</p>
                          {phaseWeeks ? (
                            <span className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">
                              {phaseWeeks} weeks
                            </span>
                          ) : null}
                          {phaseTargets?.calories ? (
                            <span className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">
                              {phaseTargets.calories} kcal
                            </span>
                          ) : null}
                        </div>
                        {phase.recommendations?.strategy && (
                          <p className="mt-1 text-xs leading-relaxed text-black/50">{phase.recommendations.strategy}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {editingLog && (
        <EditSheet
          log={editingLog}
          onSave={handleSaveEdit}
          onClose={() => setEditingLog(null)}
        />
      )}

      {showLogModal && (
        <NutritionChatModal
          clientId={clientId}
          onClose={() => setShowLogModal(false)}
          onLogged={() => void loadLogs(selectedDate)}
        />
      )}

      {showNextMeal && (
        <NextMealModal
          clientId={clientId}
          onClose={() => setShowNextMeal(false)}
          onLogged={() => void loadLogs(selectedDate)}
        />
      )}

      {showRecipeBook && (
        <RecipeBookModal
          clientId={clientId}
          onClose={() => setShowRecipeBook(false)}
          onLogged={() => void loadLogs(selectedDate)}
          onStartFlow={() => { setShowRecipeBook(false); setShowNextMeal(true); }}
        />
      )}
    </div>
  );
}
