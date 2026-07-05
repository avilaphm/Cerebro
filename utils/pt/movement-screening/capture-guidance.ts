import { REQUIRED_LANDMARK_INDEXES } from './constants';
import type { PoseFrame } from './contracts';
import { poseFrameHasRequiredLandmarks } from './pose-extraction/landmark-series';

export const FRAMING_HOLD_DURATION_MS = 3_000;
export const FINISH_HOLD_DURATION_MS = 3_000;

const CAPTURE_GUIDE_BOUNDS = {
  minX: 0.08,
  maxX: 0.92,
  minY: 0.04,
  maxY: 0.96,
} as const;

const MAX_STILL_LANDMARK_DISPLACEMENT = 0.035;

export function poseFrameFitsCaptureGuide(
  frame: PoseFrame,
  confidenceMin: number,
): boolean {
  if (!poseFrameHasRequiredLandmarks(frame, confidenceMin)) return false;

  return REQUIRED_LANDMARK_INDEXES.every((index) => {
    const landmark = frame.landmarks[index];
    return (
      landmark.x >= CAPTURE_GUIDE_BOUNDS.minX &&
      landmark.x <= CAPTURE_GUIDE_BOUNDS.maxX &&
      landmark.y >= CAPTURE_GUIDE_BOUNDS.minY &&
      landmark.y <= CAPTURE_GUIDE_BOUNDS.maxY
    );
  });
}

export function poseFrameMatchesBodyweightSquatStart(
  frame: PoseFrame,
  confidenceMin: number,
): boolean {
  if (!poseFrameFitsCaptureGuide(frame, confidenceMin)) return false;

  const leftShoulder = frame.landmarks[11];
  const rightShoulder = frame.landmarks[12];
  const leftWrist = frame.landmarks[15];
  const rightWrist = frame.landmarks[16];
  const leftHip = frame.landmarks[23];
  const rightHip = frame.landmarks[24];
  const leftKnee = frame.landmarks[25];
  const rightKnee = frame.landmarks[26];

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const kneeY = (leftKnee.y + rightKnee.y) / 2;
  const torsoHeight = hipY - shoulderY;
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
  if (torsoHeight <= 0 || shoulderWidth <= 0) return false;

  const wristY = (leftWrist.y + rightWrist.y) / 2;
  const horizontalAllowance = shoulderWidth * 0.75;
  const minWristX =
    Math.min(leftShoulder.x, rightShoulder.x) - horizontalAllowance;
  const maxWristX =
    Math.max(leftShoulder.x, rightShoulder.x) + horizontalAllowance;

  return (
    Math.abs(wristY - shoulderY) <= torsoHeight * 0.55 &&
    leftWrist.x >= minWristX &&
    leftWrist.x <= maxWristX &&
    rightWrist.x >= minWristX &&
    rightWrist.x <= maxWristX &&
    kneeY - hipY >= torsoHeight * 0.45
  );
}

export function poseFramesAreStill(
  anchor: PoseFrame,
  candidate: PoseFrame,
): boolean {
  return REQUIRED_LANDMARK_INDEXES.every((index) => {
    const anchorLandmark = anchor.landmarks[index];
    const candidateLandmark = candidate.landmarks[index];
    if (!anchorLandmark || !candidateLandmark) return false;

    return (
      Math.hypot(
        candidateLandmark.x - anchorLandmark.x,
        candidateLandmark.y - anchorLandmark.y,
      ) <= MAX_STILL_LANDMARK_DISPLACEMENT
    );
  });
}

export function continuousHoldElapsedMs(
  startedAtMs: number | null,
  timestampMs: number,
  qualifies: boolean,
): { startedAtMs: number | null; elapsedMs: number } {
  if (!qualifies) {
    return { startedAtMs: null, elapsedMs: 0 };
  }

  const nextStartedAtMs = startedAtMs ?? timestampMs;
  return {
    startedAtMs: nextStartedAtMs,
    elapsedMs: Math.max(0, timestampMs - nextStartedAtMs),
  };
}
