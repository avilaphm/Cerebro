'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

type PatternKey = 'push' | 'pull' | 'hinge' | 'squat' | 'other';
type Variant = 'client' | 'coach';

interface TonnageSummary {
  label: string;
  total_kg: number;
  by_pattern: Record<PatternKey, number>;
  excluded: Array<{ exercise_name: string; reason: string; sets: number }>;
  bodyweight_missing: boolean;
  workout_count: number;
  set_count: number;
}

interface TonnageResponse {
  ok?: boolean;
  error?: string;
  previous_week?: TonnageSummary;
  month_to_date?: TonnageSummary;
}

interface Props {
  clientId: string;
  variant?: Variant;
  className?: string;
  defaultOpen?: boolean;
  refreshKey?: string | number;
}

const PATTERNS: Array<{ key: PatternKey; label: string }> = [
  { key: 'push', label: 'Push' },
  { key: 'pull', label: 'Pull' },
  { key: 'hinge', label: 'Hinge' },
  { key: 'squat', label: 'Squat' },
];

const kgFormatter = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });

function formatKg(value: number | null | undefined): string {
  return `${kgFormatter.format(Math.round(value ?? 0))} kg`;
}

function excludedSetCount(summary: TonnageSummary | null): number {
  return summary?.excluded.reduce((total, item) => total + item.sets, 0) ?? 0;
}

export default function TonnageSummaryCard({
  clientId,
  variant = 'client',
  className = '',
  defaultOpen = false,
  refreshKey,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [previousWeek, setPreviousWeek] = useState<TonnageSummary | null>(null);
  const [monthToDate, setMonthToDate] = useState<TonnageSummary | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: invokeError } = await supabase.functions.invoke<TonnageResponse>('compute-client-tonnage', {
        body: { client_id: clientId },
      });
      if (!active) return;

      if (invokeError || data?.ok === false) {
        setError(invokeError?.message ?? data?.error ?? 'Could not load kilos moved.');
        setPreviousWeek(null);
        setMonthToDate(null);
      } else {
        setPreviousWeek(data?.previous_week ?? null);
        setMonthToDate(data?.month_to_date ?? null);
      }
      setLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [clientId, refreshKey, retryCount, supabase]);

  const patternRows = useMemo(() => {
    const values = previousWeek?.by_pattern ?? { push: 0, pull: 0, hinge: 0, squat: 0, other: 0 };
    const rows = PATTERNS.map((item) => ({ ...item, value: values[item.key] ?? 0 }));
    if ((values.other ?? 0) > 0) rows.push({ key: 'other', label: 'Other', value: values.other });
    return rows;
  }, [previousWeek]);

  const maxPatternValue = Math.max(...patternRows.map((row) => row.value), 0);
  const warningVisible = Boolean(previousWeek?.bodyweight_missing || monthToDate?.bodyweight_missing);
  const excludedCount = excludedSetCount(previousWeek);
  const title = variant === 'coach' ? 'Kilos moved' : 'You moved';
  const containerClass = variant === 'coach'
    ? 'border border-black/10 bg-white px-6 py-5'
    : 'border border-black/10 bg-white';

  if (loading) {
    return (
      <section className={`${containerClass} ${className}`}>
        <div className={variant === 'coach' ? '' : 'p-5 md:p-6'}>
          <div className="h-2 w-24 bg-black/10" />
          <div className="mt-4 h-8 w-40 bg-black/10" />
          <div className="mt-3 h-3 w-56 bg-black/8" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={`${containerClass} ${className}`}>
        <button
          type="button"
          onClick={() => setRetryCount((current) => current + 1)}
          className={variant === 'coach' ? 'w-full text-left' : 'w-full p-5 text-left md:p-6'}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Kilos moved</p>
              <p className="mt-2 text-sm text-black/45">{error}</p>
            </div>
            <RefreshCw className="h-4 w-4 shrink-0 text-black/30" />
          </div>
        </button>
      </section>
    );
  }

  return (
    <section className={`${containerClass} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={variant === 'coach' ? 'w-full text-left' : 'w-full p-5 text-left md:p-6'}
        aria-expanded={open}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">{title}</p>
            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="font-display text-3xl font-light leading-none text-black">
                {formatKg(previousWeek?.total_kg)}
              </p>
              <p className="pb-0.5 text-xs text-black/45">last week</p>
            </div>
            <p className="mt-2 text-xs text-black/45">
              {previousWeek?.label ?? 'Previous week'} · {formatKg(monthToDate?.total_kg)} month to date
            </p>
          </div>
          <ChevronRight className={`mt-1 h-5 w-5 shrink-0 text-black/35 transition-transform ${open ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {open && (
        <div className={variant === 'coach' ? 'mt-4 border-t border-black/8 pt-4' : 'border-t border-black/8 px-5 pb-5 pt-4 md:px-6 md:pb-6'}>
          <div className="space-y-3">
            {patternRows.map((row) => {
              const width = maxPatternValue > 0 ? Math.max(4, Math.round((row.value / maxPatternValue) * 100)) : 0;
              return (
                <div key={row.key} className="grid grid-cols-[4.5rem_1fr_5rem] items-center gap-3">
                  <p className="text-xs font-medium text-black/65">{row.label}</p>
                  <div className="h-2 bg-black/6">
                    <div className="h-full bg-black transition-[width]" style={{ width: `${width}%` }} />
                  </div>
                  <p className="text-right text-xs tabular-nums text-black/55">{formatKg(row.value)}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.12em] text-black/35">
            <span>{previousWeek?.workout_count ?? 0} workout{previousWeek?.workout_count === 1 ? '' : 's'}</span>
            <span>{previousWeek?.set_count ?? 0} counted set{previousWeek?.set_count === 1 ? '' : 's'}</span>
            {variant === 'coach' && excludedCount > 0 && <span>{excludedCount} excluded set{excludedCount === 1 ? '' : 's'}</span>}
          </div>

          {warningVisible && (
            <p className="mt-3 text-xs leading-relaxed text-amber-700">
              Bodyweight exercises need a current weight before they can be fully counted.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
