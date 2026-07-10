const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface Exercise {
  id?: string;
  exercise_id?: string | null;
  name?: string;
  sets?: string;
  reps?: string;
  notes?: string;
  section_start?: string | null;
  superset_id?: string | null;
  video_url?: string | null;
}

interface Day { id?: string; title?: string; exercises?: Exercise[]; }
interface Phase { id?: string; title?: string; weeks?: string; week_blocks?: { weeks: number; sets?: string; weight_pct?: string }[]; days?: Day[]; }
interface Programme { phases?: Phase[]; }

const BIG_5 = ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up'];

// Library exercises don't always use the "BB ..." label. Match by canonical
// names + common library aliases. Each Big 5 lift must satisfy at least one
// regex below.
const BIG_5_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'BB Squat', pattern: /(bb|barbell|back|front)\s*squat\b/i },
  { label: 'BB Deadlift', pattern: /(bb|barbell|conventional|romanian|trap bar|sumo)?\s*deadlift\b/i },
  { label: 'BB Bench Press', pattern: /(bb|barbell)?\s*bench\s*press\b/i },
  { label: 'BB Shoulder Press', pattern: /(bb|barbell|overhead|ohp)?\s*(shoulder|overhead)?\s*press\b/i },
  { label: 'Pull-up', pattern: /pull[-\s]?up|chin[-\s]?up/i },
];

function exerciseMatchesBig5(name: string, big5Label: string): boolean {
  const entry = BIG_5_PATTERNS.find((p) => p.label === big5Label);
  if (!entry) return false;
  return entry.pattern.test(name);
}

