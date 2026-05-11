'use client';

import { useState } from 'react';
import { makeId } from '@/utils/pt/programme';
import type {
  PTExercise,
  PTProgrammeExercise,
  PTProgrammeWeekBlock,
  PTProgrammeExerciseBlockOverride,
} from '@/utils/pt/types';

interface Props {
  exercises: PTProgrammeExercise[];
  libraryExercises: PTExercise[];
  weekBlocks?: PTProgrammeWeekBlock[];
  onChange: (exercises: PTProgrammeExercise[]) => void;
}

function calcWeekRanges(blocks: PTProgrammeWeekBlock[]) {
  const ranges: Array<{ label: string; block: PTProgrammeWeekBlock; blockIndex: number }> = [];
  let week = 1;
  blocks.forEach((b, i) => {
    ranges.push({ label: `Week ${week}–${week + b.weeks - 1} · ${b.sets} sets`, block: b, blockIndex: i });
    week += b.weeks;
  });
  return ranges;
}

const SECTION_NAMES = ['Warm Up', 'Workout', 'MetCon', 'Stretches', 'Cool Down'];

// Tailwind class strings must be literal (no dynamic construction) for purging to include them
const SECTION_ROW_BG: Record<string, string> = {
  'Warm Up':  'bg-blue-50 border-l-2 border-l-blue-300',
  'Workout':  'bg-stone-50 border-l-2 border-l-stone-400',
  'MetCon':   'bg-amber-50 border-l-2 border-l-amber-400',
  'Stretches':'bg-emerald-50 border-l-2 border-l-emerald-400',
  'Cool Down':'bg-teal-50 border-l-2 border-l-teal-400',
};
const SECTION_HEADER_CLS: Record<string, string> = {
  'Warm Up':  'bg-blue-100 text-blue-700',
  'Workout':  'bg-stone-100 text-stone-700',
  'MetCon':   'bg-amber-100 text-amber-800',
  'Stretches':'bg-emerald-100 text-emerald-800',
  'Cool Down':'bg-teal-100 text-teal-800',
};
const DEFAULT_ROW_BG = 'bg-purple-50 border-l-2 border-l-purple-400';
const DEFAULT_HEADER_CLS = 'bg-purple-100 text-purple-800';

