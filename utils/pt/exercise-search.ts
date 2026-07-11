import type { PTExercise } from './types';

type ExerciseSearchItem = Pick<
  PTExercise,
  'name' | 'muscles' | 'tags' | 'primary_muscles' | 'secondary_muscles' | 'conditions'
> & {
  equipment?: string | null;
  purpose?: string | null;
};

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueTokens(value: string): string[] {
  const seen = new Set<string>();
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

const TOKEN_ALIASES: Record<string, string[]> = {
  bb: ['barbell', 'barbells', 'back', 'bar'],
  barbell: ['bb', 'barbells'],
  barbells: ['bb', 'barbell'],
  db: ['dumbbell', 'dumbbells'],
  dumbbell: ['db', 'dumbbells'],
  dumbbells: ['db', 'dumbbell'],
  kb: ['kettlebell', 'kettlebells'],
  kettlebell: ['kb', 'kettlebells'],
  kettlebells: ['kb', 'kettlebell'],
  bw: ['bodyweight', 'body'],
  bodyweight: ['bw', 'body'],
  band: ['bands', 'resistance'],
  bands: ['band', 'resistance'],
  resistance: ['band', 'bands'],
  incline: ['inclined'],
  inclined: ['incline'],
  incleined: ['incline'],
  inc: ['incline'],
  rdl: ['romanian', 'deadlift'],
  romanian: ['rdl', 'deadlift'],
  ohp: ['overhead', 'shoulder', 'press'],
  pulldown: ['pull', 'down', 'lat'],
  'pullup': ['pull', 'up', 'pull-up'],
};

function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  for (const alias of TOKEN_ALIASES[token] ?? []) variants.add(alias);

  if (token.length > 4 && token.endsWith('ed')) {
    variants.add(token.slice(0, -1));
    variants.add(token.slice(0, -2));
  }
  if (token.length > 5 && token.endsWith('ing')) {
    variants.add(token.slice(0, -3));
    variants.add(`${token.slice(0, -3)}e`);
  }
  if (token.length > 4 && token.endsWith('es')) {
    variants.add(token.slice(0, -2));
    variants.add(token.slice(0, -1));
  }
  if (token.length > 3 && token.endsWith('s')) {
    variants.add(token.slice(0, -1));
  }

  for (const alias of [...variants]) {
    for (const nested of TOKEN_ALIASES[alias] ?? []) variants.add(nested);
  }

  return [...variants].filter((variant) => variant.length >= 2);
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }

  return previous[b.length] ?? maxDistance + 1;
}

function tokenMatchScore(queryToken: string, fieldToken: string): number {
  let best = 0;
  for (const queryVariant of tokenVariants(queryToken)) {
    for (const fieldVariant of tokenVariants(fieldToken)) {
      if (queryVariant === fieldVariant) best = Math.max(best, 100);
      else if (fieldVariant.startsWith(queryVariant) || queryVariant.startsWith(fieldVariant)) best = Math.max(best, 82);
      else if (fieldVariant.includes(queryVariant) || queryVariant.includes(fieldVariant)) best = Math.max(best, 64);
      else if (queryVariant.length >= 4 && fieldVariant.length >= 4) {
        const distance = boundedEditDistance(queryVariant, fieldVariant, 2);
        if (distance === 1) best = Math.max(best, 58);
        else if (distance === 2 && queryVariant.length >= 6 && fieldVariant.length >= 6) best = Math.max(best, 38);
      }
    }
  }
  return best;
}

function fieldScore(queryToken: string, text: string, weight: number): number {
  const tokens = uniqueTokens(text);
  if (tokens.length === 0) return 0;
  return Math.max(...tokens.map((token) => tokenMatchScore(queryToken, token))) * weight;
}

function scoreExercise(item: ExerciseSearchItem, query: string, queryTokens: string[]): number {
  const name = item.name ?? '';
  const fields: Array<{ value: string; weight: number }> = [
    { value: name, weight: 3 },
    { value: item.muscles?.join(' ') ?? '', weight: 1.5 },
    { value: item.primary_muscles?.join(' ') ?? '', weight: 1.5 },
    { value: item.secondary_muscles?.join(' ') ?? '', weight: 1.2 },
    { value: item.tags?.join(' ') ?? '', weight: 1.1 },
    { value: item.conditions?.join(' ') ?? '', weight: 0.8 },
    { value: item.equipment ?? '', weight: 0.7 },
    { value: item.purpose ?? '', weight: 0.5 },
  ];

  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(name);
  let score = normalizedName.includes(normalizedQuery) ? 220 : 0;

  for (const queryToken of queryTokens) {
    const bestForToken = Math.max(
      ...fields.map((field) => fieldScore(queryToken, field.value, field.weight)),
    );
    if (bestForToken <= 0) return 0;
    score += bestForToken;
  }

  if (uniqueTokens(name)[0] === queryTokens[0]) score += 25;
  return score;
}

export function searchExerciseLibrary<T extends ExerciseSearchItem>(
  items: T[],
  query: string,
  limit: number,
): T[] {
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0) return items.slice(0, limit);

  return items
    .map((item, index) => ({ item, index, score: scoreExercise(item, query, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name) || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
