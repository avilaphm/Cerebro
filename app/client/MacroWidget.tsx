'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

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

interface MacroState {
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  calories: number;
}

interface Props {
  clientId: string;
  onNutritionTabOpen?: () => void;
}

export default function MacroWidget({ clientId, onNutritionTabOpen }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [totals, setTotals] = useState<MacroState>({ protein: 0, carbs: 0, fat: 0, fibre: 0, calories: 0 });
  const [targets, setTargets] = useState<DailyTargets>(DEFAULT_TARGETS);

  useEffect(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    void Promise.all([
      supabase
        .from('pt_nutrition_logs')
        .select('protein_g, carbs_g, fat_g, fibre_g, calories')
        .eq('client_id', clientId)
        .gte('logged_at', start.toISOString())
        .lte('logged_at', end.toISOString()),
      supabase
        .from('pt_client_nutrition_doc')
        .select('daily_targets')
        .eq('client_id', clientId)
        .single(),
    ]).then(([logsRes, targetRes]) => {
      const logs = (logsRes.data ?? []) as Array<{
        protein_g: number | null; carbs_g: number | null;
        fat_g: number | null; fibre_g: number | null; calories: number | null;
      }>;
      setTotals({
        protein: Math.round(logs.reduce((s, l) => s + (l.protein_g ?? 0), 0)),
        carbs: Math.round(logs.reduce((s, l) => s + (l.carbs_g ?? 0), 0)),
        fat: Math.round(logs.reduce((s, l) => s + (l.fat_g ?? 0), 0)),
        fibre: Math.round(logs.reduce((s, l) => s + (l.fibre_g ?? 0), 0)),
        calories: Math.round(logs.reduce((s, l) => s + (l.calories ?? 0), 0)),
      });
      if (targetRes.data?.daily_targets) {
        setTargets({ ...DEFAULT_TARGETS, ...(targetRes.data.daily_targets as Partial<DailyTargets>) });
      }
    });
  }, [clientId, supabase]);

  const macros = [
    { key: 'protein', label: 'Protein', current: totals.protein, target: targets.protein_g, unit: 'g' },
    { key: 'carbs', label: 'Carbs', current: totals.carbs, target: targets.carbs_g, unit: 'g' },
    { key: 'fat', label: 'Fat', current: totals.fat, target: targets.fat_g, unit: 'g' },
    { key: 'fibre', label: 'Fibre', current: totals.fibre, target: targets.fibre_g, unit: 'g' },
  ];

  return (
    <button
      type="button"
      onClick={onNutritionTabOpen}
      className="w-full border border-black/10 bg-white p-4 text-left hover:border-black/20 transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Today&apos;s Nutrition</p>
        <span className="text-xs tabular-nums">
          <span className="font-medium">{totals.calories}</span>
          <span className="text-black/35"> / {targets.calories} kcal</span>
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {macros.map(({ key, label, current, target, unit }) => {
          const pct = Math.min(100, target > 0 ? Math.round((current / target) * 100) : 0);
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="h-1 bg-black/8 rounded-full overflow-hidden">
                <div className="h-full bg-black rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[0.6rem] text-black/40">{label}</p>
              <p className="text-xs tabular-nums">
                <span className="font-medium">{current}</span>
                <span className="text-black/30">/{target}{unit}</span>
              </p>
            </div>
          );
        })}
      </div>
    </button>
  );
}