function phaseKind(title: string | undefined): 'foundation' | '1rm_test' | 'hypertrophy' | 'strength' | '1rm_retest' | 'other' {
  if (!title) return 'other';
  const t = title.toLowerCase();
  if (t.includes('foundation') || t.includes('phase 1')) return 'foundation';
  if (t.includes('retest') || t.includes('re-test') || t.includes('re test')) return '1rm_retest';
  if (t.includes('1rm') || t.includes('test')) return '1rm_test';
  if (t.includes('hypertrophy') || t.includes('phase 2')) return 'hypertrophy';
  if (t.includes('strength') || t.includes('phase 3')) return 'strength';
  return 'other';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');
  if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json() as {
      programme: Programme;
      emphasis?: { needs_cardio_block?: boolean; needs_mobility_block?: boolean };
      constraints?: { equipment?: string } | null;
      intent?: 'journey' | 'one_off';
      coach_directive?: string;
      bespoke?: boolean;
    };
    const programme = body.programme;
    if (!programme || !Array.isArray(programme.phases)) return json({ error: 'programme.phases required' }, 400);

    const bespoke = typeof body.bespoke === 'boolean' ? body.bespoke : isBespoke(body.constraints, body.intent, body.coach_directive ?? '');
    const hard_failures: string[] = [];
    const findings: string[] = [];

    if (programme.phases.length < 5) {
      hard_failures.push(`Programme has ${programme.phases.length} phases; expected at least 5 (Foundation, 1RM Test, Hypertrophy, Strength, Retest).`);
    }

    for (const phase of programme.phases) {
      const kind = phaseKind(phase.title);
      const phaseLabel = phase.title ?? '(untitled phase)';

      if (kind === 'foundation') {
        const days = (phase.days ?? []).length;
        if (days !== 3) hard_failures.push(`${phaseLabel}: must have exactly 3 workout days, has ${days}.`);
        const blocks = phase.week_blocks ?? [];
        if (blocks.length === 0) hard_failures.push(`${phaseLabel}: week_blocks missing.`);
        else {
          for (let i = 0; i < blocks.length; i++) {
            if (!blocks[i].sets) hard_failures.push(`${phaseLabel}: week_blocks[${i}].sets missing.`);
          }
        }
      }

      if (kind === 'hypertrophy' || kind === 'strength') {
        const blocks = phase.week_blocks ?? [];
        if (blocks.length === 0) hard_failures.push(`${phaseLabel}: week_blocks missing (Hypertrophy/Strength require them).`);
        else {
          for (let i = 0; i < blocks.length; i++) {
            if (!blocks[i].sets) hard_failures.push(`${phaseLabel}: week_blocks[${i}].sets missing.`);
            if (!blocks[i].weight_pct) hard_failures.push(`${phaseLabel}: week_blocks[${i}].weight_pct missing.`);
          }
        }

        // Validate Big 5 distribution at the phase level. Each Big 5 lift must
        // appear at least once across the whole phase (full body = each every
        // day; upper/lower = each twice/week; push/pull/legs = each twice/week).
        // Match via aliases since the library uses names like "Back Squat",
        // "Conventional Deadlift", "Barbell Bench Press" rather than "BB ...".
        const phaseExNames = (phase.days ?? []).flatMap((d) => (d.exercises ?? []).map((e) => e.name ?? ''));
        for (const big of BIG_5) {
          const occurrences = phaseExNames.filter((n) => exerciseMatchesBig5(n, big)).length;
          if (occurrences === 0) {
            hard_failures.push(`${phaseLabel}: Big 5 lift "${big}" never appears across the phase.`);
          } else if (occurrences === 1 && (phase.days ?? []).length > 1) {
            findings.push(`${phaseLabel}: Big 5 lift "${big}" only appears in 1 day; consider 2x/week frequency for hypertrophy adaptation.`);
          }
        }
      }

      if (kind === '1rm_test' || kind === '1rm_retest') {
        const days = phase.days ?? [];
        if (days.length !== 1) hard_failures.push(`${phaseLabel}: 1RM test/retest must be exactly 1 day, has ${days.length}.`);
        if (days[0]) {
          const exs = days[0].exercises ?? [];
          const big5Found = BIG_5.filter((b) => exs.some((e) => exerciseMatchesBig5(e.name ?? '', b)));
          if (big5Found.length < 5) hard_failures.push(`${phaseLabel}: 1RM day must contain all 5 Big 5 lifts, found ${big5Found.length}.`);
          for (const e of exs) {
            if (e.sets !== '5') findings.push(`${phaseLabel}: ${e.name ?? 'exercise'} should be 5 sets for 1RM, has ${e.sets ?? '?'}.`);
          }
        }
      }

      for (const day of phase.days ?? []) {
        const exs = day.exercises ?? [];
        for (const e of exs) {
          if (!e.exercise_id) hard_failures.push(`${phaseLabel} / ${day.title ?? 'day'} / ${e.name ?? 'exercise'}: missing exercise_id (no library link).`);
          if (!e.video_url && kind !== '1rm_test' && kind !== '1rm_retest') {
            findings.push(`${phaseLabel} / ${day.title ?? 'day'} / ${e.name ?? 'exercise'}: missing video_url.`);
          }
        }
        const warmupCount = exs.filter((e) => sectionFor(exs, exs.indexOf(e)) === 'Warm Up').length;
        const workoutCount = exs.filter((e) => sectionFor(exs, exs.indexOf(e)) === 'Workout').length;
        if (kind === 'foundation' || kind === 'hypertrophy' || kind === 'strength') {
          if (warmupCount !== 4) findings.push(`${phaseLabel} / ${day.title ?? 'day'}: warm-up has ${warmupCount} exercises (expected 4).`);
          if (workoutCount < 5 || workoutCount > 9) findings.push(`${phaseLabel} / ${day.title ?? 'day'}: workout has ${workoutCount} exercises (expected 5-9).`);
        }
        if (kind === 'foundation') {
          const unexpectedSections = Array.from(new Set(exs
            .map((e, idx) => sectionFor(exs, idx))
            .filter((section): section is string => Boolean(section) && section !== 'Warm Up' && section !== 'Workout')));
          if (unexpectedSections.length > 0) {
            hard_failures.push(`${phaseLabel} / ${day.title ?? 'day'}: Foundation must only contain Warm Up and Workout sections; found ${unexpectedSections.join(', ')}.`);
          }

          const workout = exs.filter((e) => sectionFor(exs, exs.indexOf(e)) === 'Workout');
          const familyCounts = new Map<string, number>();
          for (const exercise of workout) {
            const family = exerciseFamily(exercise.name ?? '');
            familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
          }
          for (const [family, count] of familyCounts) {
            if (count > 1) {
              hard_failures.push(`${phaseLabel} / ${day.title ?? 'day'}: repeated ${family} exercise family ${count} times in Workout.`);
            }
          }

          const categories = new Set(workout.map((exercise) => foundationCategory(exercise.name ?? '')));
          for (const required of ['pull', 'push', 'anterior_lower', 'posterior_lower', 'corrective']) {
            if (!categories.has(required)) {
              hard_failures.push(`${phaseLabel} / ${day.title ?? 'day'}: missing Foundation Workout slot ${required}.`);
            }
          }

          const dayTitle = (day.title ?? '').toLowerCase();
          const workoutNames = workout.map((exercise) => exercise.name ?? '').join(' ').toLowerCase();
          if ((dayTitle.includes('day 1') || dayTitle.includes('day 3')) && !/(single|half kneeling|landmine|step[- ]?up|step[- ]?down|lunge|split squat)/i.test(workoutNames)) {
            findings.push(`${phaseLabel} / ${day.title ?? 'day'}: unilateral Foundation day should include clear single-arm/single-leg work.`);
          }
          if (dayTitle.includes('day 2') && /(archer|commando|typewriter|single[- ]arm|single[- ]leg|pistol)/i.test(workoutNames)) {
            findings.push(`${phaseLabel} / ${day.title ?? 'day'}: bilateral Foundation day includes strongly unilateral exercise names; review balance.`);
          }
        }
      }
    }

    if (body.emphasis?.needs_cardio_block) {
      const hasCardio = (programme.phases ?? []).some((p) =>
        (p.days ?? []).some((d) => (d.exercises ?? []).some((e) => sectionFor(d.exercises ?? [], (d.exercises ?? []).indexOf(e)) === 'MetCon'))
      );
      if (!hasCardio) findings.push('ClientAnalysis flagged cardio_block but no MetCon section found in any phase.');
    }
    if (body.emphasis?.needs_mobility_block) {
      const hasMob = (programme.phases ?? []).some((p) =>
        (p.days ?? []).some((d) => (d.exercises ?? []).some((e) => sectionFor(d.exercises ?? [], (d.exercises ?? []).indexOf(e)) === 'Stretches'))
      );
      if (!hasMob) findings.push('ClientAnalysis flagged mobility_block but no Stretches section found in any phase.');
    }

    // BESPOKE mode: the coach asked for something the fixed 5-phase Big-5 template can't
    // express. Keep the one universal invariant hard (every exercise links to a real library
    // id); demote the template rules (phase count, 3-day Foundation, Big-5 presence,
    // week_blocks, Foundation slot/family rules) to non-blocking findings so the programme
    // can still be published for review.
    const isUniversal = (m: string) => /missing exercise_id/.test(m);
    const finalHard = bespoke ? hard_failures.filter(isUniversal) : hard_failures;
    const finalFindings = bespoke
      ? [...findings, ...hard_failures.filter((m) => !isUniversal(m)).map((m) => `[bespoke, non-blocking] ${m}`)]
      : findings;

    return json({
      ok: true,
      passed: finalHard.length === 0,
      hard_failures: finalHard,
      findings: finalFindings,
    });
  } catch (error) {
    console.error('programme-validation-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Validation failed' }, 500);
  }
});

