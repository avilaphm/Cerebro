import {
  FilesetResolver,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import {
  copyWorkerLandmarks,
  type PoseWorkerRequest,
  type PoseWorkerResponse,
} from './worker-protocol';

let poseLandmarker: PoseLandmarker | null = null;

function post(response: PoseWorkerResponse) {
  self.postMessage(response);
}

self.onmessage = async (event: MessageEvent<PoseWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'initialize') {
    try {
      poseLandmarker?.close();
      const fileset = await FilesetResolver.forVisionTasks(
        message.wasmBaseUrl,
        true,
      );
      poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: message.modelUrl,
          delegate: message.delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.7,
        minPosePresenceConfidence: 0.7,
        minTrackingConfidence: 0.7,
        outputSegmentationMasks: false,
      });
      post({ type: 'ready', delegate: message.delegate });
    } catch (error) {
      post({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Pose initialization failed',
        fatal: true,
      });
    }
    return;
  }

  if (message.type === 'close') {
    poseLandmarker?.close();
    poseLandmarker = null;
    self.close();
    return;
  }

  const { bitmap, timestampMs } = message;
  if (!poseLandmarker) {
    bitmap.close();
    post({
      type: 'error',
      message: 'Pose worker received a frame before initialization.',
      fatal: true,
    });
    return;
  }

  const startedAt = performance.now();
  try {
    const result = poseLandmarker.detectForVideo(bitmap, timestampMs);
    const landmarks = copyWorkerLandmarks(result.landmarks[0] ?? []);
    result.close();
    post({
      type: 'result',
      frame: {
        timestampMs,
        inferenceDurationMs: performance.now() - startedAt,
        landmarks,
      },
    });
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'Pose inference failed',
      fatal: false,
    });
  } finally {
    bitmap.close();
  }
};
