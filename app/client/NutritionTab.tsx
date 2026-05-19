'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import NutritionChatModal from './NutritionChatModal';

interface NutritionLog {
  id: string;
  meal_type: string | null;
  meal_description: string;
  food_items: Array<{ name: string; quantity: string; unit: string }>;
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
  const [loading, setLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedEntries, setDeletedEntries] = useState<DeletedEntry[]>([]);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    const base = addDays(new Date(), weekOffset * 7);
    return getWeekDays(base);
  }, [weekOffset]);

  // Load targets once
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

  // Expire undo entries after 10 minutes
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

      {/* Track food CTA */}
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => setShowLogModal(true)}
          className="group flex w-full items-center justify-between border border-black/10 bg-white px-5 py-4 text-left transition-colors hover:border-black/25"
        >
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Log food</p>
            <p className="mt-0.5 text-sm font-medium">Track your food here</p>
            <p className="mt-0.5 text-[0.65rem] text-black/35">Voice dump, photos, or type — AI splits it into meals</p>
          </div>
          <svg
            width="20" height="20" viewBox="0 0 20 20" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            className="shrink-0 text-black/25 transition-transform group-hover:translate-x-0.5"
          >
            <path d="M7 10h6M10 7l3 3-3 3" />
          </svg>
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

      {/* Meals */}
      <div className="mx-auto max-w-5xl space-y-3">
        {loading ? (
          <p className="text-center text-sm text-black/30 py-8">Loading...</p>
        ) : (
          MEAL_ORDER.map((slot) => {
            const items = logsByMeal[slot];
            return (
              <div key={slot} className="border border-black/10 bg-white">
                <div className="flex items-center justify-between px-4 py-3 border-b border-black/6">
                  <p className="text-[0.65rem] uppercase tracking-[0.14em] text-black/50 font-medium">{MEAL_LABELS[slot]}</p>
                  {items.length > 0 && (
                    <p className="text-[0.6rem] text-black/30 tabular-nums">
                      {Math.round(items.reduce((s, l) => s + (l.calories ?? 0), 0))} kcal
                    </p>
                  )}
                </div>
                {items.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-black/25">Nothing logged yet</p>
                ) : (
                  <div className="divide-y divide-black/5">
                    {items.map((log) => (
                      <div key={log.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-snug">{log.meal_description}</p>
                            {log.food_items && log.food_items.length > 0 && (
                              <p className="mt-0.5 text-[0.65rem] text-black/35 truncate">
                                {log.food_items.map((f) => `${f.name}${f.quantity ? ` ${f.quantity}${f.unit}` : ''}`).join(', ')}
                              </p>
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
                        <div className="mt-1.5 flex items-center justify-between">
                          <p className="text-[0.55rem] text-black/20">
                            {new Date(log.logged_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                            {log.input_type === 'photo' ? ' · photo' : log.input_type === 'voice' ? ' · voice' : ''}
                          </p>
                          <button
                            type="button"
                            onClick={() => void softDelete(log)}
                            disabled={deletingId === log.id}
                            className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-black/30 transition-colors hover:text-red-400 disabled:opacity-30"
                            aria-label="Delete entry"
                          >
                            {deletingId === log.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
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

      {showLogModal && (
        <NutritionChatModal
          clientId={clientId}
          onClose={() => setShowLogModal(false)}
          onLogged={() => void loadLogs(selectedDate)}
        />
      )}
    </div>
  );
}
