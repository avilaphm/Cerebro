import { REQUIRED_LANDMARK_INDEXES } from '../constants';
import {
  LANDMARK_SERIES_SCHEMA_VERSION,
  type EntryPoint,
  type LandmarkSeries,
  type PoseFrame,
  type PoseModelProvenance,
  type SourceMetadata,
} from '../contracts';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function poseFrameHasRequiredLandmarks(
  frame: PoseFrame,
  confidenceMin: number,
): boolean {
  return REQUIRED_LANDMARK_INDEXES.every((index) => {
    const landmark = frame.landmarks[index];
    return (
      landmark &&
      Number.isFinite(landmark.x) &&
      Number.isFinite(landmark.y) &&
      landmark.visibility >= confidenceMin &&
      landmark.presence >= confidenceMin
    );
  });
}

export function createLandmarkSeries(input: {
  trialId: string;
  entryPoint: EntryPoint;
  source: SourceMetadata;
  model: PoseModelProvenance;
  frames: PoseFrame[];
  droppedFrames: number;
  confidenceMin: number;
}): LandmarkSeries {
  const frames = [...input.frames].sort(
    (left, right) => left.timestampMs - right.timestampMs,
  );
  const validFrames = frames.filter((frame) =>
    poseFrameHasRequiredLandmarks(frame, input.confidenceMin),
  );
  const deltas = validFrames
    .slice(1)
    .map((frame, index) => frame.timestampMs - validFrames[index].timestampMs)
    .filter((delta) => delta > 0);
  const medianDelta = median(deltas);

  return {
    schemaVersion: LANDMARK_SERIES_SCHEMA_VERSION,
    trialId: input.trialId,
    entryPoint: input.entryPoint,
    source: input.source,
    model: input.model,
    frames,
    quality: {
      totalFrames: frames.length,
      validFrames: validFrames.length,
      validFrameFraction:
        frames.length === 0 ? 0 : validFrames.length / frames.length,
      inferenceFps: medianDelta === 0 ? 0 : 1000 / medianDelta,
      medianInferenceDurationMs: median(
        frames.map((frame) => frame.inferenceDurationMs),
      ),
      droppedFrames: input.droppedFrames,
    },
  };
}
