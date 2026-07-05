import {
  type AnatomicalDirection,
  type LandmarkSeries,
  type MetricValue,
  type MovementMetrics,
  type PoseFrame,
  type PoseLandmark,
  type RepetitionMetric,
  type RulesConfig,
} from '../contracts';
import { poseFrameHasRequiredLandmarks } from '../pose-extraction/landmark-series';

interface FrameSample {
  frame: PoseFrame;
  hipMidX: number;
  hipMidY: number;
  kneeMidY: number;
  ankleMidX: number;
  hipWidth: number;
  femurLength: number;
  armsOverhead: boolean;
  smoothedDescentRatio: number;
}

interface Baseline {
  endTimestampMs: number;
  frameCount: number;
  hipMidX: number;
  hipMidY: number;
  ankleMidX: number;
  hipWidth: number;
  femurLength: number;
  neutralOffsetX: number;
}

interface RepWindow {
  startIndex: number;
  bottomIndex: number;
  endIndex: number;
}

export type MetricsExtractionOutcome =
  | { ok: true; metrics: MovementMetrics }
  | { ok: false; reasons: string[] };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index];
}

function average(left: number, right: number): number {
  return (left + right) / 2;
}

function distance(left: PoseLandmark, right: PoseLandmark): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function sampleFrame(
  frame: PoseFrame,
  source: LandmarkSeries['source'],
): FrameSample {
  const leftShoulder = frame.landmarks[11];
  const rightShoulder = frame.landmarks[12];
  const leftWrist = frame.landmarks[15];
  const rightWrist = frame.landmarks[16];
  const leftHip = frame.landmarks[23];
  const rightHip = frame.landmarks[24];
  const leftKnee = frame.landmarks[25];
  const rightKnee = frame.landmarks[26];
  const leftAnkle = frame.landmarks[27];
  const rightAnkle = frame.landmarks[28];
  const toPixels = (landmark: PoseLandmark): PoseLandmark => ({
    ...landmark,
    x: landmark.x * source.width,
    y: landmark.y * source.height,
  });
  const leftShoulderPx = toPixels(leftShoulder);
  const rightShoulderPx = toPixels(rightShoulder);
  const leftWristPx = toPixels(leftWrist);
  const rightWristPx = toPixels(rightWrist);
  const leftHipPx = toPixels(leftHip);
  const rightHipPx = toPixels(rightHip);
  const leftKneePx = toPixels(leftKnee);
  const rightKneePx = toPixels(rightKnee);
  const leftAnklePx = toPixels(leftAnkle);
  const rightAnklePx = toPixels(rightAnkle);

  return {
    frame,
    hipMidX: average(leftHipPx.x, rightHipPx.x),
    hipMidY: average(leftHipPx.y, rightHipPx.y),
    kneeMidY: average(leftKneePx.y, rightKneePx.y),
    ankleMidX: average(leftAnklePx.x, rightAnklePx.x),
    hipWidth: distance(leftHipPx, rightHipPx),
    femurLength: average(
      distance(leftHipPx, leftKneePx),
      distance(rightHipPx, rightKneePx),
    ),
    armsOverhead:
      leftWristPx.y < leftShoulderPx.y &&
      rightWristPx.y < rightShoulderPx.y,
    smoothedDescentRatio: 0,
  };
}

function establishBaseline(
  samples: FrameSample[],
  durationMs: number,
): Baseline | null {
  if (samples.length === 0) return null;
  const endTimestampMs = samples[0].frame.timestampMs + durationMs;
  const baselineSamples = samples.filter(
    (sample) => sample.frame.timestampMs <= endTimestampMs,
  );
  if (baselineSamples.length < 10) return null;

  const hipWidth = median(baselineSamples.map((sample) => sample.hipWidth));
  const femurLength = median(
    baselineSamples.map((sample) => sample.femurLength),
  );
  if (hipWidth <= 0 || femurLength <= 0) return null;

  const hipMidX = median(baselineSamples.map((sample) => sample.hipMidX));
  const ankleMidX = median(
    baselineSamples.map((sample) => sample.ankleMidX),
  );
  return {
    endTimestampMs,
    frameCount: baselineSamples.length,
    hipMidX,
    hipMidY: median(baselineSamples.map((sample) => sample.hipMidY)),
    ankleMidX,
    hipWidth,
    femurLength,
    neutralOffsetX: hipMidX - ankleMidX,
  };
}

function smoothDescent(
  samples: FrameSample[],
  baseline: Baseline,
  windowFrames: number,
) {
  const raw = samples.map(
    (sample) => (sample.hipMidY - baseline.hipMidY) / baseline.femurLength,
  );
  samples.forEach((sample, index) => {
    const start = Math.max(0, index - windowFrames + 1);
    sample.smoothedDescentRatio = median(raw.slice(start, index + 1));
  });
}

