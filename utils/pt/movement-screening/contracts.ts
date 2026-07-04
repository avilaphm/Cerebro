export const LANDMARK_SERIES_SCHEMA_VERSION = 'landmark-series/1.0.0' as const;
export const METRICS_SCHEMA_VERSION = 'movement-metrics/1.0.0' as const;
export const RULES_SCHEMA_VERSION = 'movement-screening-rules/1.0.0' as const;
export const SCREENING_RESULT_SCHEMA_VERSION = 'screening-result/1.0.0' as const;

export type EntryPoint = 'live_camera' | 'uploaded_video' | 'self_screening';
export type CalibrationStatus = 'uncalibrated' | 'calibrating' | 'calibrated';
export type InferenceDelegate = 'GPU' | 'CPU';
export type WorkerMode = 'worker' | 'main_thread_diagnostic';
export type AnatomicalDirection = 'left' | 'right' | 'variable' | 'none';
export type QualityStatus = 'accepted' | 'rejected';

export interface SourceMetadata {
  width: number;
  height: number;
  orientationDegrees: 0 | 90 | 180 | 270;
  previewMirrored: boolean;
  inferenceMirrored: false;
  browser: string;
  device: string;
}

export interface InputFrame {
  trialId: string;
  timestampMs: number;
  bitmap: ImageBitmap;
  source: SourceMetadata;
}

export interface FrameSource {
  readonly entryPoint: EntryPoint;
  readonly source: SourceMetadata;
  start(
    onFrame: (frame: InputFrame) => void,
    signal: AbortSignal,
  ): Promise<void>;
  stop(): Promise<void>;
}

export interface PoseLandmark {
  index: number;
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
}

export interface PoseFrame {
  timestampMs: number;
  inferenceDurationMs: number;
  landmarks: PoseLandmark[];
}

export interface PoseModelProvenance {
  packageName: '@mediapipe/tasks-vision';
  packageVersion: '0.10.35';
  modelName: 'pose_landmarker_full_float16_v1';
  modelSha256: string;
  delegate: InferenceDelegate;
  workerMode: WorkerMode;
}

export interface LandmarkQualitySummary {
  totalFrames: number;
  validFrames: number;
  validFrameFraction: number;
  inferenceFps: number;
  medianInferenceDurationMs: number;
  droppedFrames: number;
}

export interface LandmarkSeries {
  schemaVersion: typeof LANDMARK_SERIES_SCHEMA_VERSION;
  trialId: string;
  entryPoint: EntryPoint;
  source: SourceMetadata;
  model: PoseModelProvenance;
  frames: PoseFrame[];
  quality: LandmarkQualitySummary;
}

export interface MovementContext {
  movementId: 'overhead_squat_front';
  expectedRepetitions: 3;
  neutralBaselineDurationMs: number;
}

export interface RepetitionMetric {
  repetition: 1 | 2 | 3;
  startedAtMs: number;
  bottomAtMs: number;
  endedAtMs: number;
  hipLateralTranslationRatio: number;
  hipLateralTranslationSignedRatio: number;
  hipLateralDirection: AnatomicalDirection;
  hipKneeVerticalMarginRatio: number;
}

export interface MetricValue {
  metricId: 'hip_lateral_translation_ratio' | 'hip_knee_vertical_margin_ratio';
  value: number;
  unit: 'body_ratio';
  direction: AnatomicalDirection;
  perRepetition: number[];
}

export interface MovementQualitySummary extends LandmarkQualitySummary {
  status: QualityStatus;
  rejectionReasons: string[];
  baselineFrameCount: number;
  repetitionsDetected: number;
  ankleDriftHipWidthRatio: number;
  maxSegmentJumpHipWidthRatio: number;
  overheadArmFrameFraction: number;
}

