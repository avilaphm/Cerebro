export interface NutritionTargets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

type NutritionTargetField = 'calories' | 'protein_g';

interface NutritionTargetEdit {
  field: NutritionTargetField;
  value: number;
}

interface RebalanceResult {
  targets: NutritionTargets;
  error: string | null;
}

export const DEFAULT_NUTRITION_TARGETS: NutritionTargets = {
  calories: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 65,
  fibre_g: 30,
};

const LIMITS = {
  calories: { min: 1200, max: 5000 },
  protein_g: { min: 60, max: 300 },
  carbs_g: { min: 100, max: 650 },
  fat_g: { min: 50, max: 180 },
  fibre_g: { min: 20, max: 70 },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampTarget(key: keyof NutritionTargets, value: number) {
  return clamp(Math.round(value), LIMITS[key].min, LIMITS[key].max);
}

function fibreForCalories(calories: number) {
  return clampTarget('fibre_g', Math.max(25, Math.round((calories / 1000) * 14)));
}

export function normalizeNutritionTargets(targets: Partial<NutritionTargets> | null | undefined): NutritionTargets {
  return {
    calories: clampTarget('calories', targets?.calories ?? DEFAULT_NUTRITION_TARGETS.calories),
    protein_g: clampTarget('protein_g', targets?.protein_g ?? DEFAULT_NUTRITION_TARGETS.protein_g),
    carbs_g: clampTarget('carbs_g', targets?.carbs_g ?? DEFAULT_NUTRITION_TARGETS.carbs_g),
    fat_g: clampTarget('fat_g', targets?.fat_g ?? DEFAULT_NUTRITION_TARGETS.fat_g),
    fibre_g: clampTarget('fibre_g', targets?.fibre_g ?? DEFAULT_NUTRITION_TARGETS.fibre_g),
  };
}

export function macroCalories(targets: Pick<NutritionTargets, 'protein_g' | 'carbs_g' | 'fat_g'>) {
  return targets.protein_g * 4 + targets.carbs_g * 4 + targets.fat_g * 9;
}

function allocateCarbsAndFat(
  calories: number,
  proteinG: number,
  previous: Pick<NutritionTargets, 'carbs_g' | 'fat_g'>,
) {
  const remainingCalories = calories - proteinG * 4;
  const minimumCalories = LIMITS.carbs_g.min * 4 + LIMITS.fat_g.min * 9;
  const maximumCalories = LIMITS.carbs_g.max * 4 + LIMITS.fat_g.max * 9;
  if (remainingCalories < minimumCalories || remainingCalories > maximumCalories) return null;

  const previousEnergy = previous.carbs_g * 4 + previous.fat_g * 9;
  const fatShare = previousEnergy > 0 ? (previous.fat_g * 9) / previousEnergy : 0.35;
  const idealFatG = clampTarget('fat_g', (remainingCalories * fatShare) / 9);
  const idealCarbsG = clampTarget('carbs_g', (remainingCalories - idealFatG * 9) / 4);
  let best = { carbs_g: idealCarbsG, fat_g: idealFatG, calorieGap: Number.POSITIVE_INFINITY, ratioGap: Number.POSITIVE_INFINITY };

  for (let fatG = LIMITS.fat_g.min; fatG <= LIMITS.fat_g.max; fatG += 1) {
    const carbsG = clampTarget('carbs_g', (remainingCalories - fatG * 9) / 4);
    const calorieGap = Math.abs(remainingCalories - carbsG * 4 - fatG * 9);
    const ratioGap = Math.abs(carbsG - idealCarbsG) * 4 + Math.abs(fatG - idealFatG) * 9;
    if (calorieGap < best.calorieGap || (calorieGap === best.calorieGap && ratioGap < best.ratioGap)) {
      best = { carbs_g: carbsG, fat_g: fatG, calorieGap, ratioGap };
    }
  }

  return { carbs_g: best.carbs_g, fat_g: best.fat_g };
}

export function rebalanceNutritionTargets(
  currentTargets: Partial<NutritionTargets> | null | undefined,
  edit: NutritionTargetEdit,
): RebalanceResult {
  const current = normalizeNutritionTargets(currentTargets);
  const calories = edit.field === 'calories'
    ? clampTarget('calories', edit.value)
    : current.calories;
  const proteinG = edit.field === 'protein_g'
    ? clampTarget('protein_g', edit.value)
    : clampTarget('protein_g', current.protein_g * (calories / macroCalories(current)));
  const allocation = allocateCarbsAndFat(calories, proteinG, current);

  if (!allocation) {
    return {
      targets: current,
      error: 'Those targets cannot be split within the supported carbohydrate and fat ranges.',
    };
  }

  return {
    targets: {
      calories,
      protein_g: proteinG,
      carbs_g: allocation.carbs_g,
      fat_g: allocation.fat_g,
      fibre_g: fibreForCalories(calories),
    },
    error: null,
  };
}
