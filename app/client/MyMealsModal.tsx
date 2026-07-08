'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface DisplayMeal {
  key: string;
  name: string;
  description: string | null;
  mealType: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  prep: number | null;
  why: string | null;
  ingredients: { name: string; quantity: string }[];
  steps: string[];
}

interface RecipeRow {
  id: string;
  name: string;
  description: string | null;
  meal_type: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  prep_time: number | null;
  ingredients: { name: string; quantity: string }[];
  steps: string[];
  created_at: string;
}

interface SessionMeal {
  name: string;
  description?: string;
  whyThisOne?: string;
  prepTimeMinutes?: number | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  ingredients?: { name: string; quantity: string }[];
  steps?: string[];
}

interface SessionRow {
  id: string;
  meal_type: string | null;
  ingredients: string[];
  craving: string | null;
  meals: SessionMeal[];
  created_at: string;
}

const MEAL_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

function recipeToDisplay(r: RecipeRow): DisplayMeal {
  return {
    key: r.id, name: r.name, description: r.description, mealType: r.meal_type,
    calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
    prep: r.prep_time, why: null,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    steps: Array.isArray(r.steps) ? r.steps : [],
  };
}

function sessionMealToDisplay(m: SessionMeal, mealType: string | null, key: string): DisplayMeal {
  return {
    key, name: m.name, description: m.description ?? null, mealType,
    calories: m.calories ?? null, protein: m.protein ?? null, carbs: m.carbs ?? null, fat: m.fat ?? null,
    prep: m.prepTimeMinutes ?? null, why: m.whyThisOne ?? null,
    ingredients: Array.isArray(m.ingredients) ? m.ingredients : [],
    steps: Array.isArray(m.steps) ? m.steps : [],
  };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

interface MealRowProps {
  dm: DisplayMeal;
  expanded: boolean;
  onToggle: () => void;
  footer: React.ReactNode;
}

function MealRow({ dm, expanded, onToggle, footer }: MealRowProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="w-full px-4 py-3.5 text-left">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium leading-snug">{dm.name}</p>
          {dm.calories != null && <span className="shrink-0 text-xs font-medium tabular-nums">{dm.calories} kcal</span>}
        </div>
        {dm.description && <p className="mt-1 text-[0.7rem] leading-relaxed text-black/45">{dm.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.62rem] tabular-nums text-black/40">
          {dm.mealType && <span className="uppercase tracking-[0.08em] text-black/35">{dm.mealType}</span>}
          {dm.protein != null && <span>{dm.protein}g P</span>}
          {dm.carbs != null && <span>{dm.carbs}g C</span>}
          {dm.fat != null && <span>{dm.fat}g F</span>}
          {dm.prep != null && <span className="text-black/35">&middot; {dm.prep} min</span>}
        </div>
        {dm.why && <p className="mt-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[0.66rem] leading-relaxed text-black/55">{dm.why}</p>}
        <p className="mt-1.5 text-[0.58rem] uppercase tracking-[0.1em] text-black/25">{expanded ? 'Hide recipe' : 'Tap for recipe'}</p>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-black/8 px-4 py-3">
          {dm.ingredients.length > 0 && (
            <div>
              <p className="mb-1 text-[0.56rem] font-medium uppercase tracking-[0.14em] text-black/35">Ingredients</p>
              <ul className="space-y-0.5">
                {dm.ingredients.map((ing, k) => (
                  <li key={k} className="text-[0.72rem] text-black/60">{ing.name}{ing.quantity ? ` · ${ing.quantity}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          {dm.steps.length > 0 && (
            <div>
              <p className="mb-1 text-[0.56rem] font-medium uppercase tracking-[0.14em] text-black/35">Steps</p>
              <ol className="space-y-1">
                {dm.steps.map((s, k) => (
                  <li key={k} className="flex gap-2 text-[0.72rem] leading-relaxed text-black/60"><span className="text-black/30">{k + 1}.</span><span>{s}</span></li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-black/8 px-3 py-2.5">{footer}</div>
    </div>
  );
}

interface Props {
  clientId: string;
  onClose: () => void;
  onLogged?: () => void;
  onStartFlow?: () => void;
}

export default function MyMealsModal({ clientId, onClose, onLogged, onStartFlow }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<'saved' | 'recent'>('saved');
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const scrollEl = document.querySelector<HTMLElement>('.client-liquid > div');
    if (!scrollEl) return;
    const prev = scrollEl.style.overflowY;
    scrollEl.style.overflowY = 'hidden';
    return () => { scrollEl.style.overflowY = prev; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [recipesRes, sessionsRes] = await Promise.all([
      supabase.from('recipes')
        .select('id, name, description, meal_type, calories, protein, carbs, fat, prep_time, ingredients, steps, created_at')
        .eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase.from('next_meal_sessions')
        .select('id, meal_type, ingredients, craving, meals, created_at')
        .eq('client_id', clientId).order('created_at', { ascending: false }).limit(3),
    ]);
    if (recipesRes.error || sessionsRes.error) setError('Could not load your meals.');
    setRecipes((recipesRes.data ?? []) as RecipeRow[]);
    setSessions(((sessionsRes.data ?? []) as SessionRow[]).filter((s) => Array.isArray(s.meals) && s.meals.length > 0));
    setLoading(false);
  }, [supabase, clientId]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const savedNames = useMemo(() => new Set(recipes.map((r) => (r.name ?? '').toLowerCase())), [recipes]);

  const visibleRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (filter !== 'all' && (r.meal_type ?? '').toLowerCase() !== filter) return false;
      if (!q) return true;
      return [r.name, r.description ?? '', ...(r.ingredients ?? []).map((i) => i.name)].join(' ').toLowerCase().includes(q);
    });
  }, [recipes, query, filter]);

  const logMeal = async (dm: DisplayMeal) => {
    if (busyKey) return;
    setBusyKey(dm.key);
    const { error: insErr } = await supabase.from('pt_nutrition_logs').insert({
      client_id: clientId,
      input_type: 'text',
      meal_type: dm.mealType ?? 'dinner',
      meal_description: dm.name,
      food_items: dm.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: '' })),
      protein_g: dm.protein, carbs_g: dm.carbs, fat_g: dm.fat, calories: dm.calories,
      notes: 'Cooked from My meals.',
    });
    setBusyKey(null);
    if (insErr) { setError('Could not log that. Please try again.'); return; }
    setLoggedKey(dm.key);
    onLogged?.();
    window.setTimeout(() => setLoggedKey((cur) => (cur === dm.key ? null : cur)), 2500);
  };

  const saveMeal = async (dm: DisplayMeal) => {
    if (busyKey || savedNames.has(dm.name.toLowerCase())) return;
    setBusyKey(dm.key);
    const { data, error: insErr } = await supabase.from('recipes').insert({
      client_id: clientId,
      name: dm.name, description: dm.description, meal_type: dm.mealType,
      calories: dm.calories, protein: dm.protein, carbs: dm.carbs, fat: dm.fat, prep_time: dm.prep,
      ingredients: dm.ingredients, steps: dm.steps, source: 'generated',
    }).select('id, name, description, meal_type, calories, protein, carbs, fat, prep_time, ingredients, steps, created_at').single();
    setBusyKey(null);
    if (insErr || !data) { setError('Could not save that recipe. Please try again.'); return; }
    setRecipes((prev) => [data as RecipeRow, ...prev]);
  };

  const removeRecipe = async (id: string) => {
    if (busyKey) return;
    setBusyKey(id);
    const { error: delErr } = await supabase.from('recipes').delete().eq('id', id);
    setBusyKey(null);
    if (delErr) { setError('Could not remove that recipe. Please try again.'); return; }
    setRecipes((prev) => prev.filter((r) => r.id !== id));
  };

  const madeThisBtn = (dm: DisplayMeal) => (
    <button
      type="button"
      onClick={() => void logMeal(dm)}
      disabled={busyKey === dm.key || loggedKey === dm.key}
      className="flex-1 rounded-full bg-black py-2.5 text-[0.72rem] font-medium text-white transition-opacity disabled:opacity-40"
    >
      {loggedKey === dm.key ? 'Logged ✓' : busyKey === dm.key ? '…' : 'I made this'}
    </button>
  );

  const saveBtn = (dm: DisplayMeal) => {
    const isSaved = savedNames.has(dm.name.toLowerCase());
    return (
      <button
        type="button"
        onClick={() => void saveMeal(dm)}
        disabled={busyKey === dm.key || isSaved}
        className={`flex h-9 items-center gap-1.5 rounded-full border px-4 text-[0.72rem] font-medium transition-colors disabled:opacity-100 ${
          isSaved ? 'border-black bg-black text-white' : 'border-black/12 bg-white text-black/55 hover:border-black/30'
        }`}
        aria-label={isSaved ? 'Saved to recipe book' : 'Save to recipe book'}
      >
        <svg width="13" height="13" viewBox="0 0 20 20" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path d="M5 3h10v14l-5-3-5 3V3z" /></svg>
        {isSaved ? 'Saved' : 'Save'}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f0]">
      {/* Header */}
      <div className="flex shrink-0 items-center px-4 pb-3 pt-14">
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white text-black/40 shadow-sm transition-colors hover:text-black" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
        <div className="flex-1 px-3 text-center"><p className="text-sm font-medium leading-tight">My meals</p></div>
        <div className="h-9 w-9 shrink-0" />
      </div>

      {/* Tabs */}
      <div className="shrink-0 px-4 pb-2">
        <div className="mx-auto flex max-w-md gap-1 rounded-full border border-black/10 bg-white p-1">
          {(['saved', 'recent'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setExpandedKey(null); }}
              className={`flex-1 rounded-full py-2 text-[0.72rem] font-medium transition-colors ${tab === t ? 'bg-black text-white' : 'text-black/50 hover:text-black'}`}
            >
              {t === 'saved' ? `Saved${recipes.length ? ` (${recipes.length})` : ''}` : 'Recent'}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
        {loading ? (
          <p className="py-16 text-center text-sm text-black/30">Loading…</p>
        ) : tab === 'saved' ? (
          recipes.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/[0.04] text-black/30">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4h11a2 2 0 012 2v14l-4-2-4 2-4-2V6a2 2 0 012-2z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium">No saved recipes yet</p>
                <p className="mx-auto mt-2 max-w-[17rem] text-[0.72rem] leading-relaxed text-black/45">Get meal ideas from &ldquo;Help me with my next meal&rdquo;, then tap Save on the ones you like.</p>
              </div>
              {onStartFlow && <button type="button" onClick={onStartFlow} className="mt-1 rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90">Find a meal</button>}
            </div>
          ) : (
            <div className="mx-auto max-w-md space-y-3">
              <div className="flex items-center gap-2 border border-black/12 bg-white px-3.5 py-2.5">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-black/30"><circle cx="9" cy="9" r="6" /><path d="M14 14l4 4" /></svg>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recipes or ingredients" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-black/25" />
              </div>
              <div className="flex flex-wrap gap-2">
                {MEAL_FILTERS.map((f) => (
                  <button key={f.value} type="button" onClick={() => setFilter(f.value)} className={`rounded-full border px-3 py-1.5 text-[0.7rem] font-medium transition-colors ${filter === f.value ? 'border-black bg-black text-white' : 'border-black/12 bg-white text-black/55 hover:border-black/30'}`}>{f.label}</button>
                ))}
              </div>
              {error && <p className="px-1 text-[0.7rem] text-red-500">{error}</p>}
              {visibleRecipes.length === 0 ? (
                <p className="py-10 text-center text-[0.75rem] text-black/35">No recipes match that.</p>
              ) : (
                visibleRecipes.map((r) => {
                  const dm = recipeToDisplay(r);
                  return (
                    <MealRow key={dm.key} dm={dm} expanded={expandedKey === dm.key} onToggle={() => setExpandedKey(expandedKey === dm.key ? null : dm.key)}
                      footer={<>
                        {madeThisBtn(dm)}
                        <button type="button" onClick={() => void removeRecipe(r.id)} disabled={busyKey === r.id} className="rounded-full border border-black/12 bg-white px-4 py-2.5 text-[0.72rem] font-medium text-black/45 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-40">
                          {busyKey === r.id ? '…' : 'Remove'}
                        </button>
                      </>}
                    />
                  );
                })
              )}
            </div>
          )
        ) : (
          // RECENT tab
          sessions.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/[0.04] text-black/30">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 8v4l3 2" /><circle cx="12" cy="12" r="9" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium">No recent searches</p>
                <p className="mx-auto mt-2 max-w-[17rem] text-[0.72rem] leading-relaxed text-black/45">Your last few &ldquo;Help me with my next meal&rdquo; searches show up here so you can save any idea later.</p>
              </div>
              {onStartFlow && <button type="button" onClick={onStartFlow} className="mt-1 rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90">Find a meal</button>}
            </div>
          ) : (
            <div className="mx-auto max-w-md space-y-5">
              {error && <p className="px-1 text-[0.7rem] text-red-500">{error}</p>}
              {sessions.map((s) => (
                <div key={s.id}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2 px-1">
                    <p className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/45">{s.meal_type ?? 'meal'}</p>
                    <span className="text-[0.58rem] text-black/30">{relativeTime(s.created_at)}</span>
                    {s.craving ? <span className="text-[0.58rem] text-black/30">&middot; craving &ldquo;{s.craving}&rdquo;</span> : null}
                  </div>
                  <div className="space-y-2">
                    {s.meals.map((m, i) => {
                      const dm = sessionMealToDisplay(m, s.meal_type, `${s.id}-${i}`);
                      return (
                        <MealRow key={dm.key} dm={dm} expanded={expandedKey === dm.key} onToggle={() => setExpandedKey(expandedKey === dm.key ? null : dm.key)}
                          footer={<>{madeThisBtn(dm)}{saveBtn(dm)}</>}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
