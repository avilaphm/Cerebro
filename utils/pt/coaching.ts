import type { PTClientGoal, PTClientMetric, PTCoachingReview, PTWeeklyPlan, PTWeeklyPlanItem } from './types';

export function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function weekStartInputValue(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return dateInputValue(next);
}

export function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return dateInputValue(next);
}

export function monthStartInputValue(value: string | Date) {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : new Date(value);
  return dateInputValue(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function monthEndInputValue(value: string | Date) {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : new Date(value);
  return dateInputValue(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export interface AdherenceSnapshot {
  total: number;
  done: number;
  skipped: number;
  pending: number;
  adherencePct: number | null;
}

export function computeAdherenceSnapshot(
  items: PTWeeklyPlanItem[],
  plans: PTWeeklyPlan[],
  start: string,
  end: string,
) : AdherenceSnapshot {
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const relevant = items.filter((item) => {
    const scheduled = item.scheduled_date;
    if (scheduled && scheduled >= start && scheduled <= end) return true;
    const plan = plansById.get(item.plan_id);
    return Boolean(plan && plan.week_start >= start && plan.week_start <= end);
  });

  const total = relevant.length;
  const done = relevant.filter((item) => item.status === 'done').length;
  const skipped = relevant.filter((item) => item.status === 'skipped').length;
  const pending = relevant.filter((item) => item.status === 'planned' || item.status === 'moved').length;

  return {
    total,
    done,
    skipped,
    pending,
    adherencePct: total > 0 ? Math.round((done / total) * 100) : null,
  };
}

type GoalMetricKey = 'weight_kg' | 'waist_cm' | 'body_fat_pct' | 'muscle_mass_kg';

function metricKeyFromGoal(goal: PTClientGoal): GoalMetricKey | null {
  const value = goal.goal_type.trim().toLowerCase();
  if (value === 'weight' || value === 'weight_kg') return 'weight_kg';
  if (value === 'waist' || value === 'waist_cm') return 'waist_cm';
  if (value === 'body_fat' || value === 'body_fat_pct') return 'body_fat_pct';
  if (value === 'muscle' || value === 'muscle_mass' || value === 'muscle_mass_kg') return 'muscle_mass_kg';
  return null;
}

export function getGoalCurrentValue(goal: PTClientGoal, metrics: PTClientMetric[]) {
  const metricKey = metricKeyFromGoal(goal);
  if (!metricKey) return goal.current_value;
  const latestMetric = metrics.find((metric) => metric[metricKey] !== null && metric[metricKey] !== undefined);
  return latestMetric?.[metricKey] ?? goal.current_value;
}

export function getGoalProgressLabel(goal: PTClientGoal, metrics: PTClientMetric[]) {
  const currentValue = getGoalCurrentValue(goal, metrics);
  const bits = [
    currentValue !== null ? `Now ${currentValue}${goal.unit ?? ''}` : null,
    goal.target_value !== null ? `Target ${goal.target_value}${goal.unit ?? ''}` : null,
    goal.target_date ? `By ${formatShortDate(goal.target_date)}` : null,
  ].filter(Boolean);
  return bits.join(' / ') || goal.notes || 'Active goal';
}

export function getMetricDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null || current === undefined || previous === undefined) return null;
  const delta = Number(current) - Number(previous);
  if (delta === 0) return 0;
  return Number(delta.toFixed(1));
}

export function latestMetricPair(metrics: PTClientMetric[], key: GoalMetricKey) {
  const relevant = metrics.filter((metric) => metric[key] !== null && metric[key] !== undefined);
  return {
    current: relevant[0] ?? null,
    previous: relevant[1] ?? null,
  };
}

export function latestReviewByType(reviews: PTCoachingReview[], reviewType: PTCoachingReview['review_type']) {
  return reviews.find((review) => review.review_type === reviewType && review.status !== 'archived') ?? null;
}
