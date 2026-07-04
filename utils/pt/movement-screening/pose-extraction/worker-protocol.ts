import type {
  InferenceDelegate,
  PoseFrame,
  PoseLandmark,
} from '../contracts';

export type PoseWorkerRequest =
  | {
      type: 'initialize';
      wasmBaseUrl: string;
      modelUrl: string;
      delegate: InferenceDelegate;
    }
  | {
      type: 'frame';
      timestampMs: number;
      bitmap: ImageBitmap;
    }
  | { type: 'close' };

export type PoseWorkerResponse =
  | { type: 'ready'; delegate: InferenceDelegate }
  | {
      type: 'result';
      frame: PoseFrame;
    }
  | {
      type: 'error';
      message: string;
      fatal: boolean;
    };

export function copyWorkerLandmarks(
  landmarks: Array<{
    x: number;
    y: number;
    z: number;
    visibility?: number;
    presence?: number;
  }>,
): PoseLandmark[] {
  return landmarks.map((landmark, index) => ({
    index,
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility ?? 0,
    // The web NormalizedLandmark contract exposes visibility but no
    // per-landmark presence value. Pose presence is already gated by the task;
    // use visibility as the per-landmark presence proxy for shared contracts.
    presence: landmark.presence ?? landmark.visibility ?? 0,
  }));
}
