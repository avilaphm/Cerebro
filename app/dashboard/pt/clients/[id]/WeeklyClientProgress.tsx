'use client';

import { useState } from 'react';
import type { NutritionTargets } from '@/utils/pt/nutritionTargets';
import NutritionTargetEditor from './NutritionTargetEditor';

interface FoodItem {
  name: string;
  quantity: string;
  unit: string;
}

export interface WeeklyNutritionLog {
  id: string;
  logged_at: string;
  meal_type: string | null;
  meal_description: string | null;
  food_items: FoodItem[];
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  calories: number | null;
  input_type: string;
}

export interface WeeklyWorkoutLog {
  id: string;
  completed_at: string;
  workout_title: string;
  notes: string | null;
  phase_index: number;
  day_index: number;
}

export interface WeeklySetLog {
  id?: string;
  workout_log_id?: string;
  exercise_name: string;
  set_number?: number;
  reps: number | null;
  weight: number | null;
  notes?: string | null;
  created_at: string;
}

interface Props {
  clientId: string;
  nutritionLogs: WeeklyNutritionLog[];
  workoutLogs: WeeklyWorkoutLog[];
  weeklySetLogs: WeeklySetLog[];
  priorSetLogs: WeeklySetLog[];
  dailyTargets: Partial<NutritionTargets> | null;
}

const SYDNEY_TIME_ZONE = 'Australia/Sydney';

function sydneyDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDateKeyDays(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDay(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function round(value: number) {
  return Math.round(value);
}

function estimatedOneRm(weight: number | null, reps: number | null) {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  return weight * (1 + reps / 30);
}

function exerciseKey(name: string) {
  return name.trim().toLowerCase();
}

function hitLabel(hit: boolean, hasLogs: boolean, hasTarget: boolean) {
  if (!hasLogs) return 'No logs';
  if (!hasTarget) return 'No target';
  return hit ? 'Hit' : 'Below';
}

function hitClasses(hit: boolean, hasLogs: boolean, hasTarget: boolean) {
  if (!hasLogs || !hasTarget) return 'border-black/8 bg-black/[0.025] text-black/35';
  return hit
    ? 'border-green-200 bg-green-50 text-green-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="m7 9 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function WeeklyClientProgress({
  clientId,
  nutritionLogs,
  workoutLogs,
  weeklySetLogs,
  priorSetLogs,
  dailyTargets,
}: Props) {
  const [effectiveDailyTargets, setEffectiveDailyTargets] = useState(dailyTargets);

  const today = sydneyDateKey(new Date());
  const dayKeys = Array.from({ length: 7 }, (_, index) => addDateKeyDays(today, index - 6));
  const firstDay = dayKeys[0];
  const dayKeySet = new Set(dayKeys);
  const proteinTarget = effectiveDailyTargets?.protein_g ?? null;
  const calorieTarget = effectiveDailyTargets?.calories ?? null;

  const visibleNutritionLogs = nutritionLogs.filter((log) => dayKeySet.has(sydneyDateKey(log.logged_at)));
  const visibleWorkoutLogs = workoutLogs.filter((log) => dayKeySet.has(sydneyDateKey(log.completed_at)));
  const visibleWorkoutIds = new Set(visibleWorkoutLogs.map((log) => log.id));
  const visibleSetLogs = weeklySetLogs.filter((log) => log.workout_log_id && visibleWorkoutIds.has(log.workout_log_id));
  const baselineSetLogs = [
    ...priorSetLogs,
    ...weeklySetLogs.filter((log) => sydneyDateKey(log.created_at) < firstDay),
  ];

  const priorBestByExercise = new Map<string, number>();
  baselineSetLogs.forEach((set) => {
    const estimate = estimatedOneRm(set.weight, set.reps);
    if (estimate === null) return;
    const key = exerciseKey(set.exercise_name);
    priorBestByExercise.set(key, Math.max(priorBestByExercise.get(key) ?? 0, estimate));
  });

  const weeklyBestByExercise = new Map<string, { exercise: string; estimate: number; workoutId: string }>();
  visibleSetLogs.forEach((set) => {
    const estimate = estimatedOneRm(set.weight, set.reps);
    if (estimate === null || !set.workout_log_id) return;
    const key = exerciseKey(set.exercise_name);
    const current = weeklyBestByExercise.get(key);
    if (!current || estimate > current.estimate) {
      weeklyBestByExercise.set(key, { exercise: set.exercise_name, estimate, workoutId: set.workout_log_id });
    }
  });

  const pbs = [...weeklyBestByExercise.entries()]
    .filter(([key, current]) => {
      const prior = priorBestByExercise.get(key);
      return prior !== undefined && current.estimate > prior;
    })
    .map(([key, current]) => ({ ...current, key, prior: priorBestByExercise.get(key) ?? 0 }));
  const pbKeys = new Set(pbs.map((pb) => pb.key));

  const dailyNutrition = dayKeys.map((day) => {
    const logs = visibleNutritionLogs.filter((log) => sydneyDateKey(log.logged_at) === day);
    const protein = round(logs.reduce((total, log) => total + Number(log.protein_g ?? 0), 0));
    const calories = round(logs.reduce((total, log) => total + Number(log.calories ?? 0), 0));
    return {
      day,
      logs,
      protein,
      calories,
      proteinHit: proteinTarget !== null && protein >= proteinTarget,
      calorieHit: calorieTarget !== null && calories >= calorieTarget * 0.9 && calories <= calorieTarget * 1.1,
    };
  });

  const trackedDays = dailyNutrition.filter((day) => day.logs.length > 0);
  const proteinHitDays = trackedDays.filter((day) => day.proteinHit).length;
  const calorieHitDays = trackedDays.filter((day) => day.calorieHit).length;
  const averageProtein = trackedDays.length > 0
    ? round(trackedDays.reduce((total, day) => total + day.protein, 0) / trackedDays.length)
    : 0;
  const averageCalories = trackedDays.length > 0
    ? round(trackedDays.reduce((total, day) => total + day.calories, 0) / trackedDays.length)
    : 0;

  return (
    <section id="weekly-progress" className="mb-8 scroll-mt-6 border-t border-black/8 pt-6">
      <div className="mb-4">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Weekly progress</p>
        <p className="mt-1 text-xs text-black/40">{formatDay(firstDay)} - {formatDay(today)}</p>
      </div>

      <div className="grid gap-4">
        <div className="border border-black/10 bg-white px-5 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Nutrition - last 7 days</p>
              <p className="mt-1 text-sm text-black/55">Open a day to review meals and estimated macros.</p>
            </div>
            <span className="w-fit border border-black/10 bg-[#fbfbf8] px-2 py-1 text-xs text-black/55">
              {trackedDays.length}/7 days tracked
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Protein target</p>
              <p className="mt-1 text-lg font-medium">{proteinHitDays}/{trackedDays.length || 0}</p>
              <p className="text-xs text-black/40">{proteinTarget ? `${proteinTarget}g daily target` : 'No daily target'}</p>
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Calorie range</p>
              <p className="mt-1 text-lg font-medium">{calorieHitDays}/{trackedDays.length || 0}</p>
              <p className="text-xs text-black/40">{calorieTarget ? `${calorieTarget} kcal +/- 10%` : 'No daily target'}</p>
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Daily average</p>
              <p className="mt-1 text-sm font-medium">{averageProtein}g protein</p>
              <p className="text-xs text-black/40">{averageCalories} kcal</p>
            </div>
          </div>

          <NutritionTargetEditor
            clientId={clientId}
            initialTargets={effectiveDailyTargets}
            onSaved={setEffectiveDailyTargets}
          />

          <div className="mt-4 divide-y divide-black/8 border-y border-black/8">
            {dailyNutrition.map((day) => (
              <details key={day.day} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-1 py-3 marker:hidden">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-black/75">{formatDay(day.day)}</span>
                    <span className="mt-0.5 block text-xs text-black/35">{day.logs.length} meal{day.logs.length !== 1 ? 's' : ''}</span>
                  </span>
                  <span className="flex flex-wrap justify-end gap-1.5 text-[0.6rem] uppercase tracking-[0.08em]">
                    <span className={`border px-2 py-0.5 ${hitClasses(day.proteinHit, day.logs.length > 0, proteinTarget !== null)}`}>
                      Protein {day.protein}g {hitLabel(day.proteinHit, day.logs.length > 0, proteinTarget !== null)}
                    </span>
                    <span className={`border px-2 py-0.5 ${hitClasses(day.calorieHit, day.logs.length > 0, calorieTarget !== null)}`}>
                      {day.calories} kcal {hitLabel(day.calorieHit, day.logs.length > 0, calorieTarget !== null)}
                    </span>
                    <span className="px-1 text-black/30"><Chevron /></span>
                  </span>
                </summary>
                <div className="space-y-2 pb-3">
                  {day.logs.length > 0 ? day.logs.map((log) => (
                    <div key={log.id} className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium capitalize text-black/70">{log.meal_type || 'Meal'}</p>
                        <p className="text-[0.6rem] uppercase tracking-[0.08em] text-black/35">{log.input_type}</p>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-black/55">{log.meal_description || 'No description saved.'}</p>
                      <p className="mt-2 text-xs text-black/45">
                        {round(Number(log.protein_g ?? 0))}g protein / {round(Number(log.carbs_g ?? 0))}g carbs / {round(Number(log.fat_g ?? 0))}g fat / {round(Number(log.calories ?? 0))} kcal
                      </p>
                      {log.food_items.length > 0 && (
                        <p className="mt-1 text-[0.68rem] leading-relaxed text-black/35">
                          {log.food_items.map((item) => `${item.name} (${item.quantity}${item.unit ? ` ${item.unit}` : ''})`).join(' / ')}
                        </p>
                      )}
                    </div>
                  )) : (
                    <p className="px-1 pb-1 text-xs text-black/35">No meals tracked.</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>

        <div className="border border-black/10 bg-white px-5 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Training - last 7 days</p>
              <p className="mt-1 text-sm text-black/55">Open a workout to review exercises, sets, and progress.</p>
            </div>
            <span className="w-fit border border-black/10 bg-[#fbfbf8] px-2 py-1 text-xs text-black/55">
              {visibleWorkoutLogs.length} workout{visibleWorkoutLogs.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Completed</p>
              <p className="mt-1 text-lg font-medium">{visibleWorkoutLogs.length}</p>
              <p className="text-xs text-black/40">workouts logged</p>
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Volume detail</p>
              <p className="mt-1 text-lg font-medium">{visibleSetLogs.length}</p>
              <p className="text-xs text-black/40">sets logged</p>
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35">Personal bests</p>
              <p className="mt-1 text-lg font-medium">{pbs.length}</p>
              <p className="text-xs text-black/40">exercise PBs</p>
            </div>
          </div>

          {pbs.length > 0 && (
            <div className="mt-4 border border-green-200 bg-green-50 px-3 py-3">
              <p className="text-[0.58rem] uppercase tracking-[0.12em] text-green-700">PBs this week</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pbs.map((pb) => (
                  <span key={pb.key} className="border border-green-200 bg-white px-2 py-1 text-xs text-green-700">
                    {pb.exercise} +{round(pb.estimate - pb.prior)}kg est. 1RM
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 divide-y divide-black/8 border-y border-black/8">
            {visibleWorkoutLogs.length > 0 ? visibleWorkoutLogs.map((workout) => {
              const sets = visibleSetLogs.filter((set) => set.workout_log_id === workout.id);
              const exercises = [...new Set(sets.map((set) => set.exercise_name))];
              return (
                <details key={workout.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-1 py-3 marker:hidden">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-black/75">{workout.workout_title}</span>
                      <span className="mt-0.5 block text-xs text-black/35">{formatDay(sydneyDateKey(workout.completed_at))} / {sets.length} sets</span>
                    </span>
                    <span className="px-1 text-black/30"><Chevron /></span>
                  </summary>
                  <div className="space-y-2 pb-3">
                    {exercises.length > 0 ? exercises.map((exercise) => {
                      const exerciseSets = sets.filter((set) => set.exercise_name === exercise);
                      const hasPb = pbKeys.has(exerciseKey(exercise));
                      return (
                        <div key={exercise} className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium text-black/70">{exercise}</p>
                            {hasPb && (
                              <span className="border border-green-200 bg-green-50 px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.08em] text-green-700">
                                PB
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {exerciseSets.map((set, index) => (
                              <span key={set.id ?? `${exercise}-${index}`} className="border border-black/8 bg-white px-2 py-1 text-xs text-black/55">
                                Set {set.set_number ?? index + 1}: {set.weight !== null ? `${set.weight}kg` : 'BW'} x {set.reps ?? '-'}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }) : (
                      <p className="px-1 pb-1 text-xs text-black/35">Workout completed without set detail.</p>
                    )}
                  </div>
                </details>
              );
            }) : (
              <p className="px-1 py-3 text-xs text-black/35">No workouts logged in the last seven days.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
