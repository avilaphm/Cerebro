'use client';

import { useState } from 'react';
import { makeId, exerciseFromLibrary } from '@/utils/pt/programme';
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
    ranges.push({
      label: `Week ${week}–${week + b.weeks - 1} · ${b.sets} sets`,
      block: b,
      blockIndex: i,
    });
    week += b.weeks;
  });
  return ranges;
}

export default function PTDayEditor({ exercises, libraryExercises, weekBlocks, onChange }: Props) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeBlock, setActiveBlock] = useState(-1);

  const blocks = weekBlocks && weekBlocks.length > 0 ? calcWeekRanges(weekBlocks) : [];

  const patch = (i: number, p: Partial<PTProgrammeExercise>) => {
    const updated = [...exercises];
    updated[i] = { ...updated[i], ...p };
    onChange(updated);
  };

  const remove = (i: number) => onChange(exercises.filter((_, idx) => idx !== i));

  const drop = (targetIdx: number) => {
    if (dragged === null || dragged === targetIdx) return;
    const updated = [...exercises];
    const [item] = updated.splice(dragged, 1);
    updated.splice(targetIdx, 0, item);
    onChange(updated);
    setDragged(null);
  };

  const addFromLibrary = (exId: string) => {
    const ex = libraryExercises.find((e) => e.id === exId);
    if (ex) onChange([...exercises, exerciseFromLibrary(ex)]);
  };

  const addBlank = () =>
    onChange([
      ...exercises,
      { id: makeId('ex'), exercise_id: null, name: '', sets: '3', reps: '8-12', rest: '60 sec', notes: '', video_url: null, cues: [] },
    ]);

  const addSection = (beforeIdx: number) => {
    const updated = [...exercises];
    if (beforeIdx >= updated.length) {
      updated.push({ id: makeId('ex'), exercise_id: null, name: '', sets: '3', reps: '8-12', rest: '60 sec', notes: '', video_url: null, cues: [], section_start: 'Section' });
    } else {
      updated[beforeIdx] = { ...updated[beforeIdx], section_start: updated[beforeIdx].section_start ?? 'Section' };
    }
    onChange(updated);
  };

  const toggleSuperset = (i: number) => {
    const ex = exercises[i];
    const next = exercises[i + 1];
    if (!next) return;
    const updated = [...exercises];
    if (ex.superset_id && ex.superset_id === next.superset_id) {
      const inGroup = exercises.filter((e) => e.superset_id === ex.superset_id);
      if (inGroup.length <= 2) {
        updated[i] = { ...updated[i], superset_id: null };
        updated[i + 1] = { ...updated[i + 1], superset_id: null };
      } else {
        updated[i] = { ...updated[i], superset_id: null };
      }
    } else if (ex.superset_id) {
      updated[i + 1] = { ...updated[i + 1], superset_id: ex.superset_id };
    } else {
      const ssId = makeId('ss');
      updated[i] = { ...updated[i], superset_id: ssId };
      updated[i + 1] = { ...updated[i + 1], superset_id: ssId };
    }
    onChange(updated);
  };

  const patchOverride = (exerciseIdx: number, blockIndex: number, p: Partial<PTProgrammeExerciseBlockOverride>) => {
    const ex = exercises[exerciseIdx];
    const overrides = [...(ex.week_overrides ?? [])];
    const idx = overrides.findIndex((o) => o.block_index === blockIndex);
    if (idx >= 0) {
      overrides[idx] = { ...overrides[idx], ...p };
    } else {
      overrides.push({ block_index: blockIndex, ...p });
    }
    patch(exerciseIdx, { week_overrides: overrides });
  };

  const getSupersetLabel = (ex: PTProgrammeExercise, idx: number): string | null => {
    if (!ex.superset_id) return null;
    const groupBefore = exercises.slice(0, idx).filter((e) => e.superset_id === ex.superset_id);
    return String.fromCharCode(65 + groupBefore.length);
  };

  return (
    <div>
      {/* Block selector */}
      {blocks.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveBlock(-1)}
            className={`px-3 py-1.5 text-xs border transition-colors ${activeBlock === -1 ? 'bg-black text-white border-black' : 'border-black/15 hover:border-black/30'}`}
          >
            All
          </button>
          {blocks.map((b) => (
            <button
              key={b.blockIndex}
              type="button"
              onClick={() => setActiveBlock(b.blockIndex)}
              className={`px-3 py-1.5 text-xs border transition-colors ${activeBlock === b.blockIndex ? 'bg-black text-white border-black' : 'border-black/15 hover:border-black/30'}`}
            >
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

      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Exercises</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => addSection(exercises.length)}
            className="border border-black/10 px-2.5 py-1.5 text-xs hover:border-black/30 text-black/50"
          >
            + Section
          </button>
          <select
            className="border border-black/10 px-3 py-1.5 text-xs outline-none"
            defaultValue=""
            onChange={(e) => { addFromLibrary(e.target.value); e.target.value = ''; }}
          >
            <option value="">+ From library</option>
            {libraryExercises.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </select>
          <button type="button" onClick={addBlank} className="border border-black/10 px-3 py-1.5 text-xs hover:border-black/30">
            + Custom
          </button>
        </div>
      </div>

      {/* Exercise list */}
      <div className="space-y-1">
        {exercises.length === 0 && (
          <p className="text-xs text-black/30 py-4 text-center border border-black/8 border-dashed">
            No exercises yet. Add from the library or create custom.
          </p>
        )}

        {exercises.map((ex, idx) => {
          const ssLabel = getSupersetLabel(ex, idx);
          const isFirstInGroup = ex.superset_id && (idx === 0 || exercises[idx - 1]?.superset_id !== ex.superset_id);
          const isLastInGroup = ex.superset_id && (idx === exercises.length - 1 || exercises[idx + 1]?.superset_id !== ex.superset_id);
          const isInGroup = !!ex.superset_id;

          const overrideForBlock = activeBlock >= 0
            ? (ex.week_overrides?.find((o) => o.block_index === activeBlock) ?? null)
            : null;

          const displaySets = overrideForBlock?.sets ?? ex.sets;
          const displayReps = overrideForBlock?.reps ?? ex.reps;
          const displayWeightPct = overrideForBlock?.weight_pct ?? '';
          const displayNotes = overrideForBlock?.notes ?? ex.notes;

          const isExpanded = expanded.has(ex.id);

          return (
            <div key={ex.id}>
              {/* Section header */}
              {ex.section_start !== undefined && (
                <div className="flex items-center gap-2 mt-4 mb-2 group">
                  <div className="flex-1 h-px bg-black/10" />
                  <input
                    value={ex.section_start}
                    onChange={(e) => patch(idx, { section_start: e.target.value })}
                    className="text-[0.6rem] uppercase tracking-[0.15em] text-black/50 font-medium bg-transparent border-b border-transparent focus:border-black/20 outline-none px-1 min-w-[80px]"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 h-px bg-black/10" />
                  <button
                    type="button"
                    onClick={() => patch(idx, { section_start: undefined })}
                    className="text-black/20 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Superset bracket top */}
              {isFirstInGroup && (
                <div className="ml-5 flex items-center gap-1 mt-1">
                  <div className="w-px h-3 bg-black/20 ml-1" />
                  <span className="text-[0.55rem] uppercase tracking-[0.15em] text-black/30">Superset</span>
                </div>
              )}

              <div
                className={`flex items-stretch gap-1 ${isInGroup ? 'ml-5 border-l-2 border-black/15 pl-2' : ''}`}
                draggable
                onDragStart={() => setDragged(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(idx)}
              >
                {/* SS label */}
                {ssLabel && (
                  <div className="w-5 flex items-center justify-center">
                    <span className="text-[0.55rem] font-bold text-black/40">{ssLabel}</span>
                  </div>
                )}

                <div className="flex-1 border border-black/10 bg-[#fafaf8]">
                  {/* Main row */}
                  <div className={`grid gap-2 items-center p-2 ${activeBlock >= 0 ? 'grid-cols-[1.5rem_1fr_4rem_5rem_4rem_5rem_5rem_1.5rem_1.5rem]' : 'grid-cols-[1.5rem_1fr_4rem_5rem_5rem_5rem_1.5rem_1.5rem]'}`}>
                    <span className="text-black/20 text-sm select-none cursor-grab">⠿</span>
                    <input
                      value={ex.name}
                      onChange={(e) => patch(idx, { name: e.target.value })}
                      placeholder="Exercise name"
                      className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 bg-white"
                    />
                    <input
                      value={displaySets}
                      onChange={(e) => {
                        if (activeBlock >= 0) patchOverride(idx, activeBlock, { sets: e.target.value });
                        else patch(idx, { sets: e.target.value });
                      }}
                      placeholder="Sets"
                      className={`border px-2 py-1.5 text-sm outline-none text-center bg-white ${activeBlock >= 0 ? 'border-black/30 bg-amber-50' : 'border-black/10 focus:border-black/30'}`}
                    />
                    <input
                      value={displayReps}
                      onChange={(e) => {
                        if (activeBlock >= 0) patchOverride(idx, activeBlock, { reps: e.target.value });
                        else patch(idx, { reps: e.target.value });
                      }}
                      placeholder="Reps"
                      className={`border px-2 py-1.5 text-sm outline-none text-center bg-white ${activeBlock >= 0 ? 'border-black/30 bg-amber-50' : 'border-black/10 focus:border-black/30'}`}
                    />
                    {activeBlock >= 0 && (
                      <input
                        value={displayWeightPct}
                        onChange={(e) => patchOverride(idx, activeBlock, { weight_pct: e.target.value })}
                        placeholder="% 1RM"
                        className="border border-black/30 bg-amber-50 px-2 py-1.5 text-sm outline-none text-center"
                      />
                    )}
                    <input
                      value={ex.rest}
                      onChange={(e) => patch(idx, { rest: e.target.value })}
                      placeholder="Rest"
                      className="border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-black/30 text-center bg-white"
                    />
                    <input
                      value={displayNotes}
                      onChange={(e) => {
                        if (activeBlock >= 0) patchOverride(idx, activeBlock, { notes: e.target.value });
                        else patch(idx, { notes: e.target.value });
                      }}
                      placeholder="Notes"
                      className={`border px-2 py-1.5 text-sm outline-none bg-white ${activeBlock >= 0 ? 'border-black/30 bg-amber-50' : 'border-black/10 focus:border-black/30'}`}
                    />
                    {/* Overrides toggle */}
                    {weekBlocks && weekBlocks.length > 0 && (
                      <button
                        type="button"
                        title="Per-block overrides"
                        onClick={() => setExpanded((s) => {
                          const n = new Set(s);
                          n.has(ex.id) ? n.delete(ex.id) : n.add(ex.id);
                          return n;
                        })}
                        className={`text-xs transition-colors ${isExpanded ? 'text-black' : 'text-black/25 hover:text-black/50'}`}
                      >
                        ▾
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="text-black/20 hover:text-red-500 transition-colors text-sm"
                    >
                      ×
                    </button>
                  </div>

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
                              <input
                                value={ov?.sets ?? ''}
                                onChange={(e) => patchOverride(idx, b.blockIndex, { sets: e.target.value })}
                                placeholder={weekBlocks[b.blockIndex]?.sets ?? 'Sets'}
                                className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center"
                              />
                              <input
                                value={ov?.reps ?? ''}
                                onChange={(e) => patchOverride(idx, b.blockIndex, { reps: e.target.value })}
                                placeholder={ex.reps || 'Reps'}
                                className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center"
                              />
                              <input
                                value={ov?.weight_pct ?? ''}
                                onChange={(e) => patchOverride(idx, b.blockIndex, { weight_pct: e.target.value })}
                                placeholder="% 1RM"
                                className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30 text-center"
                              />
                              <input
                                value={ov?.notes ?? ''}
                                onChange={(e) => patchOverride(idx, b.blockIndex, { notes: e.target.value })}
                                placeholder="Notes"
                                className="border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-black/30"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Superset bracket bottom */}
              {isLastInGroup && (
                <div className="ml-5 flex items-center gap-1 mb-1">
                  <div className="w-px h-3 bg-black/20 ml-1" />
                </div>
              )}

              {/* Superset link button between exercises */}
              {idx < exercises.length - 1 && (
                <div className="flex items-center my-0.5 pl-1">
                  <button
                    type="button"
                    title={ex.superset_id && ex.superset_id === exercises[idx + 1]?.superset_id ? 'Remove superset' : 'Link as superset'}
                    onClick={() => toggleSuperset(idx)}
                    className={`text-[0.55rem] uppercase tracking-[0.1em] px-2 py-0.5 border transition-colors ${
                      ex.superset_id && ex.superset_id === exercises[idx + 1]?.superset_id
                        ? 'border-black/30 text-black/50 bg-black/5'
                        : 'border-black/8 text-black/20 hover:border-black/20 hover:text-black/40'
                    }`}
                  >
                    {ex.superset_id && ex.superset_id === exercises[idx + 1]?.superset_id ? '⟂ superset' : '+ superset'}
                  </button>
                  <button
                    type="button"
                    title="Add section header before next exercise"
                    onClick={() => addSection(idx + 1)}
                    className="ml-2 text-[0.55rem] uppercase tracking-[0.1em] px-2 py-0.5 border border-black/8 text-black/20 hover:border-black/20 hover:text-black/40 transition-colors"
                  >
                    + section
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
