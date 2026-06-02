import Link from 'next/link';
import type { PTClient } from '@/utils/pt/types';

interface DailyTargets {
  protein_g?: number;
  calories?: number;
}

export interface OverviewNutritionLog {
  client_id: string;
  logged_at: string;
  protein_g: number | null;
  calories: number | null;
}

export interface OverviewNutritionDoc {
  client_id: string;
  daily_targets: DailyTargets | null;
}

export interface OverviewWorkoutLog {
  client_id: string;
  workout_title: string;
  completed_at: string;
}

interface Props {
  clients: PTClient[];
  nutritionLogs: OverviewNutritionLog[];
  nutritionDocs: OverviewNutritionDoc[];
  workoutLogs: OverviewWorkoutLog[];
}

const SYDNEY_TIME_ZONE = 'Australia/Sydney';
const STATUS_ORDER: Record<PTClient['status'], number> = {
  active: 0,
  invited: 1,
  paused: 2,
  archived: 3,
};
const STATUS_CLASSES: Record<PTClient['status'], string> = {
  active: 'border-green-200 bg-green-50 text-green-700',
  invited: 'border-blue-200 bg-blue-50 text-blue-700',
  paused: 'border-amber-200 bg-amber-50 text-amber-700',
  archived: 'border-black/8 bg-black/[0.025] text-black/35',
};

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
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function round(value: number) {
  return Math.round(value);
}

export default function ClientWeeklyOverview({ clients, nutritionLogs, nutritionDocs, workoutLogs }: Props) {
  const today = sydneyDateKey(new Date());
  const dayKeys = Array.from({ length: 7 }, (_, index) => addDateKeyDays(today, index - 6));
  const dayKeySet = new Set(dayKeys);
  const firstDay = dayKeys[0];
  const visibleNutritionLogs = nutritionLogs.filter((log) => dayKeySet.has(sydneyDateKey(log.logged_at)));
  const visibleWorkoutLogs = workoutLogs.filter((log) => dayKeySet.has(sydneyDateKey(log.completed_at)));
  const sortedClients = [...clients].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return statusDiff || a.name.localeCompare(b.name);
  });

  const rows = sortedClients.map((client) => {
    const clientNutritionLogs = visibleNutritionLogs.filter((log) => log.client_id === client.id);
    const nutritionDoc = nutritionDocs.find((doc) => doc.client_id === client.id);
    const proteinTarget = nutritionDoc?.daily_targets?.protein_g ?? null;
    const calorieTarget = nutritionDoc?.daily_targets?.calories ?? null;
    const nutritionDays = dayKeys.map((day) => {
      const logs = clientNutritionLogs.filter((log) => sydneyDateKey(log.logged_at) === day);
      return {
        logs,
        protein: round(logs.reduce((total, log) => total + Number(log.protein_g ?? 0), 0)),
        calories: round(logs.reduce((total, log) => total + Number(log.calories ?? 0), 0)),
      };
    });
    const trackedDays = nutritionDays.filter((day) => day.logs.length > 0);
    const proteinHitDays = trackedDays.filter((day) => proteinTarget !== null && day.protein >= proteinTarget).length;
    const calorieHitDays = trackedDays.filter((day) => (
      calorieTarget !== null && day.calories >= calorieTarget * 0.9 && day.calories <= calorieTarget * 1.1
    )).length;
    const clientWorkouts = visibleWorkoutLogs
      .filter((log) => log.client_id === client.id)
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at));

    return {
      client,
      trackedDays: trackedDays.length,
      proteinHitDays,
      calorieHitDays,
      proteinTarget,
      calorieTarget,
      workouts: clientWorkouts,
    };
  });

  const nutritionTrackingClients = rows.filter((row) => row.trackedDays > 0).length;
  const trainingClients = rows.filter((row) => row.workouts.length > 0).length;

  return (
    <section className="mb-12 border border-black/10 bg-white">
      <div className="flex flex-col gap-3 border-b border-black/8 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Client tracking</p>
          <h2 className="mt-1 text-lg font-medium">Weekly client overview</h2>
          <p className="mt-1 text-xs text-black/40">Open a client for meal, workout, set, and PB detail.</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs font-medium text-black/65">{formatDay(firstDay)} - {formatDay(today)}</p>
          <p className="mt-1 text-[0.62rem] uppercase tracking-[0.12em] text-black/35">
            {nutritionTrackingClients}/{rows.length} tracking nutrition / {trainingClients}/{rows.length} trained
          </p>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(170px,0.9fr)_minmax(320px,1.45fr)_minmax(210px,0.85fr)] gap-4 border-b border-black/8 bg-[#fbfbf8] px-5 py-2.5 text-[0.58rem] uppercase tracking-[0.16em] text-black/35 lg:grid">
        <p>Client</p>
        <p>Nutrition tracking</p>
        <p>Workout tracking</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-black/35">No clients available.</p>
      ) : (
        <div className="divide-y divide-black/8">
          {rows.map((row) => {
            const lastWorkout = row.workouts[0];
            return (
              <div
                key={row.client.id}
                className="grid gap-4 px-4 py-4 transition-colors hover:bg-[#fbfbf8] lg:grid-cols-[minmax(170px,0.9fr)_minmax(320px,1.45fr)_minmax(210px,0.85fr)] lg:px-5"
              >
                <div className="min-w-0">
                  <Link
                    className="text-sm font-semibold text-black underline decoration-black/15 underline-offset-4 transition-colors hover:decoration-black"
                    href={`/dashboard/pt/clients/${row.client.id}#weekly-progress`}
                  >
                    {row.client.name}
                  </Link>
                  <p className="mt-1 truncate text-xs text-black/35">{row.client.email}</p>
                  <span className={`mt-2 inline-block border px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.12em] ${STATUS_CLASSES[row.client.status]}`}>
                    {row.client.status}
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="mb-2 text-[0.56rem] uppercase tracking-[0.14em] text-black/35 lg:hidden">Nutrition tracking</p>
                  {row.trackedDays > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="border border-black/10 bg-[#fbfbf8] px-2 py-1 text-xs text-black/60">
                        {row.trackedDays}/7 days tracked
                      </span>
                      <span className="border border-black/10 bg-[#fbfbf8] px-2 py-1 text-xs text-black/60">
                        Protein {row.proteinTarget !== null ? `${row.proteinHitDays}/${row.trackedDays} hit` : 'no target'}
                      </span>
                      <span className="border border-black/10 bg-[#fbfbf8] px-2 py-1 text-xs text-black/60">
                        Calories {row.calorieTarget !== null ? `${row.calorieHitDays}/${row.trackedDays} in range` : 'no target'}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700">No nutrition tracked in the last seven days.</p>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="mb-2 text-[0.56rem] uppercase tracking-[0.14em] text-black/35 lg:hidden">Workout tracking</p>
                  {lastWorkout ? (
                    <>
                      <p className="text-sm font-medium text-black/70">
                        {row.workouts.length} workout{row.workouts.length !== 1 ? 's' : ''}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-black/40">
                        Last: {formatDay(sydneyDateKey(lastWorkout.completed_at))} / {lastWorkout.workout_title}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-amber-700">No workouts logged in the last seven days.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
