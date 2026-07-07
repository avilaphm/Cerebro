// Background-safe heartbeat for the Movement Screening camera pipeline.
// The live page normally submits frames from requestVideoFrameCallback so pose
// inference follows the real camera cadence. This worker only nudges inference
// when that clock stalls, and falls back for browsers without video-frame
// callbacks.

type MovementInferenceTickRequest =
  | { type: 'start'; fps: number }
  | { type: 'stop' };

let movementInferenceIntervalId: ReturnType<typeof setInterval> | null = null;

function stop() {
  if (movementInferenceIntervalId !== null) {
    clearInterval(movementInferenceIntervalId);
    movementInferenceIntervalId = null;
  }
}

self.onmessage = (event: MessageEvent<MovementInferenceTickRequest>) => {
  const message = event.data;
  if (message.type === 'start') {
    stop();
    movementInferenceIntervalId = setInterval(
      () => self.postMessage(0),
      1000 / message.fps,
    );
    return;
  }

  stop();
};
