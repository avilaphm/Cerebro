import type { PoseModelProvenance } from './contracts';

export const MEDIAPIPE_PACKAGE_VERSION = '0.10.35' as const;
export const MEDIAPIPE_ASSET_BASE = '/vendor/mediapipe/0.10.35';
export const MEDIAPIPE_WASM_BASE = `${MEDIAPIPE_ASSET_BASE}/wasm`;
export const MEDIAPIPE_MODEL_PATH =
  `${MEDIAPIPE_ASSET_BASE}/models/pose_landmarker_full_float16_v1.task`;

export const POSE_MODEL_SHA256 =
  '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1';

export const WORKER_MODEL_PROVENANCE = {
  packageName: '@mediapipe/tasks-vision',
  packageVersion: MEDIAPIPE_PACKAGE_VERSION,
  modelName: 'pose_landmarker_full_float16_v1',
  modelSha256: POSE_MODEL_SHA256,
  workerMode: 'worker',
} as const satisfies Omit<PoseModelProvenance, 'delegate'>;

export const REQUIRED_LANDMARK_INDEXES = [
  11, 12, // shoulders
  15, 16, // wrists
  23, 24, // hips
  25, 26, // knees
  27, 28, // ankles
] as const;

export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
] as const;
