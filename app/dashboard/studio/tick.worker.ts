// Background-safe frame ticker for the Studio compositor. requestAnimationFrame
// is throttled to ~1fps on a hidden tab, which froze the recorded canvas the
// moment the user switched to another tab or app mid-recording. A setInterval
// running inside this Web Worker keeps firing at the requested rate regardless
// of tab visibility. The main thread normally draws from video-frame callbacks;
// this worker acts as the background-safe heartbeat when those callbacks stall.

type TickRequest = { type: 'start'; fps: number } | { type: 'stop' };

let intervalId: ReturnType<typeof setInterval> | null = null;

function stop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

self.onmessage = (event: MessageEvent<TickRequest>) => {
  const message = event.data;
  if (message.type === 'start') {
    stop();
    intervalId = setInterval(() => self.postMessage(0), 1000 / message.fps);
  } else {
    stop();
  }
};
