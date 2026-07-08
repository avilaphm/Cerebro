'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Recipe {
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

const MEAL_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

interface Props {
  clientId: string;
  onClose: () => void;
  onLogged?: () => void;
  onStartFlow?: () => void;
}

export default function RecipeBookModal({ clientId, onClose, onLogged, onStartFlow }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [loggedId, setLoggedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
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
    const { data, error: err } = await supabase
      .from('recipes')
      .select('id, name, description, meal_type, calories, protein, carbs, fat, prep_time, ingredients, steps, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (err) setError('Could not load your recipe book.');
    setRecipes((data ?? []) as Recipe[]);
    setLoading(false);
  }, [supabase, clientId]);

  // Defer the initial load so the effect body doesn't setState synchronously.
  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (filter !== 'all' && (r.meal_type ?? '').toLowerCase() !== filter) return false;
      if (!q) return true;
      const hay = [r.name, r.description ?? '', ...r.ingredients.map((i) => i.name)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [recipes, query, filter]);

  const logRecipe = async (r: Recipe) => {
    if (loggingId) return;
    setLoggingId(r.id);
    const { error: insErr } = await supabase.from('pt_nutrition_logs').insert({
      client_id: clientId,
      input_type: 'text',
      meal_type: r.meal_type ?? 'dinner',
      meal_description: r.name,
      food_items: r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: '' })),
      protein_g: r.protein,
      carbs_g: r.carbs,
      fat_g: r.fat,
      calories: r.calories,
      notes: 'Cooked from a saved recipe.',
    });
    setLoggingId(null);
    if (insErr) { setError('Could not log that recipe. Please try again.'); return; }
    setLoggedId(r.id);
    onLogged?.();
    window.setTimeout(() => setLoggedId((cur) => (cur === r.id ? null : cur)), 2500);
  };

  const removeRecipe = async (r: Recipe) => {
    if (removingId) return;
    setRemovingId(r.id);
    const { error: delErr } = await supabase.from('recipes').delete().eq('id', r.id);
    setRemovingId(null);
    if (delErr) { setError('Could not remove that recipe. Please try again.'); return; }
    setRecipes((prev) => prev.filter((x) => x.id !== r.id));
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f0]">
      {/* Header */}
      <div className="flex shrink-0 items-center px-4 pb-3 pt-14">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white text-black/40 shadow-sm transition-colors hover:text-black"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
        <div className="flex-1 px-3 text-center">
          <p className="text-sm font-medium leading-tight">Recipe book</p>
          {recipes.length > 0 && (
            <p className="mt-0.5 text-[0.6rem] uppercase tracking-[0.12em] leading-tight text-black/35">{recipes.length} saved</p>
          )}
        </div>
        <div className="h-9 w-9 shrink-0" />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
        {loading ? (
          <p className="py-16 text-center text-sm text-black/30">Loading…</p>
        ) : recipes.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/[0.04] text-black/30">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4h11a2 2 0 012 2v14l-4-2-4 2-4-2V6a2 2 0 012-2z" /></svg>
            </div>
            <div>
              <p className="text-sm font-medium">No saved recipes yet</p>
              <p className="mx-auto mt-2 max-w-[17rem] text-[0.72rem] leading-relaxed text-black/45">
                When you get meal ideas from &ldquo;Help me with my next meal&rdquo;, tap the bookmark to save the ones you like here.
              </p>
            </div>
            {onStartFlow && (
              <button type="button" onClick={onStartFlow} className="mt-1 rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90">
                Find a meal
              </button>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-md space-y-3">
            {/* Search */}
            <div className="flex items-center gap-2 border border-black/12 bg-white px-3.5 py-2.5">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-black/30"><circle cx="9" cy="9" r="6" /><path d="M14 14l4 4" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search recipes or ingredients"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-black/25"
              />
            </div>

            {/* Meal-type filter */}
            <div className="flex flex-wrap gap-2">
              {MEAL_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={`rounded-full border px-3 py-1.5 text-[0.7rem] font-medium transition-colors ${
                    filter === f.value ? 'border-black bg-black text-white' : 'border-black/12 bg-white text-black/55 hover:border-black/30'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {error && <p className="px-1 text-[0.7rem] text-red-500">{error}</p>}

            {visible.length === 0 ? (
              <p className="py-10 text-center text-[0.75rem] text-black/35">No recipes match that.</p>
            ) : (
              visible.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <div key={r.id} className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
                    <button type="button" onClick={() => setExpanded(isOpen ? null : r.id)} className="w-full px-4 py-3.5 text-left">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium leading-snug">{r.name}</p>
                        {r.calories != null && <span className="shrink-0 text-xs font-medium tabular-nums">{r.calories} kcal</span>}
                      </div>
                      {r.description && <p className="mt-1 text-[0.7rem] leading-relaxed text-black/45">{r.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.62rem] tabular-nums text-black/40">
                        {r.meal_type && <span className="uppercase tracking-[0.08em] text-black/35">{r.meal_type}</span>}
                        {r.protein != null && <span>{r.protein}g P</span>}
                        {r.carbs != null && <span>{r.carbs}g C</span>}
                        {r.fat != null && <span>{r.fat}g F</span>}
                        {r.prep_time != null && <span className="text-black/35">&middot; {r.prep_time} min</span>}
                      </div>
                      <p className="mt-1.5 text-[0.58rem] uppercase tracking-[0.1em] text-black/25">{isOpen ? 'Hide recipe' : 'Tap for recipe'}</p>
                    </button>

                    {isOpen && (
                      <div className="space-y-3 border-t border-black/8 px-4 py-3">
                        {r.ingredients.length > 0 && (
                          <div>
                            <p className="mb-1 text-[0.56rem] font-medium uppercase tracking-[0.14em] text-black/35">Ingredients</p>
                            <ul className="space-y-0.5">
                              {r.ingredients.map((ing, k) => (
                                <li key={k} className="text-[0.72rem] text-black/60">{ing.name}{ing.quantity ? ` · ${ing.quantity}` : ''}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {r.steps.length > 0 && (
                          <div>
                            <p className="mb-1 text-[0.56rem] font-medium uppercase tracking-[0.14em] text-black/35">Steps</p>
                            <ol className="space-y-1">
                              {r.steps.map((s, k) => (
                                <li key={k} className="flex gap-2 text-[0.72rem] leading-relaxed text-black/60"><span className="text-black/30">{k + 1}.</span><span>{s}</span></li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 border-t border-black/8 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => void logRecipe(r)}
                        disabled={loggingId === r.id || loggedId === r.id}
                        className="flex-1 rounded-full bg-black py-2.5 text-[0.72rem] font-medium text-white transition-opacity disabled:opacity-40"
                      >
                        {loggedId === r.id ? 'Logged ✓' : loggingId === r.id ? 'Logging…' : 'I made this'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeRecipe(r)}
                        disabled={removingId === r.id}
                        className="rounded-full border border-black/12 bg-white px-4 py-2.5 text-[0.72rem] font-medium text-black/45 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                      >
                        {removingId === r.id ? '…' : 'Remove'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
