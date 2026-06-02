'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import {
  macroCalories,
  normalizeNutritionTargets,
  rebalanceNutritionTargets,
  type NutritionTargets,
} from '@/utils/pt/nutritionTargets';

interface Props {
  clientId: string;
  initialTargets: Partial<NutritionTargets> | null;
  onSaved: (targets: NutritionTargets) => void;
}

const INPUT_LIMITS = {
  calories: { min: 1200, max: 5000, label: 'Calories' },
  protein_g: { min: 60, max: 300, label: 'Protein' },
} as const;

export default function NutritionTargetEditor({ clientId, initialTargets, onSaved }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const initial = normalizeNutritionTargets(initialTargets);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [caloriesInput, setCaloriesInput] = useState(String(initial.calories));
  const [proteinInput, setProteinInput] = useState(String(initial.protein_g));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    const next = normalizeNutritionTargets(initialTargets);
    setDraft(next);
    setCaloriesInput(String(next.calories));
    setProteinInput(String(next.protein_g));
    setError(null);
    setSaved(false);
  };

  const applyEdit = (field: 'calories' | 'protein_g', value: string) => {
    if (field === 'calories') setCaloriesInput(value);
    else setProteinInput(value);
    setSaved(false);

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      setError('Enter a valid positive number.');
      return;
    }
    const limits = INPUT_LIMITS[field];
    if (numericValue < limits.min || numericValue > limits.max) {
      setError(`${limits.label} must be between ${limits.min} and ${limits.max}.`);
      return;
    }

    const result = rebalanceNutritionTargets(draft, { field, value: numericValue });
    setError(result.error);
    if (result.error) return;
    setDraft(result.targets);
    setCaloriesInput(String(result.targets.calories));
    setProteinInput(String(result.targets.protein_g));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const { data, error: updateError } = await supabase
      .from('pt_client_nutrition_doc')
      .update({ daily_targets: draft, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .select('daily_targets')
      .single();

    setSaving(false);
    if (updateError || !data?.daily_targets) {
      setError(updateError?.message ?? 'Nutrition targets could not be saved.');
      return;
    }

    const next = normalizeNutritionTargets(data.daily_targets as Partial<NutritionTargets>);
    setDraft(next);
    setCaloriesInput(String(next.calories));
    setProteinInput(String(next.protein_g));
    setSaved(true);
    onSaved(next);
    router.refresh();
  };

  return (
    <div className="mt-4 border border-black/10 bg-[#fbfbf8]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-black/[0.025]"
        onClick={() => {
          if (open) reset();
          setOpen((current) => !current);
        }}
      >
        <span>
          <span className="block text-[0.58rem] uppercase tracking-[0.14em] text-black/35">Coach controls</span>
          <span className="mt-1 block text-sm font-medium text-black/70">Edit daily nutrition targets</span>
        </span>
        <span className="text-xs text-black/35">{open ? 'Close' : 'Edit'}</span>
      </button>

      {open && (
        <div className="border-t border-black/8 px-3 py-3">
          <p className="text-xs leading-relaxed text-black/45">
            Calories rebalance the full macro split. Protein changes keep calories fixed and rebalance carbs and fat.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Calories</span>
              <input
                className="mt-1 w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
                inputMode="numeric"
                min="1200"
                max="5000"
                onChange={(event) => applyEdit('calories', event.target.value)}
                type="number"
                value={caloriesInput}
              />
            </label>
            <label className="block">
              <span className="block text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Protein</span>
              <div className="relative mt-1">
                <input
                  className="w-full border border-black/10 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-black/40"
                  inputMode="numeric"
                  min="60"
                  max="300"
                  onChange={(event) => applyEdit('protein_g', event.target.value)}
                  type="number"
                  value={proteinInput}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-black/35">g</span>
              </div>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: 'Calories', value: `${draft.calories} kcal` },
              { label: 'Protein', value: `${draft.protein_g}g` },
              { label: 'Carbs', value: `${draft.carbs_g}g` },
              { label: 'Fat', value: `${draft.fat_g}g` },
              { label: 'Fibre', value: `${draft.fibre_g}g` },
            ].map((item) => (
              <div key={item.label} className="border border-black/8 bg-white px-2 py-2">
                <p className="text-[0.55rem] uppercase tracking-[0.1em] text-black/30">{item.label}</p>
                <p className="mt-1 text-xs font-medium text-black/65">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[0.62rem] text-black/35">Macro split: {macroCalories(draft)} kcal after gram rounding.</p>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          {saved && <p className="mt-3 text-xs text-green-700">Targets saved.</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="border border-black/20 px-3 py-1.5 text-xs text-black/55 transition-colors hover:border-black hover:text-black"
              onClick={reset}
            >
              Reset
            </button>
            <button
              type="button"
              className="border border-black bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40"
              disabled={saving || Boolean(error)}
              onClick={() => void save()}
            >
              {saving ? 'Saving...' : 'Save targets'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
