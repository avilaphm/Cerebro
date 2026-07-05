import {
  LEGACY_METRICS_SCHEMA_VERSION,
  LEGACY_RULES_SCHEMA_VERSION,
  METRICS_SCHEMA_VERSION,
  RULES_SCHEMA_VERSION,
  SCREENING_RESULT_SCHEMA_VERSION,
  type MetricRuleGroup,
  type MovementMetrics,
  type RuleBand,
  type RulesConfig,
  type RulesEnvelope,
  type ScreeningResult,
  type StructuredFinding,
} from '../contracts';

const METRIC_IDS = new Set([
  'hip_lateral_translation_ratio',
  'hip_knee_vertical_margin_ratio',
]);
const SEVERITIES = new Set(['indeterminate', 'low', 'moderate', 'high']);
const CALIBRATION_STATUSES = new Set([
  'uncalibrated',
  'calibrating',
  'calibrated',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireNonEmptyString(value: unknown, path: string, errors: string[]) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function validateUnitInterval(value: unknown, path: string, errors: string[]) {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    errors.push(`${path} must be a finite number between 0 and 1`);
  }
}

function bandsOverlap(a: RuleBand, b: RuleBand): boolean {
  const aMin = a.minInclusive ?? Number.NEGATIVE_INFINITY;
  const aMax = a.maxExclusive ?? Number.POSITIVE_INFINITY;
  const bMin = b.minInclusive ?? Number.NEGATIVE_INFINITY;
  const bMax = b.maxExclusive ?? Number.POSITIVE_INFINITY;
  return Math.max(aMin, bMin) < Math.min(aMax, bMax);
}

function validateBand(
  value: unknown,
  path: string,
  errors: string[],
): value is RuleBand {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  requireNonEmptyString(value.bandId, `${path}.bandId`, errors);
  requireNonEmptyString(value.message, `${path}.message`, errors);
  if (typeof value.severity !== 'string' || !SEVERITIES.has(value.severity)) {
    errors.push(`${path}.severity is unknown`);
  }

  if (value.minInclusive === undefined && value.maxExclusive === undefined) {
    errors.push(`${path} must define at least one numeric bound`);
  }
  if (
    value.minInclusive !== undefined &&
    !isFiniteNumber(value.minInclusive)
  ) {
    errors.push(`${path}.minInclusive must be finite`);
  }
  if (
    value.maxExclusive !== undefined &&
    !isFiniteNumber(value.maxExclusive)
  ) {
    errors.push(`${path}.maxExclusive must be finite`);
  }
  if (
    isFiniteNumber(value.minInclusive) &&
    isFiniteNumber(value.maxExclusive) &&
    value.minInclusive >= value.maxExclusive
  ) {
    errors.push(`${path} must have minInclusive below maxExclusive`);
  }

  return true;
}

function validateRuleGroup(
  value: unknown,
  index: number,
  errors: string[],
): value is MetricRuleGroup {
  const path = `config.ruleGroups[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  requireNonEmptyString(value.ruleId, `${path}.ruleId`, errors);
  requireNonEmptyString(value.findingCode, `${path}.findingCode`, errors);
  requireNonEmptyString(value.label, `${path}.label`, errors);
  if (typeof value.metricId !== 'string' || !METRIC_IDS.has(value.metricId)) {
    errors.push(`${path}.metricId is unknown`);
  }
  if (typeof value.includeMetricDirection !== 'boolean') {
    errors.push(`${path}.includeMetricDirection must be boolean`);
  }
  if (!Array.isArray(value.bands) || value.bands.length === 0) {
    errors.push(`${path}.bands must be a non-empty array`);
    return false;
  }

  const validBands = value.bands.filter((band, bandIndex) =>
    validateBand(band, `${path}.bands[${bandIndex}]`, errors),
  ) as RuleBand[];
  const bandIds = new Set<string>();
  validBands.forEach((band) => {
    if (bandIds.has(band.bandId)) {
      errors.push(`${path} contains duplicate bandId ${band.bandId}`);
    }
    bandIds.add(band.bandId);
  });
  for (let left = 0; left < validBands.length; left += 1) {
    for (let right = left + 1; right < validBands.length; right += 1) {
      if (bandsOverlap(validBands[left], validBands[right])) {
        errors.push(
          `${path} has overlapping bands ${validBands[left].bandId} and ${validBands[right].bandId}`,
        );
      }
    }
  }

  return true;
}

function validateConfig(value: unknown, errors: string[]): value is RulesConfig {
  if (!isRecord(value)) {
    errors.push('config must be an object');
    return false;
  }

  const isLegacyOverhead =
    value.movementId === 'overhead_squat_front' &&
    value.metricSchemaVersion === LEGACY_METRICS_SCHEMA_VERSION;
  const isBodyweightSquat =
    value.movementId === 'bodyweight_squat_front' &&
    value.metricSchemaVersion === METRICS_SCHEMA_VERSION;
  if (!isLegacyOverhead && !isBodyweightSquat) {
    errors.push('config.movementId is unsupported');
  }
  if (
    value.metricSchemaVersion !== LEGACY_METRICS_SCHEMA_VERSION &&
    value.metricSchemaVersion !== METRICS_SCHEMA_VERSION
  ) {
    errors.push('config.metricSchemaVersion is unsupported');
  }
  if (value.expectedRepetitions !== 3) {
    errors.push('config.expectedRepetitions must equal 3');
  }

  if (!isRecord(value.qualityGates)) {
    errors.push('config.qualityGates must be an object');
  } else {
    validateUnitInterval(
      value.qualityGates.landmarkConfidenceMin,
      'config.qualityGates.landmarkConfidenceMin',
      errors,
    );
    validateUnitInterval(
      value.qualityGates.validFrameFractionMin,
      'config.qualityGates.validFrameFractionMin',
      errors,
    );
    if (isLegacyOverhead) {
      validateUnitInterval(
        value.qualityGates.minOverheadArmFrameFraction,
        'config.qualityGates.minOverheadArmFrameFraction',
        errors,
      );
    } else if (
      isBodyweightSquat &&
      value.qualityGates.minOverheadArmFrameFraction !== undefined
    ) {
      errors.push(
        'config.qualityGates.minOverheadArmFrameFraction is not valid for the bodyweight squat',
      );
    }
    for (const key of [
      'minInferenceFps',
      'maxAnkleDriftHipWidthRatio',
      'maxSegmentJumpHipWidthRatio',
    ]) {
      const gateValue = value.qualityGates[key];
      if (!isFiniteNumber(gateValue) || gateValue <= 0) {
        errors.push(`config.qualityGates.${key} must be positive and finite`);
      }
    }
  }

  if (!isRecord(value.segmentation)) {
    errors.push('config.segmentation must be an object');
  } else {
    for (const key of [
      'neutralBaselineDurationMs',
      'smoothingWindowFrames',
      'descentStartRatio',
      'standingReturnRatio',
      'minimumBottomDescentRatio',
      'minimumRepDurationMs',
      'maximumRepDurationMs',
      'bottomWindowMs',
    ]) {
      const segmentationValue = value.segmentation[key];
      if (!isFiniteNumber(segmentationValue) || segmentationValue <= 0) {
        errors.push(`config.segmentation.${key} must be positive and finite`);
      }
    }
    if (
      isFiniteNumber(value.segmentation.minimumRepDurationMs) &&
      isFiniteNumber(value.segmentation.maximumRepDurationMs) &&
      value.segmentation.minimumRepDurationMs >=
        value.segmentation.maximumRepDurationMs
    ) {
      errors.push(
        'config.segmentation minimum rep duration must be below maximum',
      );
    }
  }

  if (!Array.isArray(value.ruleGroups) || value.ruleGroups.length === 0) {
    errors.push('config.ruleGroups must be a non-empty array');
  } else {
    const groups = value.ruleGroups.filter((group, index) =>
      validateRuleGroup(group, index, errors),
    ) as MetricRuleGroup[];
    const ruleIds = new Set<string>();
    const metricIds = new Set<string>();
    groups.forEach((group) => {
      if (ruleIds.has(group.ruleId)) {
        errors.push(`config contains duplicate ruleId ${group.ruleId}`);
      }
      if (metricIds.has(group.metricId)) {
        errors.push(`config contains duplicate metricId ${group.metricId}`);
      }
      ruleIds.add(group.ruleId);
      metricIds.add(group.metricId);
    });
  }

  if (!isRecord(value.metadata)) {
    errors.push('config.metadata must be an object');
  } else {
    requireNonEmptyString(
      value.metadata.purpose,
      'config.metadata.purpose',
      errors,
    );
    requireNonEmptyString(
      value.metadata.thresholdSource,
      'config.metadata.thresholdSource',
      errors,
    );
    if (!Array.isArray(value.metadata.calibrationFixtureIds)) {
      errors.push('config.metadata.calibrationFixtureIds must be an array');
    }
    if (!Array.isArray(value.metadata.pedroReasons)) {
      errors.push('config.metadata.pedroReasons must be an array');
    }
  }

  return true;
}

export function validateRulesEnvelope(input: unknown): RulesEnvelope {
  const errors: string[] = [];
  if (!isRecord(input)) {
    throw new Error('Rules envelope must be an object');
  }

  if (
    input.schemaVersion !== LEGACY_RULES_SCHEMA_VERSION &&
    input.schemaVersion !== RULES_SCHEMA_VERSION
  ) {
    errors.push('schemaVersion is unsupported');
  }
  if (!Number.isInteger(input.version) || Number(input.version) <= 0) {
    errors.push('version must be a positive integer');
  }
  if (input.status !== 'active') {
    errors.push('status must be active');
  }
  if (
    typeof input.calibrationStatus !== 'string' ||
    !CALIBRATION_STATUSES.has(input.calibrationStatus)
  ) {
    errors.push('calibrationStatus is unknown');
  }
  if (
    typeof input.configSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.configSha256)
  ) {
    errors.push('configSha256 must be a lowercase SHA-256 hex digest');
  }
  validateConfig(input.config, errors);
  if (isRecord(input.config)) {
    if (
      input.schemaVersion === LEGACY_RULES_SCHEMA_VERSION &&
      (input.config.movementId !== 'overhead_squat_front' ||
        input.config.metricSchemaVersion !== LEGACY_METRICS_SCHEMA_VERSION)
    ) {
      errors.push('legacy rules schema must use the legacy overhead squat');
    }
    if (
      input.schemaVersion === RULES_SCHEMA_VERSION &&
      (input.config.movementId !== 'bodyweight_squat_front' ||
        input.config.metricSchemaVersion !== METRICS_SCHEMA_VERSION)
    ) {
      errors.push('current rules schema must use the bodyweight squat');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid rules configuration: ${errors.join('; ')}`);
  }
  return input as unknown as RulesEnvelope;
}