export interface MovementMetrics {
  schemaVersion: typeof METRICS_SCHEMA_VERSION;
  trialId: string;
  entryPoint: EntryPoint;
  movement: MovementContext;
  source: SourceMetadata;
  model: PoseModelProvenance;
  quality: MovementQualitySummary;
  processing: {
    baseline: {
      endTimestampMs: number;
      frameCount: number;
      hipMidXPixels: number;
      hipMidYPixels: number;
      ankleMidXPixels: number;
      hipWidthPixels: number;
      femurLengthPixels: number;
      neutralOffsetXPixels: number;
    };
    filteredTrajectory: Array<{
      timestampMs: number;
      hipDescentRatio: number;
      hipTranslationSignedRatio: number;
      hipKneeVerticalMarginRatio: number;
    }>;
  };
  repetitions: RepetitionMetric[];
  metrics: MetricValue[];
}

export interface QualityGateConfig {
  landmarkConfidenceMin: number;
  validFrameFractionMin: number;
  minInferenceFps: number;
  maxAnkleDriftHipWidthRatio: number;
  maxSegmentJumpHipWidthRatio: number;
  minOverheadArmFrameFraction: number;
}

export interface SegmentationConfig {
  neutralBaselineDurationMs: number;
  smoothingWindowFrames: number;
  descentStartRatio: number;
  standingReturnRatio: number;
  minimumBottomDescentRatio: number;
  minimumRepDurationMs: number;
  maximumRepDurationMs: number;
  bottomWindowMs: number;
}

export type FindingSeverity = 'indeterminate' | 'low' | 'moderate' | 'high';

export interface RuleBand {
  bandId: string;
  severity: FindingSeverity;
  message: string;
  minInclusive?: number;
  maxExclusive?: number;
}

export interface MetricRuleGroup {
  ruleId: string;
  metricId: MetricValue['metricId'];
  findingCode: string;
  label: string;
  includeMetricDirection: boolean;
  bands: RuleBand[];
}

export interface RulesConfig {
  movementId: MovementContext['movementId'];
  metricSchemaVersion: typeof METRICS_SCHEMA_VERSION;
  expectedRepetitions: 3;
  qualityGates: QualityGateConfig;
  segmentation: SegmentationConfig;
  ruleGroups: MetricRuleGroup[];
  metadata: {
    purpose: string;
    thresholdSource: string;
    calibrationFixtureIds: string[];
    pedroReasons: string[];
  };
}

export interface RulesEnvelope {
  schemaVersion: typeof RULES_SCHEMA_VERSION;
  version: number;
  status: 'active';
  calibrationStatus: CalibrationStatus;
  configSha256: string;
  config: RulesConfig;
}

export interface StructuredFinding {
  findingCode: string;
  label: string;
  severity: FindingSeverity;
  message: string;
  metricId: MetricValue['metricId'];
  metricValue: number;
  comparison: {
    minInclusive?: number;
    maxExclusive?: number;
  };
  direction: AnatomicalDirection;
  matchedRuleId: string;
  matchedBandId: string;
}

export interface ScreeningResult {
  schemaVersion: typeof SCREENING_RESULT_SCHEMA_VERSION;
  trialId: string;
  entryPoint: EntryPoint;
  movementId: MovementContext['movementId'];
  source: SourceMetadata;
  model: PoseModelProvenance;
  quality: MovementQualitySummary;
  metricsSchemaVersion: typeof METRICS_SCHEMA_VERSION;
  rulesSchemaVersion: typeof RULES_SCHEMA_VERSION;
  rulesVersion: number;
  rulesConfigSha256: string;
  calibrationStatus: CalibrationStatus;
  perRepetition: RepetitionMetric[];
  metrics: MetricValue[];
  findings: StructuredFinding[];
}

export interface CalibrationBundle {
  exportedAt: string;
  videoFileName: string;
  result: ScreeningResult;
  metrics: MovementMetrics;
  landmarks: LandmarkSeries;
}

export type PipelineFailureStage =
  | 'pose_extraction'
  | 'metrics_extraction'
  | 'rules_engine';

export interface PipelineFailure {
  ok: false;
  stage: PipelineFailureStage;
  reasons: string[];
}

export interface PipelineSuccess {
  ok: true;
  result: ScreeningResult;
  metrics: MovementMetrics;
}

export type PipelineOutcome = PipelineSuccess | PipelineFailure;
