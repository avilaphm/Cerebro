import type {
  LandmarkSeries,
  PipelineOutcome,
  RulesEnvelope,
} from './contracts';
import { extractMovementMetrics } from './metrics-extraction';
import { evaluateRules, validateRulesEnvelope } from './rules-engine';

export const PIPELINE_ENTRY_POINTS = [
  'live_camera',
  'uploaded_video',
  'self_screening',
] as const;

export function runMovementScreeningPipeline(
  landmarks: LandmarkSeries,
  rulesInput: RulesEnvelope | unknown,
): PipelineOutcome {
  let rules: RulesEnvelope;
  try {
    rules = validateRulesEnvelope(rulesInput);
  } catch (error) {
    return {
      ok: false,
      stage: 'rules_engine',
      reasons: [
        error instanceof Error ? error.message : 'Rules validation failed.',
      ],
    };
  }

  const metricsOutcome = extractMovementMetrics(landmarks, rules.config);
  if (!metricsOutcome.ok) {
    return {
      ok: false,
      stage: 'metrics_extraction',
      reasons: metricsOutcome.reasons,
    };
  }

  try {
    return {
      ok: true,
      metrics: metricsOutcome.metrics,
      result: evaluateRules(metricsOutcome.metrics, rules),
    };
  } catch (error) {
    return {
      ok: false,
      stage: 'rules_engine',
      reasons: [
        error instanceof Error ? error.message : 'Rule evaluation failed.',
      ],
    };
  }
}