// Must match the same-named helper in programme-synthesis-agent so the validator and the
// builder agree on which programmes are bespoke.
function isBespoke(
  constraints: { equipment?: string } | null | undefined,
  intent: string | undefined,
  coachDirective: string,
): boolean {
  if (intent === 'one_off') return true;
  const eq = constraints?.equipment;
  if (eq && ['bodyweight', 'home_minimal', 'bands', 'travel'].includes(eq)) return true;
  const t = coachDirective.toLowerCase();
  return /\bbodyweight\b|\bno weights?\b|\bno equipment\b|\bat home\b|\bhome workout\b|\bno gym\b|\bwithout gym\b|\bbands? only\b|\btravel workout\b|\bhotel\b|\bone[- ]?off\b/.test(t);
}

function sectionFor(exercises: Exercise[], idx: number): string | null {
  for (let i = idx; i >= 0; i--) {
    if (exercises[i].section_start) return exercises[i].section_start ?? null;
  }
  return null;
}

function foundationCategory(name: string): string {
  const n = name.toLowerCase();
  if (/pull[- ]?up|chin[- ]?up|lat pulldown|row|single.*arm.*cable.*pull/.test(n)) return 'pull';
  if (/bench|press|push|fly|chest/.test(n)) return 'push';
  if (/squat|lunge|step[- ]?up|step[- ]?down|leg press|knee extension|cossack|patrick/.test(n)) return 'anterior_lower';
  if (/deadlift|rdl|romanian|hinge|hamstring curl|hip thrust|glute bridge|back extension/.test(n)) return 'posterior_lower';
  if (/hip|adductor|pallof|plank|dead bug|crunch|ql|core|thoracic|mobility|stretch/.test(n)) return 'corrective';
  return 'other';
}

function exerciseFamily(name: string): string {
  const n = name.toLowerCase();
  if (/pull[- ]?up|chin[- ]?up/.test(n)) return 'pull-up';
  if (/lat pulldown/.test(n)) return 'lat-pulldown';
  if (/row/.test(n)) return 'row';
  if (/rdl|romanian/.test(n)) return 'rdl';
  if (/deadlift/.test(n)) return 'deadlift';
  if (/cossack/.test(n)) return 'cossack';
  if (/goblet|squat|leg press|knee extension/.test(n)) return 'squat-knee';
  if (/lunge|split squat/.test(n)) return 'lunge';
  if (/step[- ]?up|step[- ]?down|patrick/.test(n)) return 'step';
  if (/hip thrust|glute bridge|bridge/.test(n)) return 'hip-thrust-bridge';
  if (/hamstring curl/.test(n)) return 'hamstring-curl';
  if (/bench|chest press|fly|push up|push/.test(n)) return 'horizontal-push';
  if (/shoulder press|landmine.*press|overhead press/.test(n)) return 'shoulder-press';
  if (/hip airplane/.test(n)) return 'hip-airplane';
  if (/hip.*ir|internal rotation|capsular/.test(n)) return 'hip-ir';
  if (/hip flexor/.test(n)) return 'hip-flexor';
  if (/adductor|pigeon|90\/90|90-90/.test(n)) return 'hip-adductor-rotation';
  if (/thoracic|open book|thread.*needle|cat[- ]?cow/.test(n)) return 'thoracic';
  if (/ql|back extension|jefferson/.test(n)) return 'trunk-extension';
  if (/dead bug|plank|pallof|crunch|core/.test(n)) return 'core';
  return n.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'unknown';
}