function segmentRepetitions(
  samples: FrameSample[],
  baseline: Baseline,
  config: RulesConfig['segmentation'],
): RepWindow[] {
  const repetitions: RepWindow[] = [];
  let active: RepWindow | null = null;
  let maximumDescent = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.frame.timestampMs <= baseline.endTimestampMs) continue;

    if (!active) {
      if (sample.smoothedDescentRatio >= config.descentStartRatio) {
        active = { startIndex: index, bottomIndex: index, endIndex: index };
        maximumDescent = sample.smoothedDescentRatio;
      }
      continue;
    }

    active.endIndex = index;
    if (sample.smoothedDescentRatio > maximumDescent) {
      maximumDescent = sample.smoothedDescentRatio;
      active.bottomIndex = index;
    }

    const durationMs =
      sample.frame.timestampMs -
      samples[active.startIndex].frame.timestampMs;
    if (durationMs > config.maximumRepDurationMs) {
      active = null;
      maximumDescent = 0;
      continue;
    }

    if (
      sample.smoothedDescentRatio <= config.standingReturnRatio &&
      maximumDescent >= config.minimumBottomDescentRatio &&
      durationMs >= config.minimumRepDurationMs
    ) {
      repetitions.push(active);
      active = null;
      maximumDescent = 0;
    }
  }

  return repetitions;
}

function directionFromSignedRatio(value: number): AnatomicalDirection {
  if (Math.abs(value) < 1e-6) return 'none';
  // In an unmirrored front view, image-right is the subject's anatomical left.
  return value > 0 ? 'left' : 'right';
}

function aggregateDirection(
  directions: AnatomicalDirection[],
): AnatomicalDirection {
  const left = directions.filter((direction) => direction === 'left').length;
  const right = directions.filter((direction) => direction === 'right').length;
  if (left >= 2) return 'left';
  if (right >= 2) return 'right';
  return 'variable';
}

function buildRepetitionMetric(
  samples: FrameSample[],
  window: RepWindow,
  repetition: 1 | 2 | 3,
  baseline: Baseline,
  bottomWindowMs: number,
): RepetitionMetric {
  const repSamples = samples.slice(window.startIndex, window.endIndex + 1);
  const signedTranslations = repSamples.map(
    (sample) =>
      (sample.hipMidX -
        sample.ankleMidX -
        baseline.neutralOffsetX) /
      baseline.hipWidth,
  );
  const absoluteTranslation = percentile(
    signedTranslations.map(Math.abs),
    0.95,
  );
  const closestSigned = signedTranslations.reduce((best, candidate) =>
    Math.abs(Math.abs(candidate) - absoluteTranslation) <
    Math.abs(Math.abs(best) - absoluteTranslation)
      ? candidate
      : best,
  );

  const bottomTimestamp = samples[window.bottomIndex].frame.timestampMs;
  const bottomSamples = repSamples.filter(
    (sample) =>
      Math.abs(sample.frame.timestampMs - bottomTimestamp) <= bottomWindowMs,
  );
  const depthProxy = median(
    bottomSamples.map(
      (sample) =>
        (sample.hipMidY - sample.kneeMidY) / baseline.femurLength,
    ),
  );

  return {
    repetition,
    startedAtMs: samples[window.startIndex].frame.timestampMs,
    bottomAtMs: bottomTimestamp,
    endedAtMs: samples[window.endIndex].frame.timestampMs,
    hipLateralTranslationRatio: absoluteTranslation,
    hipLateralTranslationSignedRatio: closestSigned,
    hipLateralDirection: directionFromSignedRatio(closestSigned),
    hipKneeVerticalMarginRatio: depthProxy,
  };
}

