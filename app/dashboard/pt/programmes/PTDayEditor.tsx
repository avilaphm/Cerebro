'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { makeId, sortExercisesBySectionOrder } from '@/utils/pt/programme';
import type {
  PTExercise,
  PTProgrammeExercise,
  PTProgrammeWeekBlock,
  PTProgrammeExerciseBlockOverride,
} from '@/utils/pt/types';

const BIG_5_ALIASES: Array<[string, string[]]> = [
  ['BB Squat', ['squat', 'bb squat', 'barbell squat', 'back squat']],
  ['BB Deadlift', ['deadlift', 'bb deadlift', 'barbell deadlift', 'conventional deadlift']],
  ['BB Bench Press', ['bench press', 'bb bench', 'barbell bench', 'chest press', 'bb chest press']],
  ['BB Shoulder Press', ['shoulder press', 'overhead press', 'ohp', 'bb shoulder press', 'barbell shoulder press', 'military press']],
  ['Pull-up', ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup']],
];

function matchCanonical(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [canonical, aliases] of BIG_5_ALIASES) {
    if (aliases.some((alias) => lower.includes(alias))) return canonical;
  }
  return null;
}

function resolveKgFromPct(pctStr: string, oneRmKg: number): number | null {
  const cleaned = pctStr.replace('%', '').trim();
  const pct = parseFloat(cleaned);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 200) return null;
  return Math.round(oneRmKg * (pct / 100) * 4) / 4;
}

interface Props {
  exercises: PTProgrammeExercise[];
  libraryExercises: PTExercise[];
  weekBlocks?: PTProgrammeWeekBlock[];
  oneRmMap?: Record<string, number>;
  onChange: (exercises: PTProgrammeExercise[]) => void;
}

// Static class strings so Tailwind includes them at build time
const SECTION_CARD: Record<string, string> = {
  'Warm Up':  'bg-blue-50/70 ring-1 ring-inset ring-blue-200',
  'Workout':  'bg-stone-50/70 ring-1 ring-inset ring-stone-300',
  'MetCon':   'bg-amber-50/70 ring-1 ring-inset ring-amber-200',
  'Stretches':'bg-emerald-50/70 ring-1 ring-inset ring-emerald-200',
};
const SECTION_LABEL: Record<string, string> = {
  'Warm Up':  'text-blue-600',
  'Workout':  'text-stone-600',
  'MetCon':   'text-amber-700',
  'Stretches':'text-emerald-700',
};
const DEFAULT_CARD = 'bg-purple-50/70 ring-1 ring-inset ring-purple-200';
const DEFAULT_LABEL = 'text-purple-700';

const SECTION_NAMES = ['Warm Up', 'Workout', 'MetCon', 'Stretches'];

type SectionGroup = {
  name: string | null;
  firstIdx: number;
  items: Array<{ ex: PTProgrammeExercise; idx: number }>;
};