function bandMatches(value: number, band: RuleBand): boolean {
  if (band.minInclusive !== undefined && value < band.minInclusive) {
    return false;
  }
  if (band.maxExclusive !== undefined && value >= band.maxExclusive) {
    return false;
  }
  return true;
}

export function evaluateRules(
  metrics: MovementMetrics,
  envelopeInput: unknown,
): ScreeningResult {
  const envelope = validateRulesEnvelope(envelopeInput);
  if (metrics.schemaVersion !== envelope.config.metricSchemaVersion) {
    throw new Error('Metrics schema does not match active rules');
  }
  if (metrics.movement.movementId !== envelope.config.movementId) {
    throw new Error('Movement does not match active rules');
  }
  if (metrics.quality.status !== 'accepted') {
    throw new Error('Rejected movement metrics cannot be evaluated');
  }

  const findings: StructuredFinding[] = [];
  for (const group of envelope.config.ruleGroups) {
    const metric = metrics.metrics.find(
      (candidate) => candidate.metricId === group.metricId,
    );
    if (!metric) {
      throw new Error(`Required metric ${group.metricId} is missing`);
    }
    const band = group.bands.find((candidate) =>
      bandMatches(metric.value, candidate),
    );
    if (!band) continue;

    findings.push({
      findingCode: group.findingCode,
      label: group.label,
      severity: band.severity,
      message: band.message,
      metricId: metric.metricId,
      metricValue: metric.value,
      comparison: {
        ...(band.minInclusive === undefined
          ? {}
          : { minInclusive: band.minInclusive }),
        ...(band.maxExclusive === undefined
          ? {}
          : { maxExclusive: band.maxExclusive }),
      },
      direction: group.includeMetricDirection ? metric.direction : 'none',
      matchedRuleId: group.ruleId,
      matchedBandId: band.bandId,
    });
  }

  return {
    schemaVersion: SCREENING_RESULT_SCHEMA_VERSION,
    trialId: metrics.trialId,
    entryPoint: metrics.entryPoint,
    movementId: metrics.movement.movementId,
    source: metrics.source,
    model: metrics.model,
    quality: metrics.quality,
    metricsSchemaVersion: metrics.schemaVersion,
    rulesSchemaVersion: envelope.schemaVersion,
    rulesVersion: envelope.version,
    rulesConfigSha256: envelope.configSha256,
    calibrationStatus: envelope.calibrationStatus,
    perRepetition: metrics.repetitions,
    metrics: metrics.metrics,
    findings,
  };
}