export function extractMovementMetrics(
  series: LandmarkSeries,
  config: RulesConfig,
): MetricsExtractionOutcome {
  const reasons: string[] = [];
  const validFrames = series.frames.filter((frame) =>
    poseFrameHasRequiredLandmarks(
      frame,
      config.qualityGates.landmarkConfidenceMin,
    ),
  );
  const samples = validFrames.map((frame) => sampleFrame(frame, series.source));
  const baseline = establishBaseline(
    samples,
    config.segmentation.neutralBaselineDurationMs,
  );
  if (!baseline) {
    return {
      ok: false,
      reasons: ['A stable three-second neutral baseline was not captured.'],
    };
  }

  smoothDescent(
    samples,
    baseline,
    Math.round(config.segmentation.smoothingWindowFrames),
  );
  const repWindows = segmentRepetitions(samples, baseline, config.segmentation);

  const ankleDriftHipWidthRatio = Math.max(
    0,
    ...samples.map(
      (sample) =>
        Math.abs(sample.ankleMidX - baseline.ankleMidX) / baseline.hipWidth,
    ),
  );
  let maxSegmentJumpHipWidthRatio = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const jump =
      Math.hypot(
        samples[index].hipMidX - samples[index - 1].hipMidX,
        samples[index].hipMidY - samples[index - 1].hipMidY,
      ) / baseline.hipWidth;
    maxSegmentJumpHipWidthRatio = Math.max(
      maxSegmentJumpHipWidthRatio,
      jump,
    );
  }
  const overheadArmFrameFraction =
    samples.length === 0
      ? 0
      : samples.filter((sample) => sample.armsOverhead).length / samples.length;

  if (
    series.quality.validFrameFraction <
    config.qualityGates.validFrameFractionMin
  ) {
    reasons.push('Too many frames had low-confidence required landmarks.');
  }
  if (series.quality.inferenceFps < config.qualityGates.minInferenceFps) {
    reasons.push('Pose inference frame rate was below the quality threshold.');
  }
  if (
    ankleDriftHipWidthRatio >
    config.qualityGates.maxAnkleDriftHipWidthRatio
  ) {
    reasons.push('Foot position or camera framing moved during the trial.');
  }
  if (
    maxSegmentJumpHipWidthRatio >
    config.qualityGates.maxSegmentJumpHipWidthRatio
  ) {
    reasons.push('An implausible landmark jump was detected.');
  }
  if (
    config.movementId === 'overhead_squat_front' &&
    config.qualityGates.minOverheadArmFrameFraction !== undefined &&
    overheadArmFrameFraction <
      config.qualityGates.minOverheadArmFrameFraction
  ) {
    reasons.push('Both wrists were not overhead for enough valid frames.');
  }
  if (repWindows.length !== config.expectedRepetitions) {
    reasons.push(
      `Expected exactly ${config.expectedRepetitions} repetitions; detected ${repWindows.length}.`,
    );
  }

  if (reasons.length > 0) return { ok: false, reasons };

  const repetitions = repWindows.map((window, index) =>
    buildRepetitionMetric(
      samples,
      window,
      (index + 1) as 1 | 2 | 3,
      baseline,
      config.segmentation.bottomWindowMs,
    ),
  );
  const directions = repetitions.map(
    (repetition) => repetition.hipLateralDirection,
  );
  const metrics: MetricValue[] = [
    {
      metricId: 'hip_lateral_translation_ratio',
      value: median(
        repetitions.map(
          (repetition) => repetition.hipLateralTranslationRatio,
        ),
      ),
      unit: 'body_ratio',
      direction: aggregateDirection(directions),
      perRepetition: repetitions.map(
        (repetition) => repetition.hipLateralTranslationRatio,
      ),
    },
    {
      metricId: 'hip_knee_vertical_margin_ratio',
      value: median(
        repetitions.map(
          (repetition) => repetition.hipKneeVerticalMarginRatio,
        ),
      ),
      unit: 'body_ratio',
      direction: 'none',
      perRepetition: repetitions.map(
        (repetition) => repetition.hipKneeVerticalMarginRatio,
      ),
    },
  ];

  return {
    ok: true,
    metrics: {
      schemaVersion: config.metricSchemaVersion,
      trialId: series.trialId,
      entryPoint: series.entryPoint,
      movement: {
        movementId: config.movementId,
        expectedRepetitions: config.expectedRepetitions,
        neutralBaselineDurationMs:
          config.segmentation.neutralBaselineDurationMs,
      },
      source: series.source,
      model: series.model,
      quality: {
        ...series.quality,
        status: 'accepted',
        rejectionReasons: [],
        baselineFrameCount: baseline.frameCount,
        repetitionsDetected: repetitions.length,
        ankleDriftHipWidthRatio,
        maxSegmentJumpHipWidthRatio,
        ...(config.movementId === 'overhead_squat_front'
          ? { overheadArmFrameFraction }
          : {}),
      },
      processing: {
        baseline: {
          endTimestampMs: baseline.endTimestampMs,
          frameCount: baseline.frameCount,
          hipMidXPixels: baseline.hipMidX,
          hipMidYPixels: baseline.hipMidY,
          ankleMidXPixels: baseline.ankleMidX,
          hipWidthPixels: baseline.hipWidth,
          femurLengthPixels: baseline.femurLength,
          neutralOffsetXPixels: baseline.neutralOffsetX,
        },
        filteredTrajectory: samples.map((sample) => ({
          timestampMs: sample.frame.timestampMs,
          hipDescentRatio: sample.smoothedDescentRatio,
          hipTranslationSignedRatio:
            (sample.hipMidX -
              sample.ankleMidX -
              baseline.neutralOffsetX) /
            baseline.hipWidth,
          hipKneeVerticalMarginRatio:
            (sample.hipMidY - sample.kneeMidY) / baseline.femurLength,
        })),
      },
      repetitions,
      metrics,
    },
  };
}

export function estimateCompletedRepetitions(
  frames: PoseFrame[],
  source: LandmarkSeries['source'],
  config: RulesConfig,
): number {
  const samples = frames
    .filter((frame) =>
      poseFrameHasRequiredLandmarks(
        frame,
        config.qualityGates.landmarkConfidenceMin,
      ),
    )
    .map((frame) => sampleFrame(frame, source));
  const baseline = establishBaseline(
    samples,
    config.segmentation.neutralBaselineDurationMs,
  );
  if (!baseline) return 0;
  smoothDescent(
    samples,
    baseline,
    Math.round(config.segmentation.smoothingWindowFrames),
  );
  return segmentRepetitions(samples, baseline, config.segmentation).length;
}
