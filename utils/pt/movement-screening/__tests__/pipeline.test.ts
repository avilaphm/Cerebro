import assert from 'node:assert/strict';
import test from 'node:test';
import fixtureJson from '../fixtures/phase-1-uncalibrated-v1.json';
import { createFrontCameraConstraints } from '../camera-constraints';
import { sha256CanonicalJson } from '../canonical-json';
import {
  jsonFileNameForVideo,
  selectRecorderFormat,
  videoExtensionForMimeType,
} from '../capture-format';
import { MEDIAPIPE_WASM_USE_MODULE } from '../constants';
import type {
  EntryPoint,
  FrameSource,
  InputFrame,
  MovementMetrics,
  PoseFrame,
  PoseLandmark,
  RulesEnvelope,
  SourceMetadata,
  StructuredFinding,
} from '../contracts';
import { runMovementScreeningPipeline } from '../pipeline';
import { createLandmarkSeries } from '../pose-extraction/landmark-series';
import { copyWorkerLandmarks } from '../pose-extraction/worker-protocol';
import { validateRulesEnvelope } from '../rules-engine';
import { evaluateRules } from '../rules-engine';

const rules = fixtureJson as RulesEnvelope;
const source: SourceMetadata = {
  width: 1280,
  height: 720,
  orientationDegrees: 0,
  previewMirrored: true,
  inferenceMirrored: false,
  browser: 'synthetic-test',
  device: 'synthetic-test',
};

test('capture format supports WebM and iPhone MP4 evidence pairs', () => {
  assert.deepEqual(
    selectRecorderFormat((mimeType) => mimeType === 'video/mp4'),
    {
      mimeType: 'video/mp4',
      extension: 'mp4',
    },
  );
  assert.equal(
    videoExtensionForMimeType('video/mp4;codecs=avc1.42E01E'),
    'mp4',
  );
  assert.equal(videoExtensionForMimeType('video/webm;codecs=vp8'), 'webm');
  assert.equal(
    jsonFileNameForVideo('cerebro-ohs-trial.mp4'),
    'cerebro-ohs-trial.json',
  );
  assert.equal(
    jsonFileNameForVideo('cerebro-ohs-trial.webm'),
    'cerebro-ohs-trial.json',
  );
});

test('MediaPipe uses its classic WASM loader inside the classic Turbopack worker', () => {
  assert.equal(MEDIAPIPE_WASM_USE_MODULE, false);
});

test('front camera constraints follow the screen orientation', () => {
  assert.deepEqual(createFrontCameraConstraints(true), {
    facingMode: 'user',
    width: { ideal: 720 },
    height: { ideal: 1280 },
    aspectRatio: { ideal: 9 / 16 },
    frameRate: { ideal: 30, max: 30 },
  });
  assert.deepEqual(createFrontCameraConstraints(false), {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 },
    frameRate: { ideal: 30, max: 30 },
  });
});

function landmark(
  index: number,
  x: number,
  y: number,
  confidence = 1,
): PoseLandmark {
  return {
    index,
    x,
    y,
    z: 0,
    visibility: confidence,
    presence: confidence,
  };
}

function makeFrame(input: {
  timestampMs: number;
  phase: number;
  bottomHipY: number;
  hipShift: number;
  confidence?: number;
}): PoseFrame {
  const squatShape = Math.sin(Math.PI * input.phase);
  const hipY = 0.4 + (input.bottomHipY - 0.4) * squatShape;
  const hipCenterX = 0.5 + input.hipShift * squatShape;
  const kneeY = 0.68;
  const confidence = input.confidence ?? 1;
  const landmarks = Array.from({ length: 33 }, (_, index) =>
    landmark(index, 0.5, 0.5, confidence),
  );

  landmarks[11] = landmark(11, 0.42, 0.3, confidence);
  landmarks[12] = landmark(12, 0.58, 0.3, confidence);
  landmarks[15] = landmark(15, 0.4, 0.12, confidence);
  landmarks[16] = landmark(16, 0.6, 0.12, confidence);
  landmarks[23] = landmark(23, hipCenterX - 0.1, hipY, confidence);
  landmarks[24] = landmark(24, hipCenterX + 0.1, hipY, confidence);
  landmarks[25] = landmark(25, 0.4, kneeY, confidence);
  landmarks[26] = landmark(26, 0.6, kneeY, confidence);
  landmarks[27] = landmark(27, 0.4, 0.9, confidence);
  landmarks[28] = landmark(28, 0.6, 0.9, confidence);

  return {
    timestampMs: input.timestampMs,
    inferenceDurationMs: 10,
    landmarks,
  };
}