function groupBySections(exercises: PTProgrammeExercise[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  exercises.forEach((ex, idx) => {
    if (ex.section_start !== undefined) {
      groups.push({ name: ex.section_start || 'Section', firstIdx: idx, items: [{ ex, idx }] });
    } else if (groups.length === 0) {
      groups.push({ name: null, firstIdx: idx, items: [{ ex, idx }] });
    } else {
      groups[groups.length - 1].items.push({ ex, idx });
    }
  });
  return groups;
}

function calcWeekRanges(blocks: PTProgrammeWeekBlock[]) {
  const ranges: Array<{ label: string; blockIndex: number }> = [];
  let week = 1;
  blocks.forEach((b, i) => {
    const value = b.sets ? `${b.sets} sets` : b.weight_pct ? b.weight_pct : 'Block';
    ranges.push({ label: `Week ${week}–${week + b.weeks - 1} · ${value}`, blockIndex: i });
    week += b.weeks;
  });
  return ranges;
}

export default function PTDayEditor({ exercises, libraryExercises, weekBlocks, oneRmMap, onChange }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [dragged, setDragged] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeBlock, setActiveBlock] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [showVideoFor, setShowVideoFor] = useState<Set<string>>(new Set());
  const [autocompleteFor, setAutocompleteFor] = useState<string | null>(null);
  const [customSection, setCustomSection] = useState('');

  const blocks = weekBlocks && weekBlocks.length > 0 ? calcWeekRanges(weekBlocks) : [];

  const patch = (i: number, p: Partial<PTProgrammeExercise>) => {
    const updated = [...exercises];
    updated[i] = { ...updated[i], ...p };
    onChange(updated);
  };

  const remove = (i: number) => {
    onChange(exercises.filter((_, idx) => idx !== i));
    setSelected((s) => { const n = new Set(s); n.delete(exercises[i].id); return n; });
  };

  const drop = (targetIdx: number) => {
    if (dragged === null || dragged === targetIdx) return;
    const updated = [...exercises];
    const [item] = updated.splice(dragged, 1);
    updated.splice(targetIdx, 0, item);
    onChange(updated);
    setDragged(null);
  };

  const addBlank = () =>
    onChange([...exercises, { id: makeId('ex'), exercise_id: null, name: '', sets: '2', reps: '8-12', rest: '30 sec', notes: '', video_url: null, cues: [] }]);

  const toggleSelect = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const clearSelected = () => { setSelected(new Set()); setShowSectionPicker(false); };

  const supersetSelected = () => {
    const indices = exercises.map((e, i) => selected.has(e.id) ? i : -1).filter((i) => i >= 0);
    if (indices.length < 2) return;
    const ssId = makeId('ss');
    const updated = [...exercises];
    indices.forEach((i) => { updated[i] = { ...updated[i], superset_id: ssId }; });
    onChange(updated);
    clearSelected();
  };

  const removeFromSuperset = () => {
    const updated = [...exercises];
    exercises.forEach((e, i) => { if (selected.has(e.id) && e.superset_id) updated[i] = { ...updated[i], superset_id: null }; });
    onChange(updated);
    clearSelected();
  };

  const sectionSelected = (name: string) => {
    if (!name.trim()) return;
    const sortedIndices = exercises
      .map((e, i) => selected.has(e.id) ? i : -1)
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (sortedIndices.length === 0) return;
    const updated = [...exercises];
    sortedIndices.forEach((i) => { updated[i] = { ...updated[i], section_start: undefined }; });
    updated[sortedIndices[0]] = { ...updated[sortedIndices[0]], section_start: name.trim() };
    onChange(sortExercisesBySectionOrder(updated));
    clearSelected();
    setCustomSection('');
  };

  const removeSection = (firstIdx: number) => {
    patch(firstIdx, { section_start: undefined });
  };

  const patchOverride = (exerciseIdx: number, blockIndex: number, p: Partial<PTProgrammeExerciseBlockOverride>) => {
    const ex = exercises[exerciseIdx];
    const overrides = [...(ex.week_overrides ?? [])];
    const oi = overrides.findIndex((o) => o.block_index === blockIndex);
    if (oi >= 0) { overrides[oi] = { ...overrides[oi], ...p }; }
    else { overrides.push({ block_index: blockIndex, ...p }); }
    patch(exerciseIdx, { week_overrides: overrides });
  };

  const getSupersetLabel = (ex: PTProgrammeExercise, idx: number): string | null => {
    if (!ex.superset_id) return null;
    const before = exercises.slice(0, idx).filter((e) => e.superset_id === ex.superset_id);
    return String.fromCharCode(65 + before.length);
  };

  const getLibraryMatches = (name: string) =>
    name.length >= 2 ? libraryExercises.filter((e) => e.name.toLowerCase().includes(name.toLowerCase())).slice(0, 6) : [];

  const handleNameChange = (idx: number, value: string) => {
    patch(idx, { name: value });
    const matches = getLibraryMatches(value);
    setAutocompleteFor(matches.length > 0 ? exercises[idx].id : null);
  };

  const selectFromLibrary = (idx: number, libEx: PTExercise) => {
    const updated = [...exercises];
    updated[idx] = {
      ...updated[idx],
      exercise_id: libEx.id,
      name: libEx.name,
      sets: '2',
      reps: '8-12',
      rest: '30 sec',
      video_url: libEx.video_url,
      cues: libEx.cues.slice(0, 4),
      notes: libEx.purpose ?? updated[idx].notes,
    };
    onChange(updated);
    setAutocompleteFor(null);
  };

  const toggleVideo = (id: string) =>
    setShowVideoFor((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const anySelected = selected.size > 0;
  const anySelectedInSuperset = anySelected && exercises.some((e) => selected.has(e.id) && !!e.superset_id);

  const groups = groupBySections(exercises);

  const renderExercise = (ex: PTProgrammeExercise, idx: number) => {
    const ssLabel = getSupersetLabel(ex, idx);
    const isFirstInGroup = !!ex.superset_id && (idx === 0 || exercises[idx - 1]?.superset_id !== ex.superset_id);
    const isLastInGroup = !!ex.superset_id && (idx === exercises.length - 1 || exercises[idx + 1]?.superset_id !== ex.superset_id);
    const isInGroup = !!ex.superset_id;

    const overrideForBlock = activeBlock >= 0 ? (ex.week_overrides?.find((o) => o.block_index === activeBlock) ?? null) : null;
    // Sets: exercise override → block default sets → exercise default
    const blockDefaultSets = activeBlock >= 0 && weekBlocks
      ? (weekBlocks[Math.min(activeBlock, weekBlocks.length - 1)]?.sets ?? ex.sets)
      : ex.sets;
    const blockDefaultWeightPct = activeBlock >= 0 && weekBlocks
      ? (weekBlocks[Math.min(activeBlock, weekBlocks.length - 1)]?.weight_pct ?? '')
      : '';
    const displaySets = overrideForBlock?.sets ?? blockDefaultSets;
    const displayReps = overrideForBlock?.reps ?? ex.reps;
    const displayWeightPct = overrideForBlock?.weight_pct ?? blockDefaultWeightPct;
    const displayNotes = overrideForBlock?.notes ?? ex.notes;

    const isExpanded = expanded.has(ex.id);
    const isSelected = selected.has(ex.id);
    const showVideo = showVideoFor.has(ex.id);
    const autocompleteMatches = autocompleteFor === ex.id ? getLibraryMatches(ex.name) : [];

    const gridCols = activeBlock >= 0
      ? 'grid-cols-[1.5rem_1fr_4rem_5rem_4rem_5rem_5rem_1.5rem_1.5rem_1.5rem]'
      : 'grid-cols-[1.5rem_1fr_4rem_5rem_5rem_5rem_1.5rem_1.5rem_1.5rem]';

    return (
      <div key={ex.id}>
        {isFirstInGroup && (
          <div className="ml-8 flex items-center gap-1 mt-1">
            <div className="w-px h-3 bg-black/20 ml-1" />
            <span className="text-[0.55rem] uppercase tracking-[0.15em] text-black/30">Superset</span>
          </div>
        )}

        <div
          className={`flex items-stretch gap-1 ${isInGroup ? 'ml-8 border-l-4 border-l-black/20 pl-2' : ''} ${isSelected ? 'ring-1 ring-inset ring-black/25' : ''}`}
          draggable
          onDragStart={() => setDragged(idx)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(idx)}
        >
          {/* Select checkbox */}
          <button type="button" onClick={() => toggleSelect(ex.id)}
            className={`w-7 flex items-center justify-center shrink-0 text-sm transition-colors ${isSelected ? 'text-black' : 'text-black/15 hover:text-black/35'}`}>
            {isSelected ? '■' : '□'}
          </button>

          {ssLabel && (
            <div className="w-5 flex items-center justify-center shrink-0">
              <span className="text-[0.55rem] font-bold text-black/40">{ssLabel}</span>
            </div>
          )}

          <div className="flex-1 border border-black/10 bg-white">
            <div className={`grid gap-2 items-center p-2 ${gridCols}`}>
              <span className="text-black/20 text-sm select-none cursor-grab">⠿</span>

              {/* Name + autocomplete */}
              <div className="relative">
                <input
                  value={ex.name}
                  onChange={(e) => handleNameChange(idx, e.target.value)}
                  onFocus={() => { const m = getLibraryMatches(ex.name); if (m.length > 0) setAutocompleteFor(ex.id); }}
                  onBlur={() => setTimeout(() => setAutocompleteFor(null), 150)}
                  placeholder="Exercise name"
                  className="w-full border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 bg-white"
                />
                {autocompleteMatches.length > 0 && (
                  <div className="absolute left-0 top-full z-30 bg-white border border-black/15 shadow-md w-full max-h-44 overflow-y-auto">
                    {autocompleteMatches.map((libEx) => (
                      <button key={libEx.id} type="button" onMouseDown={() => selectFromLibrary(idx, libEx)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-baseline gap-2">
                        <span>{libEx.name}</span>
                        {libEx.muscles.length > 0 && <span className="text-xs text-black/30">{libEx.muscles.slice(0, 2).join(', ')}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Sets — shows block default when block selected */}
              <input value={displaySets}
                onChange={(e) => { if (activeBlock >= 0) patchOverride(idx, activeBlock, { sets: e.target.value }); else patch(idx, { sets: e.target.value }); }}
                placeholder="Sets"
                className={`border px-2 py-1.5 text-sm outline-none text-center bg-white ${activeBlock >= 0 ? 'border-amber-300 bg-amber-50' : 'border-black/10 focus:border-black/30'}`} />

              <input value={displayReps}
                onChange={(e) => { if (activeBlock >= 0) patchOverride(idx, activeBlock, { reps: e.target.value }); else patch(idx, { reps: e.target.value }); }}
                placeholder="Reps"
                className={`border px-2 py-1.5 text-sm outline-none text-center bg-white ${activeBlock >= 0 ? 'border-amber-300 bg-amber-50' : 'border-black/10 focus:border-black/30'}`} />

              {activeBlock >= 0 && (
                <div className="flex flex-col gap-0.5">
                  <input value={displayWeightPct}
                    onChange={(e) => patchOverride(idx, activeBlock, { weight_pct: e.target.value })}
                    placeholder="% 1RM"
                    className="border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm outline-none text-center" />
                  {(() => {
                    if (!displayWeightPct || !oneRmMap) return null;
                    const canonical = matchCanonical(ex.name);
                    const oneRm = canonical ? oneRmMap[canonical] : null;
                    if (!oneRm) return null;
                    const kg = resolveKgFromPct(displayWeightPct, oneRm);
                    if (kg === null) return null;
                    return <span className="text-[0.55rem] text-center text-amber-700">~{kg}kg</span>;
                  })()}
                </div>
              )}

              <input value={ex.rest}
                onChange={(e) => patch(idx, { rest: e.target.value })}
                placeholder="Rest"
                className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 text-center bg-white" />

              <input value={displayNotes}
                onChange={(e) => { if (activeBlock >= 0) patchOverride(idx, activeBlock, { notes: e.target.value }); else patch(idx, { notes: e.target.value }); }}
                placeholder="Notes"
                className={`border px-2 py-1.5 text-sm outline-none bg-white ${activeBlock >= 0 ? 'border-amber-300 bg-amber-50' : 'border-black/10 focus:border-black/30'}`} />

              {/* YouTube toggle */}
              <button type="button" onClick={() => toggleVideo(ex.id)} title="YouTube video"
                className={`text-xs transition-colors ${showVideo || ex.video_url ? 'text-black/60' : 'text-black/20 hover:text-black/40'}`}>▶</button>

              {/* Override toggle */}
              {weekBlocks && weekBlocks.length > 0 && (
                <button type="button" title="Per-block overrides"
                  onClick={() => setExpanded((s) => { const n = new Set(s); n.has(ex.id) ? n.delete(ex.id) : n.add(ex.id); return n; })}
                  className={`text-xs transition-colors ${isExpanded ? 'text-black' : 'text-black/25 hover:text-black/50'}`}>▾</button>
              )}

              <button type="button" onClick={() => remove(idx)} className="text-black/20 hover:text-red-500 transition-colors text-sm">×</button>
            </div>

            {/* YouTube URL */}
            {(showVideo || ex.video_url) && (
              <div className="px-2 pb-2 border-t border-black/8">
                <input
                  value={ex.video_url ?? ''}
                  onChange={(e) => {
                    const url = e.target.value || null;
                    patch(idx, { video_url: url });
                    if (ex.exercise_id) {
                      void supabase.from('pt_exercises').update({ video_url: url }).eq('id', ex.exercise_id);
                    }
                  }}
                  placeholder="https://youtube.com/watch?v=…"
                  className="w-full border border-black/10 px-2 py-1.5 text-xs outline-none focus:border-black/30 mt-2"
                />
                <p className="text-[0.55rem] text-black/30 mt-0.5">
                  {ex.exercise_id ? 'Saved to exercise library — updates all programmes' : 'YouTube link — visible to client'}
                </p>
              </div>
            )}

            {/* Per-block overrides panel */}
            {isExpanded && weekBlocks && weekBlocks.length > 0 && (
              <div className="border-t border-black/8 px-2 pb-2 pt-2 bg-[#f5f5f0]">
                <p className="text-[0.55rem] uppercase tracking-[0.15em] text-black/35 mb-2">Per-block overrides</p>
                <div className="space-y-1">
                  {blocks.map((b) => {
                    const ov = ex.week_overrides?.find((o) => o.block_index === b.blockIndex);
                    return (
                      <div key={b.blockIndex} className="grid grid-cols-[8rem_4rem_5rem_4rem_1fr] gap-1.5 items-center">
                        <span className="text-[0.6rem] text-black/45 truncate">{b.label}</span>
                        <input value={ov?.sets ?? ''} onChange={(e) => patchOverride(idx, b.blockIndex, { sets: e.target.value })}
                          placeholder={weekBlocks[b.blockIndex]?.sets ?? ex.sets ?? 'Sets'}
                          className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center" />
                        <input value={ov?.reps ?? ''} onChange={(e) => patchOverride(idx, b.blockIndex, { reps: e.target.value })}
                          placeholder={ex.reps || 'Reps'}
                          className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center" />
                        <input value={ov?.weight_pct ?? ''} onChange={(e) => patchOverride(idx, b.blockIndex, { weight_pct: e.target.value })}
                          placeholder={weekBlocks[b.blockIndex]?.weight_pct ?? '% 1RM'}
                          className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center" />
                        <input value={ov?.notes ?? ''} onChange={(e) => patchOverride(idx, b.blockIndex, { notes: e.target.value })}
                          placeholder="Notes"
                          className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {isLastInGroup && (
          <div className="ml-8 flex items-center gap-1 mb-1">
            <div className="w-px h-3 bg-black/20 ml-1" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Block selector */}
      {blocks.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setActiveBlock(-1)}
            className={`px-3 py-1.5 text-xs border transition-colors ${activeBlock === -1 ? 'bg-black text-white border-black' : 'border-black/15 hover:border-black/30'}`}>
            All
          </button>
          {blocks.map((b) => (
            <button key={b.blockIndex} type="button" onClick={() => setActiveBlock(b.blockIndex)}
              className={`px-3 py-1.5 text-xs border transition-colors ${activeBlock === b.blockIndex ? 'bg-black text-white border-black' : 'border-black/15 hover:border-black/30'}`}>
              {b.label}
            </button>
          ))}
          {activeBlock >= 0 && (
            <span className="px-2 py-1.5 text-[0.6rem] text-black/40 uppercase tracking-[0.1em] self-center">
              editing overrides for this block
            </span>
          )}
        </div>
      )}

      {/* Header */}
      <div className="mb-3 flex items-center justify-between min-h-[2rem]">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Exercises</p>
        <div className="flex items-center gap-2">
          {anySelected ? (
            <>
              {selected.size >= 2 && !anySelectedInSuperset && (
                <button type="button" onClick={supersetSelected}
                  className="border border-black/40 px-3 py-1.5 text-xs hover:bg-black hover:text-white hover:border-black transition-colors">
                  Superset ({selected.size})
                </button>
              )}
              {anySelectedInSuperset && (
                <button type="button" onClick={removeFromSuperset}
                  className="border border-red-300 text-red-500 px-3 py-1.5 text-xs hover:bg-red-50 transition-colors">
                  Remove superset
                </button>
              )}
              <div className="relative">
                <button type="button" onClick={() => setShowSectionPicker((v) => !v)}
                  className="border border-black/40 px-3 py-1.5 text-xs hover:bg-black hover:text-white hover:border-black transition-colors">
                  + Section
                </button>
                {showSectionPicker && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-black/20 shadow-sm min-w-[140px]">
                    {SECTION_NAMES.map((name) => (
                      <button key={name} type="button" onClick={() => sectionSelected(name)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 transition-colors">{name}</button>
                    ))}
                    <div className="border-t border-black/10 px-2 py-1.5 flex gap-1">
                      <input value={customSection} onChange={(e) => setCustomSection(e.target.value)}
                        placeholder="Custom…"
                        className="flex-1 text-xs outline-none px-1 py-0.5 border-b border-black/15 focus:border-black/40"
                        onKeyDown={(e) => { if (e.key === 'Enter') sectionSelected(customSection); }} />
                      <button type="button" onClick={() => sectionSelected(customSection)} className="text-xs text-black/50 hover:text-black px-1">↵</button>
                    </div>
                  </div>
                )}
              </div>
              <button type="button" onClick={clearSelected} className="text-xs text-black/40 hover:text-black transition-colors px-1">Clear</button>
            </>
          ) : (
            <button type="button" onClick={addBlank} className="border border-black/10 px-3 py-1.5 text-xs hover:border-black/30">
              + Add exercise
            </button>
          )}
        </div>
      </div>

      {/* Exercise list — grouped by sections */}
      {exercises.length === 0 ? (
        <p className="text-xs text-black/30 py-4 text-center border border-black/8 border-dashed">
          No exercises yet. Click "+ Add exercise" to start.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.name ? (
                <>
                  {/* Section label row — above the card, not inside it */}
                  <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className={`text-[0.6rem] uppercase tracking-[0.2em] font-semibold ${SECTION_LABEL[group.name] ?? DEFAULT_LABEL}`}>
                      {group.name}
                    </span>
                    <button type="button" onClick={() => removeSection(group.firstIdx)}
                      title="Remove section (keeps exercises)"
                      className="text-[0.6rem] text-black/25 hover:text-red-400 transition-colors px-1">
                      Remove section
                    </button>
                  </div>
                  {/* Section card */}
                  <div className={`p-3 space-y-1 ${SECTION_CARD[group.name] ?? DEFAULT_CARD}`}>
                    {group.items.map(({ ex, idx }) => renderExercise(ex, idx))}
                  </div>
                </>
              ) : (
                /* Unsectioned exercises — plain list */
                <div className="space-y-1">
                  {group.items.map(({ ex, idx }) => renderExercise(ex, idx))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
