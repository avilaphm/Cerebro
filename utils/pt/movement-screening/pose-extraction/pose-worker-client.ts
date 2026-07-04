import {
  MEDIAPIPE_MODEL_PATH,
  MEDIAPIPE_WASM_BASE,
} from '../constants';
import type {
  InferenceDelegate,
  PoseFrame,
} from '../contracts';
import type {
  PoseWorkerRequest,
  PoseWorkerResponse,
} from './worker-protocol';

interface PoseWorkerClientOptions {
  onFrame: (frame: PoseFrame) => void;
  onError: (message: string) => void;
  initializationTimeoutMs?: number;
}

export class PoseWorkerClient {
  private worker: Worker | null = null;
  private busy = false;
  private ready = false;
  private droppedFrames = 0;
  private delegate: InferenceDelegate | null = null;
  private readonly onFrame: (frame: PoseFrame) => void;
  private readonly onError: (message: string) => void;
  private readonly initializationTimeoutMs: number;

  constructor(options: PoseWorkerClientOptions) {
    this.onFrame = options.onFrame;
    this.onError = options.onError;
    this.initializationTimeoutMs =
      options.initializationTimeoutMs ?? 45_000;
  }

  async initialize(): Promise<InferenceDelegate> {
    let lastError = 'Pose worker initialization failed.';
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        await this.initializeDelegate(delegate);
        return delegate;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
        this.worker?.terminate();
        this.worker = null;
      }
    }
    throw new Error(
      `MediaPipe could not initialize in a worker with GPU or CPU. ${lastError}`,
    );
  }

  private initializeDelegate(delegate: InferenceDelegate): Promise<void> {
    this.ready = false;
    this.busy = false;
    const worker = new Worker(
      new URL('./pose-landmarker.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error(`${delegate} worker initialization timed out.`));
      }, this.initializationTimeoutMs);

      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        reject(new Error(event.message || `${delegate} worker failed.`));
      };
      worker.onmessage = (event: MessageEvent<PoseWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          this.delegate = message.delegate;
          this.ready = true;
          resolve();
          return;
        }
        if (message.type === 'error') {
          if (!this.ready || message.fatal) {
            window.clearTimeout(timeout);
            reject(new Error(message.message));
          } else {
            this.busy = false;
            this.onError(message.message);
          }
          return;
        }
        this.busy = false;
        this.onFrame(message.frame);
      };

      const request: PoseWorkerRequest = {
        type: 'initialize',
        wasmBaseUrl: new URL(MEDIAPIPE_WASM_BASE, window.location.origin).href,
        modelUrl: new URL(MEDIAPIPE_MODEL_PATH, window.location.origin).href,
        delegate,
      };
      worker.postMessage(request);
    });
  }

  canAcceptFrame(): boolean {
    return this.ready && !this.busy;
  }

  submit(bitmap: ImageBitmap, timestampMs: number): boolean {
    if (!this.worker || !this.canAcceptFrame()) {
      bitmap.close();
      this.droppedFrames += 1;
      return false;
    }

    this.busy = true;
    const request: PoseWorkerRequest = {
      type: 'frame',
      timestampMs,
      bitmap,
    };
    this.worker.postMessage(request, [bitmap]);
    return true;
  }

  getDelegate(): InferenceDelegate {
    if (!this.delegate) {
      throw new Error('Pose worker delegate requested before initialization.');
    }
    return this.delegate;
  }

  getDroppedFrames(): number {
    return this.droppedFrames;
  }

  noteDroppedFrame() {
    this.droppedFrames += 1;
  }

  close() {
    if (this.worker) {
      const request: PoseWorkerRequest = { type: 'close' };
      this.worker.postMessage(request);
      this.worker.terminate();
    }
    this.worker = null;
    this.ready = false;
    this.busy = false;
  }
}