function syntheticTrial(input?: {
  entryPoint?: EntryPoint;
  bottomHipY?: number;
  hipShift?: number;
  confidence?: number;
  repetitionCount?: number;
}) {
  const frames: PoseFrame[] = [];
  const frameDuration = 1000 / 30;
  let timestampMs = 0;

  while (timestampMs <= 3200) {
    frames.push(
      makeFrame({
        timestampMs,
        phase: 0,
        bottomHipY: input?.bottomHipY ?? 0.72,
        hipShift: 0,
        confidence: input?.confidence,
      }),
    );
    timestampMs += frameDuration;
  }

  for (
    let repetition = 0;
    repetition < (input?.repetitionCount ?? 3);
    repetition += 1
  ) {
    const repDurationMs = 1600;
    const repStart = timestampMs;
    while (timestampMs - repStart <= repDurationMs) {
      const elapsed = timestampMs - repStart;
      const phase =
        elapsed < 200
          ? 0
          : elapsed > 1400
            ? 0
            : (elapsed - 200) / 1200;
      frames.push(
        makeFrame({
          timestampMs,
          phase,
          bottomHipY: input?.bottomHipY ?? 0.72,
          hipShift: input?.hipShift ?? 0.01,
          confidence: input?.confidence,
        }),
      );
      timestampMs += frameDuration;
    }
  }

  while (timestampMs <= 8800) {
    frames.push(
      makeFrame({
        timestampMs,
        phase: 0,
        bottomHipY: input?.bottomHipY ?? 0.72,
        hipShift: 0,
        confidence: input?.confidence,
      }),
    );
    timestampMs += frameDuration;
  }

  return createLandmarkSeries({
    trialId: 'synthetic-trial',
    entryPoint: input?.entryPoint ?? 'live_camera',
    source,
    model: {
      packageName: '@mediapipe/tasks-vision',
      packageVersion: '0.10.35',
      modelName: 'pose_landmarker_full_float16_v1',
      modelSha256:
        '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
      delegate: 'GPU',
      workerMode: 'worker',
    },
    frames,
    droppedFrames: 0,
    confidenceMin: rules.config.qualityGates.landmarkConfidenceMin,
  });
}

test('the checked-in rules fixture is valid and hash-linked', async () => {
  const validated = validateRulesEnvelope(fixtureJson);
  assert.equal(
    await sha256CanonicalJson(validated.config),
    validated.configSha256,
  );
  assert.equal(validated.calibrationStatus, 'uncalibrated');
  assert.equal(validated.config.metadata.calibrationFixtureIds.length, 0);
});

test('MediaPipe visibility supplies the shared presence proxy', () => {
  const copied = copyWorkerLandmarks([
    { x: 0.1, y: 0.2, z: 0, visibility: 0.87 },
  ]);
  assert.equal(copied[0].visibility, 0.87);
  assert.equal(copied[0].presence, 0.87);
});

test('a clean synthetic three-rep trial passes without findings', () => {
  const outcome = runMovementScreeningPipeline(syntheticTrial(), rules);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.findings.length, 0);
  assert.equal(outcome.result.perRepetition.length, 3);
  assert.equal(outcome.result.rulesVersion, 1);
  assert.equal(outcome.result.calibrationStatus, 'uncalibrated');
});