export default function PTDayEditor({ exercises, libraryExercises, weekBlocks, onChange }: Props) {
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
    onChange(updated);
    clearSelected();
    setCustomSection('');
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
    name.length >= 2
      ? libraryExercises.filter((e) => e.name.toLowerCase().includes(name.toLowerCase())).slice(0, 6)
      : [];

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
              {selected.size >= 2 && (
                <button type="button" onClick={supersetSelected}
                  className="border border-black/40 px-3 py-1.5 text-xs hover:bg-black hover:text-white hover:border-black transition-colors">
                  Superset ({selected.size})
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
                        className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 transition-colors">
                        {name}
                      </button>
                    ))}
                    <div className="border-t border-black/10 px-2 py-1.5 flex gap-1">
                      <input
                        value={customSection}
                        onChange={(e) => setCustomSection(e.target.value)}
                        placeholder="Custom…"
                        className="flex-1 text-xs outline-none px-1 py-0.5 border-b border-black/15 focus:border-black/40"
                        onKeyDown={(e) => { if (e.key === 'Enter') sectionSelected(customSection); }}
                      />
                      <button type="button" onClick={() => sectionSelected(customSection)}
                        className="text-xs text-black/50 hover:text-black px-1">
                        ↵
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button type="button" onClick={clearSelected}
                className="text-xs text-black/40 hover:text-black transition-colors px-1">
                Clear
              </button>
            </>
          ) : (
            <button type="button" onClick={addBlank}
              className="border border-black/10 px-3 py-1.5 text-xs hover:border-black/30">
              + Add exercise
            </button>
          )}
        </div>
      </div>

      {/* Exercise list */}
      <div className="space-y-1">
        {exercises.length === 0 && (
          <p className="text-xs text-black/30 py-4 text-center border border-black/8 border-dashed">
            No exercises yet. Click "+ Add exercise" to start.
          </p>
        )}

        {exercises.map((ex, idx) => {
          // Determine which named section this exercise belongs to (scan backwards for section_start)
          let currentSection: string | null = null;
          for (let i = idx; i >= 0; i--) {
            if (exercises[i]?.section_start !== undefined) { currentSection = exercises[i].section_start ?? null; break; }
          }
          const rowBg = currentSection ? (SECTION_ROW_BG[currentSection] ?? DEFAULT_ROW_BG) : '';
          const headerCls = currentSection ? (SECTION_HEADER_CLS[currentSection] ?? DEFAULT_HEADER_CLS) : '';
          const ssLabel = getSupersetLabel(ex, idx);
          const isFirstInGroup = !!ex.superset_id && (idx === 0 || exercises[idx - 1]?.superset_id !== ex.superset_id);
          const isLastInGroup = !!ex.superset_id && (idx === exercises.length - 1 || exercises[idx + 1]?.superset_id !== ex.superset_id);
          const isInGroup = !!ex.superset_id;

          const overrideForBlock = activeBlock >= 0 ? (ex.week_overrides?.find((o) => o.block_index === activeBlock) ?? null) : null;
          const displaySets = overrideForBlock?.sets ?? ex.sets;
          const displayReps = overrideForBlock?.reps ?? ex.reps;
          const displayWeightPct = overrideForBlock?.weight_pct ?? '';
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
              {/* Section header banner */}
              {ex.section_start !== undefined && (
                <div className={`flex items-center justify-between px-3 py-1.5 mt-4 mb-0 group ${headerCls || 'bg-black/5 text-black/50'}`}>
                  <input
                    value={ex.section_start}
                    onChange={(e) => patch(idx, { section_start: e.target.value })}
                    className="text-[0.6rem] uppercase tracking-[0.2em] font-semibold bg-transparent outline-none flex-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button type="button" onClick={() => patch(idx, { section_start: undefined })}
                    className="text-current opacity-30 hover:opacity-70 text-xs ml-2 opacity-0 group-hover:opacity-40 transition-opacity">×</button>
                </div>
              )}

              {/* Superset top bracket */}
              {isFirstInGroup && (
                <div className="ml-8 flex items-center gap-1 mt-1">
                  <div className="w-px h-3 bg-black/20 ml-1" />
                  <span className="text-[0.55rem] uppercase tracking-[0.15em] text-black/30">Superset</span>
                </div>
              )}

              <div
                className={`flex items-stretch gap-1 ${rowBg} ${isInGroup ? 'ml-8 border-l-4 border-l-black/20 pl-2' : ''} ${isSelected ? 'ring-1 ring-inset ring-black/25' : ''}`}
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

                <div className="flex-1 border border-black/10 bg-[#fafaf8]">
                  <div className={`grid gap-2 items-center p-2 ${gridCols}`}>
                    <span className="text-black/20 text-sm select-none cursor-grab">⠿</span>

                    {/* Name with autocomplete */}
                    <div className="relative">
                      <input
                        value={ex.name}
                        onChange={(e) => handleNameChange(idx, e.target.value)}
                        onFocus={() => {
                          const m = getLibraryMatches(ex.name);
                          if (m.length > 0) setAutocompleteFor(ex.id);
                        }}
                        onBlur={() => setTimeout(() => setAutocompleteFor(null), 150)}
                        placeholder="Exercise name"
                        className="w-full border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 bg-white"
                      />
                      {autocompleteMatches.length > 0 && (
                        <div className="absolute left-0 top-full z-30 bg-white border border-black/15 shadow-md w-full max-h-44 overflow-y-auto">
                          {autocompleteMatches.map((libEx) => (
                            <button key={libEx.id} type="button"
                              onMouseDown={() => selectFromLibrary(idx, libEx)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-baseline gap-2">
                              <span>{libEx.name}</span>
                              {libEx.muscles.length > 0 && (
                                <span className="text-xs text-black/30">{libEx.muscles.slice(0, 2).join(', ')}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <input value={displaySets}
                      onChange={(e) => { if (activeBlock >= 0) patchOverride(idx, activeBlock, { sets: e.target.value }); else patch(idx, { sets: e.target.value }); }}
                      placeholder="Sets"
                      className={`border px-2 py-1.5 text-sm outline-none text-center bg-white ${activeBlock >= 0 ? 'border-black/30 bg-amber-50' : 'border-black/10 focus:border-black/30'}`} />

                    <input value={displayReps}
                      onChange={(e) => { if (activeBlock >= 0) patchOverride(idx, activeBlock, { reps: e.target.value }); else patch(idx, { reps: e.target.value }); }}
                      placeholder="Reps"
                      className={`border px-2 py-1.5 text-sm outline-none text-center bg-white ${activeBlock >= 0 ? 'border-black/30 bg-amber-50' : 'border-black/10 focus:border-black/30'}`} />

                    {activeBlock >= 0 && (
                      <input value={displayWeightPct}
                        onChange={(e) => patchOverride(idx, activeBlock, { weight_pct: e.target.value })}
                        placeholder="% 1RM"
                        className="border border-black/30 bg-amber-50 px-2 py-1.5 text-sm outline-none text-center" />
                    )}

                    <input value={ex.rest}
                      onChange={(e) => patch(idx, { rest: e.target.value })}
                      placeholder="Rest"
                      className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 text-center bg-white" />

                    <input value={displayNotes}
                      onChange={(e) => { if (activeBlock >= 0) patchOverride(idx, activeBlock, { notes: e.target.value }); else patch(idx, { notes: e.target.value }); }}
                      placeholder="Notes"
                      className={`border px-2 py-1.5 text-sm outline-none bg-white ${activeBlock >= 0 ? 'border-black/30 bg-amber-50' : 'border-black/10 focus:border-black/30'}`} />

                    {/* YouTube toggle */}
                    <button type="button" onClick={() => toggleVideo(ex.id)} title="YouTube video URL"
                      className={`text-xs transition-colors ${showVideo || ex.video_url ? 'text-black/60' : 'text-black/20 hover:text-black/40'}`}>
                      ▶
                    </button>

                    {/* Block overrides toggle */}
                    {weekBlocks && weekBlocks.length > 0 && (
                      <button type="button" title="Per-block overrides"
                        onClick={() => setExpanded((s) => { const n = new Set(s); n.has(ex.id) ? n.delete(ex.id) : n.add(ex.id); return n; })}
                        className={`text-xs transition-colors ${isExpanded ? 'text-black' : 'text-black/25 hover:text-black/50'}`}>▾</button>
                    )}

                    <button type="button" onClick={() => remove(idx)}
                      className="text-black/20 hover:text-red-500 transition-colors text-sm">×</button>
                  </div>

                  {/* YouTube URL field */}
                  {(showVideo || ex.video_url) && (
                    <div className="px-2 pb-2 border-t border-black/8">
                      <input
                        value={ex.video_url ?? ''}
                        onChange={(e) => patch(idx, { video_url: e.target.value || null })}
                        placeholder="https://youtube.com/watch?v=…"
                        className="w-full border border-black/10 px-2 py-1.5 text-xs outline-none focus:border-black/30 mt-2"
                      />
                      {ex.video_url && ex.video_url.includes('youtube') && (
                        <p className="text-[0.55rem] text-black/30 mt-0.5">YouTube link — visible to client</p>
                      )}
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
                                placeholder={weekBlocks[b.blockIndex]?.sets ?? 'Sets'}
                                className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center" />
                              <input value={ov?.reps ?? ''} onChange={(e) => patchOverride(idx, b.blockIndex, { reps: e.target.value })}
                                placeholder={ex.reps || 'Reps'}
                                className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center" />
                              <input value={ov?.weight_pct ?? ''} onChange={(e) => patchOverride(idx, b.blockIndex, { weight_pct: e.target.value })}
                                placeholder="% 1RM"
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

              {/* Superset bottom bracket */}
              {isLastInGroup && (
                <div className="ml-8 flex items-center gap-1 mb-1">
                  <div className="w-px h-3 bg-black/20 ml-1" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