test('lateral translation is detected with anatomical direction', () => {
  const outcome = runMovementScreeningPipeline(
    syntheticTrial({ hipShift: 0.09 }),
    rules,
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const finding = outcome.result.findings.find(
    (candidate) => candidate.findingCode === 'lateral_hip_translation',
  );
  assert.ok(finding);
  assert.equal(finding.direction, 'left');
  assert.equal(finding.severity, 'high');
});

test('the front-view depth proxy produces an insufficient-depth finding', () => {
  const outcome = runMovementScreeningPipeline(
    syntheticTrial({ bottomHipY: 0.62 }),
    rules,
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const finding = outcome.result.findings.find(
    (candidate) => candidate.findingCode === 'squat_depth_proxy',
  );
  assert.ok(finding);
  assert.equal(finding.matchedBandId, 'insufficient');
  assert.equal(finding.severity, 'moderate');
});

test('the exact depth deadband is indeterminate and its upper edge passes', () => {
  const borderline = runMovementScreeningPipeline(
    syntheticTrial({ bottomHipY: 0.68 }),
    rules,
  );
  assert.equal(borderline.ok, true);
  if (!borderline.ok) return;
  assert.equal(
    borderline.result.findings.find(
      (candidate) => candidate.findingCode === 'squat_depth_proxy',
    )?.severity,
    'indeterminate',
  );

  const boundaryMetrics = structuredClone(borderline.metrics);
  const depthMetric = boundaryMetrics.metrics.find(
    (metric) => metric.metricId === 'hip_knee_vertical_margin_ratio',
  );
  assert.ok(depthMetric);
  depthMetric.value = 0.05;
  const result = evaluateRules(boundaryMetrics, rules);
  assert.equal(
    result.findings.some(
      (candidate) => candidate.findingCode === 'squat_depth_proxy',
    ),
    false,
  );
});

test('low-confidence required landmarks reject the trial', () => {
  const outcome = runMovementScreeningPipeline(
    syntheticTrial({ confidence: 0.4 }),
    rules,
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.stage, 'metrics_extraction');
  assert.match(outcome.reasons.join(' '), /neutral baseline/i);
});

test('missing required landmarks fail before metrics are inferred', () => {
  const landmarks = syntheticTrial();
  landmarks.frames.forEach((frame) => {
    frame.landmarks[23].visibility = 0;
    frame.landmarks[23].presence = 0;
  });
  const outcome = runMovementScreeningPipeline(landmarks, rules);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.reasons.join(' '), /neutral baseline/i);
});

test('camera or foot-position movement fails the ankle-drift quality gate', () => {
  const landmarks = syntheticTrial();
  landmarks.frames.slice(Math.floor(landmarks.frames.length / 2)).forEach((frame) => {
    frame.landmarks[27].x += 0.1;
    frame.landmarks[28].x += 0.1;
  });
  const outcome = runMovementScreeningPipeline(landmarks, rules);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.reasons.join(' '), /foot position|camera framing/i);
});

test('fewer or more than three repetitions are rejected', () => {
  for (const repetitionCount of [2, 4]) {
    const outcome = runMovementScreeningPipeline(
      syntheticTrial({ repetitionCount }),
      rules,
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) continue;
    assert.match(outcome.reasons.join(' '), /exactly 3 repetitions/i);
  }
});

test('invalid and overlapping rule bands fail closed', () => {
  const invalid = structuredClone(fixtureJson) as unknown as RulesEnvelope;
  invalid.config.ruleGroups[0].bands[1].minInclusive = 0.2;
  assert.throws(
    () => validateRulesEnvelope(invalid),
    /overlapping bands/i,
  );
});

test('hip-severity boundaries are inclusive and preserve thresholds', () => {
  const outcome = runMovementScreeningPipeline(syntheticTrial(), rules);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const expected = [
    { value: 0.15, severity: 'low' },
    { value: 0.25, severity: 'moderate' },
    { value: 0.4, severity: 'high' },
  ] as const;
  for (const boundary of expected) {
    const boundaryMetrics: MovementMetrics = structuredClone(outcome.metrics);
    const hipMetric = boundaryMetrics.metrics.find(
      (metric) => metric.metricId === 'hip_lateral_translation_ratio',
    );
    assert.ok(hipMetric);
    hipMetric.value = boundary.value;
    const finding: StructuredFinding | undefined = evaluateRules(
      boundaryMetrics,
      rules,
    ).findings.find(
      (candidate) => candidate.findingCode === 'lateral_hip_translation',
    );
    assert.equal(finding?.severity, boundary.severity);
    assert.equal(finding?.comparison.minInclusive, boundary.value);
  }
});

test('identical inputs return deterministic findings and preserve entry point', () => {
  const landmarks = syntheticTrial({ entryPoint: 'uploaded_video', hipShift: -0.09 });
  const first = runMovementScreeningPipeline(landmarks, rules);
  const second = runMovementScreeningPipeline(landmarks, rules);
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.result.entryPoint, 'uploaded_video');
  assert.equal(first.result.findings[0]?.direction, 'right');
});

test('an abortable frame source stops without emitting another frame', async () => {
  class AbortableFakeFrameSource implements FrameSource {
    readonly entryPoint = 'uploaded_video' as const;
    readonly source = source;
    stopped = false;

    async start(
      _onFrame: (frame: InputFrame) => void,
      signal: AbortSignal,
    ): Promise<void> {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      await this.stop();
    }

    async stop(): Promise<void> {
      this.stopped = true;
    }
  }

  const fakeSource = new AbortableFakeFrameSource();
  const controller = new AbortController();
  const running = fakeSource.start(() => {
    assert.fail('No frame should be emitted after cancellation.');
  }, controller.signal);
  controller.abort();
  await running;
  assert.equal(fakeSource.stopped, true);
});
