'use client';

import {
  AlertTriangle,
  Camera,
  Check,
  CircleStop,
  Download,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  Video,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  POSE_CONNECTIONS,
  WORKER_MODEL_PROVENANCE,
} from '@/utils/pt/movement-screening/constants';
import {
  createFrontCameraConstraints,
  requestMinimumCameraZoom,
} from '@/utils/pt/movement-screening/camera-constraints';
import {
  continuousHoldElapsedMs,
  FINISH_HOLD_DURATION_MS,
  FRAMING_HOLD_DURATION_MS,
  poseFrameFitsCaptureGuide,
  poseFrameMatchesBodyweightSquatStart,
  poseFramesAreStill,
} from '@/utils/pt/movement-screening/capture-guidance';
import {
  jsonFileNameForVideo,
  selectRecorderFormat,
  videoExtensionForMimeType,
} from '@/utils/pt/movement-screening/capture-format';
import {
  type CalibrationBundle,
  type LandmarkSeries,
  type PipelineOutcome,
  type PoseFrame,
  type RulesEnvelope,
  type SourceMetadata,
} from '@/utils/pt/movement-screening/contracts';
import { estimateCompletedRepetitions } from '@/utils/pt/movement-screening/metrics-extraction';
import { runMovementScreeningPipeline } from '@/utils/pt/movement-screening/pipeline';
import { createLandmarkSeries } from '@/utils/pt/movement-screening/pose-extraction/landmark-series';
import { PoseWorkerClient } from '@/utils/pt/movement-screening/pose-extraction/pose-worker-client';

type RuntimeState =
  | 'idle'
  | 'starting_camera'
  | 'loading_model'
  | 'ready'
  | 'capturing'
  | 'processing'
  | 'complete'
  | 'error';

interface DiagnosticBundle {
  schemaVersion: 'screening-diagnostic/1.0.0';
  exportedAt: string;
  videoFileName: string;
  rulesVersion: number;
  rulesConfigSha256: string;
  calibrationStatus: RulesEnvelope['calibrationStatus'];
  outcome: PipelineOutcome;
  landmarks: LandmarkSeries;
}

type ExportBundle = CalibrationBundle | DiagnosticBundle;

const MAX_CAPTURE_SECONDS = 25;
const OVERLAY_GREEN = '#42ff88';
const TEMPO_CUE = '2s down · 1s pause · 2s up';
const EXPECTED_REPETITIONS = 3;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function makeJsonBlob(exportBundle: ExportBundle): Blob {
  return new Blob([JSON.stringify(exportBundle, null, 2)], {
    type: 'application/json',
  });
}

async function waitForFirstVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The camera opened but did not provide a video frame.'));
    }, 5_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
    };
    const handleCanPlay = () => {
      cleanup();
      requestAnimationFrame(() => resolve());
    };
    const handleError = () => {
      cleanup();
      reject(new Error('The camera preview could not start.'));
    };
    video.addEventListener('canplay', handleCanPlay, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

function runtimeLabel(state: RuntimeState): string {
  switch (state) {
    case 'starting_camera':
      return 'Opening camera';
    case 'loading_model':
      return 'Loading pose model';
    case 'ready':
      return 'Ready to record';
    case 'capturing':
      return 'Recording locally';
    case 'processing':
      return 'Analysing three reps';
    case 'complete':
      return 'Trial complete';
    case 'error':
      return 'Needs attention';
    default:
      return 'Camera off';
  }
}

export default function MovementScreeningPhaseOne({
  rules,
}: {
  rules: RulesEnvelope;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<PoseWorkerClient | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const captureTimerRef = useRef<number | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  const captureStartRef = useRef(0);
  const trialIdRef = useRef<string | null>(null);
  const captureFramesRef = useRef<PoseFrame[]>([]);
  const captureDroppedStartRef = useRef(0);
  const capturingRef = useRef(false);
  const bitmapPendingRef = useRef(false);
  const lastFrameRequestRef = useRef(0);
  const lastRepEstimateRef = useRef(0);
  const detectedRepetitionsRef = useRef(0);
  const autoFinishingRef = useRef(false);
  const autoStartingRef = useRef(false);
  const framingHoldStartRef = useRef<number | null>(null);
  const finishHoldStartRef = useRef<number | null>(null);
  const finishHoldAnchorRef = useRef<PoseFrame | null>(null);
  const sourceRef = useRef<SourceMetadata | null>(null);
  const runtimeStateRef = useRef<RuntimeState>('idle');
  const startTrialRef = useRef<() => void>(() => {});
  const finishTrialRef = useRef<() => Promise<void>>(async () => {});
  const videoUrlRef = useRef<string | null>(null);

  const [runtimeState, setRuntimeState] = useState<RuntimeState>('idle');
  const [source, setSource] = useState<SourceMetadata | null>(null);
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null);
  const [trackingReady, setTrackingReady] = useState(false);
  const [startPoseReady, setStartPoseReady] = useState(false);
  const [framingHoldMs, setFramingHoldMs] = useState(0);
  const [finishHoldMs, setFinishHoldMs] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [detectedRepetitions, setDetectedRepetitions] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PipelineOutcome | null>(null);
  const [exportBundle, setExportBundle] = useState<ExportBundle | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const isBodyweightSquat =
    rules.config.movementId === 'bodyweight_squat_front';

  const transitionRuntimeState = useCallback((nextState: RuntimeState) => {
    runtimeStateRef.current = nextState;
    setRuntimeState(nextState);
  }, []);

  const drawPose = useCallback((frame: PoseFrame) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (frame.landmarks.length === 0) return;

    context.strokeStyle = OVERLAY_GREEN;
    context.fillStyle = OVERLAY_GREEN;
    context.lineWidth = Math.max(1.25, canvas.width / 900);
    context.globalAlpha = 0.88;

    for (const [from, to] of POSE_CONNECTIONS) {
      const start = frame.landmarks[from];
      const end = frame.landmarks[to];
      if (!start || !end || start.visibility < 0.5 || end.visibility < 0.5) {
        continue;
      }
      context.beginPath();
      context.moveTo(start.x * canvas.width, start.y * canvas.height);
      context.lineTo(end.x * canvas.width, end.y * canvas.height);
      context.stroke();
    }

    for (const landmark of frame.landmarks) {
      if (landmark.visibility < 0.5) continue;
      context.beginPath();
      context.arc(
        landmark.x * canvas.width,
        landmark.y * canvas.height,
        Math.max(2.5, canvas.width / 320),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
  }, []);

  const handlePoseFrame = useCallback(
    (frame: PoseFrame) => {
      drawPose(frame);
      const fitsCaptureGuide = poseFrameFitsCaptureGuide(
        frame,
        rules.config.qualityGates.landmarkConfidenceMin,
      );
      const matchesStartPose = isBodyweightSquat
        ? poseFrameMatchesBodyweightSquatStart(
            frame,
            rules.config.qualityGates.landmarkConfidenceMin,
          )
        : fitsCaptureGuide;
      setTrackingReady(fitsCaptureGuide);
      setStartPoseReady(matchesStartPose);

      if (!capturingRef.current) {
        if (runtimeStateRef.current === 'ready') {
          const hold = continuousHoldElapsedMs(
            framingHoldStartRef.current,
            frame.timestampMs,
            matchesStartPose,
          );
          framingHoldStartRef.current = hold.startedAtMs;
          setFramingHoldMs(
            Math.min(
              FRAMING_HOLD_DURATION_MS,
              Math.floor(hold.elapsedMs / 100) * 100,
            ),
          );

          if (
            hold.elapsedMs >= FRAMING_HOLD_DURATION_MS &&
            !autoStartingRef.current
          ) {
            autoStartingRef.current = true;
            startTrialRef.current();
          }
        } else if (framingHoldStartRef.current !== null) {
          framingHoldStartRef.current = null;
          setFramingHoldMs(0);
        }
        return;
      }

      if (capturingRef.current) {
        const capturedFrame = {
          ...frame,
          timestampMs: Math.max(
            0,
            frame.timestampMs - captureStartRef.current,
          ),
        };
        captureFramesRef.current.push(capturedFrame);
        if (
          capturedFrame.timestampMs - lastRepEstimateRef.current >= 250 &&
          sourceRef.current
        ) {
          lastRepEstimateRef.current = capturedFrame.timestampMs;
          const count = estimateCompletedRepetitions(
            captureFramesRef.current,
            sourceRef.current,
            rules.config,
          );
          detectedRepetitionsRef.current = count;
          setDetectedRepetitions(Math.min(count, EXPECTED_REPETITIONS));
        }

        if (detectedRepetitionsRef.current >= EXPECTED_REPETITIONS) {
          const remainsStill =
            matchesStartPose &&
            (!finishHoldAnchorRef.current ||
              poseFramesAreStill(finishHoldAnchorRef.current, capturedFrame));

          if (!remainsStill) {
            finishHoldAnchorRef.current = capturedFrame;
            finishHoldStartRef.current = capturedFrame.timestampMs;
            setFinishHoldMs(0);
            return;
          }

          if (!finishHoldAnchorRef.current) {
            finishHoldAnchorRef.current = capturedFrame;
          }
          const hold = continuousHoldElapsedMs(
            finishHoldStartRef.current,
            capturedFrame.timestampMs,
            true,
          );
          finishHoldStartRef.current = hold.startedAtMs;
          setFinishHoldMs(
            Math.min(
              FINISH_HOLD_DURATION_MS,
              Math.floor(hold.elapsedMs / 100) * 100,
            ),
          );
          if (
            hold.elapsedMs >= FINISH_HOLD_DURATION_MS &&
            !autoFinishingRef.current
          ) {
            autoFinishingRef.current = true;
            void finishTrialRef.current();
          }
        } else if (finishHoldStartRef.current !== null) {
          finishHoldStartRef.current = null;
          finishHoldAnchorRef.current = null;
          setFinishHoldMs(0);
        }
      }
    },
    [drawPose, isBodyweightSquat, rules.config],
  );

  const beginInferenceLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const loop = (timestamp: number) => {
      animationFrameRef.current = requestAnimationFrame(loop);
      const video = videoRef.current;
      const worker = workerRef.current;
      if (
        document.hidden ||
        !video ||
        !worker ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return;
      }
      if (timestamp - lastFrameRequestRef.current < 33) return;
      lastFrameRequestRef.current = timestamp;

      if (!worker.canAcceptFrame() || bitmapPendingRef.current) {
        if (capturingRef.current) worker.noteDroppedFrame();
        return;
      }

      bitmapPendingRef.current = true;
      void createImageBitmap(video)
        .then((bitmap) => {
          worker.submit(bitmap, performance.now());
        })
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'The current camera frame could not be read.',
          );
        })
        .finally(() => {
          bitmapPendingRef.current = false;
        });
    };

    animationFrameRef.current = requestAnimationFrame(loop);
  }, []);

  const clearCaptureTimers = useCallback(() => {
    if (captureTimerRef.current !== null) {
      window.clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (captureIntervalRef.current !== null) {
      window.clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
  }, []);

  const stopRecorder = useCallback(async (): Promise<Blob> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return new Blob(recorderChunksRef.current, {
        type: recorder?.mimeType || 'video/webm',
      });
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        resolve(
          new Blob(recorderChunksRef.current, {
            type: recorder.mimeType || 'video/webm',
          }),
        );
      };
      recorder.stop();
    });
  }, []);

  const releaseCameraDevices = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    workerRef.current?.close();
    workerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const canvas = overlayRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setTrackingReady(false);
    setStartPoseReady(false);
    framingHoldStartRef.current = null;
    finishHoldStartRef.current = null;
    finishHoldAnchorRef.current = null;
    setFramingHoldMs(0);
    setFinishHoldMs(0);
    setDelegate(null);
    setSource(null);
    sourceRef.current = null;
  }, []);

  const finishTrial = useCallback(async () => {
    if (!capturingRef.current) return;
    capturingRef.current = false;
    clearCaptureTimers();
    transitionRuntimeState('processing');

    const blob = await stopRecorder();
    recorderRef.current = null;
    setVideoBlob(blob);
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    const nextVideoUrl = URL.createObjectURL(blob);
    videoUrlRef.current = nextVideoUrl;
    setVideoUrl(nextVideoUrl);

    const currentSource = sourceRef.current;
    const worker = workerRef.current;
    const trialId = trialIdRef.current;
    if (!currentSource || !worker || !trialId) {
      transitionRuntimeState('error');
      setErrorMessage('Trial metadata was lost before analysis.');
      return;
    }

    const landmarks = createLandmarkSeries({
      trialId,
      entryPoint: 'live_camera',
      source: currentSource,
      model: {
        ...WORKER_MODEL_PROVENANCE,
        delegate: worker.getDelegate(),
      },
      frames: captureFramesRef.current,
      droppedFrames:
        worker.getDroppedFrames() - captureDroppedStartRef.current,
      confidenceMin: rules.config.qualityGates.landmarkConfidenceMin,
    });
    const nextOutcome = runMovementScreeningPipeline(landmarks, rules);
    const movementFilePrefix = isBodyweightSquat ? 'bws' : 'ohs';
    const videoFileName = `cerebro-${movementFilePrefix}-${trialId}.${videoExtensionForMimeType(blob.type)}`;
    const exportedAt = new Date().toISOString();

    if (nextOutcome.ok) {
      setExportBundle({
        exportedAt,
        videoFileName,
        result: nextOutcome.result,
        metrics: nextOutcome.metrics,
        landmarks,
      });
    } else {
      setExportBundle({
        schemaVersion: 'screening-diagnostic/1.0.0',
        exportedAt,
        videoFileName,
        rulesVersion: rules.version,
        rulesConfigSha256: rules.configSha256,
        calibrationStatus: rules.calibrationStatus,
        outcome: nextOutcome,
        landmarks,
      });
    }
    setOutcome(nextOutcome);
    releaseCameraDevices();
    transitionRuntimeState('complete');
  }, [
    clearCaptureTimers,
    releaseCameraDevices,
    isBodyweightSquat,
    rules,
    stopRecorder,
    transitionRuntimeState,
  ]);

  useEffect(() => {
    finishTrialRef.current = finishTrial;
  }, [finishTrial]);

  const startCamera = useCallback(async () => {
    setErrorMessage(null);
    autoStartingRef.current = false;
    framingHoldStartRef.current = null;
    setFramingHoldMs(0);
    setStartPoseReady(false);
    transitionRuntimeState('starting_camera');
    if (!window.isSecureContext) {
      transitionRuntimeState('error');
      setErrorMessage('Camera access requires HTTPS or localhost.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      transitionRuntimeState('error');
      setErrorMessage('This browser does not expose camera capture.');
      return;
    }

    try {
      const portraitCapture = window.matchMedia(
        '(orientation: portrait)',
      ).matches;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: createFrontCameraConstraints(portraitCapture),
      });
      const minimumZoomRequested = await requestMinimumCameraZoom(stream);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview is unavailable.');
      video.srcObject = stream;
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => resolve(), {
            once: true,
          });
          video.addEventListener(
            'error',
            () => reject(new Error('Camera metadata could not be read.')),
            { once: true },
          );
        });
      }
      await video.play();
      await waitForFirstVideoFrame(video);
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error('Camera returned an invalid video resolution.');
      }

      const cameraTrack = stream.getVideoTracks()[0];
      const nextSource: SourceMetadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        orientationDegrees: 0,
        previewMirrored: true,
        inferenceMirrored: false,
        browser: navigator.userAgent,
        device: [
          navigator.platform || 'unknown',
          cameraTrack?.label || 'front camera',
          minimumZoomRequested
            ? 'minimum camera zoom requested'
            : 'full-sensor camera requested',
        ].join(' · '),
      };
      sourceRef.current = nextSource;
      setSource(nextSource);
      transitionRuntimeState('loading_model');

      const worker = new PoseWorkerClient({
        onFrame: handlePoseFrame,
        onError: (message) => setErrorMessage(message),
      });
      workerRef.current = worker;
      const selectedDelegate = await worker.initialize();
      setDelegate(selectedDelegate);
      beginInferenceLoop();
      transitionRuntimeState('ready');
    } catch (error) {
      releaseCameraDevices();
      transitionRuntimeState('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Camera or pose tracking could not start.',
      );
    }
  }, [
    beginInferenceLoop,
    handlePoseFrame,
    releaseCameraDevices,
    transitionRuntimeState,
  ]);

  const startTrial = useCallback(() => {
    const stream = streamRef.current;
    const worker = workerRef.current;
    if (!stream || !worker || capturingRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      transitionRuntimeState('error');
      setErrorMessage('This browser cannot record the calibration video.');
      return;
    }

    setErrorMessage(null);
    setOutcome(null);
    setExportBundle(null);
    setCopied(false);
    setShared(false);
    setDetectedRepetitions(0);
    detectedRepetitionsRef.current = 0;
    framingHoldStartRef.current = null;
    finishHoldStartRef.current = null;
    finishHoldAnchorRef.current = null;
    setFramingHoldMs(0);
    setFinishHoldMs(0);
    setElapsedSeconds(0);
    setVideoBlob(null);
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
      setVideoUrl(null);
    }
    captureFramesRef.current = [];
    captureDroppedStartRef.current = worker.getDroppedFrames();
    lastRepEstimateRef.current = 0;
    autoFinishingRef.current = false;
    recorderChunksRef.current = [];

    const recorderFormat = selectRecorderFormat((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    );
    const recorder = new MediaRecorder(
      stream,
      recorderFormat
        ? {
            mimeType: recorderFormat.mimeType,
            videoBitsPerSecond: 4_000_000,
          }
        : { videoBitsPerSecond: 4_000_000 },
    );
    const trialId = crypto.randomUUID();
    trialIdRef.current = trialId;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recorderChunksRef.current.push(event.data);
    };
    recorderRef.current = recorder;
    captureStartRef.current = performance.now();
    capturingRef.current = true;
    recorder.start(1000);
    transitionRuntimeState('capturing');

    captureIntervalRef.current = window.setInterval(() => {
      setElapsedSeconds(
        (performance.now() - captureStartRef.current) / 1000,
      );
    }, 100);
    captureTimerRef.current = window.setTimeout(() => {
      void finishTrialRef.current();
    }, MAX_CAPTURE_SECONDS * 1000);
  }, [transitionRuntimeState]);

  useEffect(() => {
    startTrialRef.current = startTrial;
  }, [startTrial]);

  const resetTrial = useCallback(() => {
    setOutcome(null);
    setExportBundle(null);
    setCopied(false);
    setShared(false);
    setDetectedRepetitions(0);
    detectedRepetitionsRef.current = 0;
    autoStartingRef.current = false;
    autoFinishingRef.current = false;
    framingHoldStartRef.current = null;
    finishHoldStartRef.current = null;
    finishHoldAnchorRef.current = null;
    setFramingHoldMs(0);
    setFinishHoldMs(0);
    setVideoBlob(null);
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setVideoUrl(null);
    setElapsedSeconds(0);
    setErrorMessage(null);
    transitionRuntimeState('idle');
  }, [transitionRuntimeState]);

  const stopCamera = useCallback(() => {
    capturingRef.current = false;
    clearCaptureTimers();
    recorderRef.current = null;
    releaseCameraDevices();
    transitionRuntimeState('idle');
  }, [clearCaptureTimers, releaseCameraDevices, transitionRuntimeState]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden || !streamRef.current) return;
      if (capturingRef.current) {
        void finishTrialRef.current();
        return;
      }
      releaseCameraDevices();
      transitionRuntimeState('idle');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [releaseCameraDevices, transitionRuntimeState]);

  useEffect(() => {
    return () => {
      capturingRef.current = false;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      clearCaptureTimers();
      releaseCameraDevices();
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, [clearCaptureTimers, releaseCameraDevices]);

  const visibleJson = useMemo(() => {
    if (!outcome) return null;
    return outcome.ok ? outcome.result : outcome;
  }, [outcome]);

  const downloadVideo = useCallback(() => {
    if (!videoBlob || !exportBundle) return;
    downloadBlob(videoBlob, exportBundle.videoFileName);
  }, [exportBundle, videoBlob]);

  const downloadJson = useCallback(() => {
    if (!exportBundle) return;
    downloadBlob(
      makeJsonBlob(exportBundle),
      jsonFileNameForVideo(exportBundle.videoFileName),
    );
  }, [exportBundle]);

  const shareEvidence = useCallback(async () => {
    if (!videoBlob || !exportBundle || !('share' in navigator)) return;
    const files = [
      new File([videoBlob], exportBundle.videoFileName, {
        type: videoBlob.type || 'application/octet-stream',
      }),
      new File(
        [makeJsonBlob(exportBundle)],
        jsonFileNameForVideo(exportBundle.videoFileName),
        { type: 'application/json' },
      ),
    ];
    if (navigator.canShare && !navigator.canShare({ files })) {
      setErrorMessage(
        'This browser cannot share both evidence files. Download Video and JSON bundle separately.',
      );
      return;
    }
    try {
      await navigator.share({
        title: 'Cerebro movement-screening evidence',
        files,
      });
      setShared(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'The evidence pair could not be shared.',
      );
    }
  }, [exportBundle, videoBlob]);

  const copyResultJson = useCallback(async () => {
    if (!visibleJson) return;
    await navigator.clipboard.writeText(JSON.stringify(visibleJson, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [visibleJson]);

  const isBusy =
    runtimeState === 'starting_camera' ||
    runtimeState === 'loading_model' ||
    runtimeState === 'processing';
  const canStartTrial =
    runtimeState === 'ready' && startPoseReady && Boolean(delegate);
  const neutralBaselineSeconds =
    rules.config.segmentation.neutralBaselineDurationMs / 1000;
  const baselineRemainingSeconds = Math.max(
    0,
    neutralBaselineSeconds - elapsedSeconds,
  );
  const framingRemainingSeconds = Math.max(
    0,
    (FRAMING_HOLD_DURATION_MS - framingHoldMs) / 1000,
  );
  const finishRemainingSeconds = Math.max(
    0,
    (FINISH_HOLD_DURATION_MS - finishHoldMs) / 1000,
  );
  const isNeutralBaseline =
    runtimeState === 'capturing' &&
    elapsedSeconds < neutralBaselineSeconds;
  const isFinishHold =
    runtimeState === 'capturing' &&
    detectedRepetitions >= EXPECTED_REPETITIONS;
  const statusSuccessful = runtimeState === 'complete' && outcome?.ok;
  const movementName = isBodyweightSquat
    ? 'Bodyweight squat'
    : 'Overhead squat';
  const movementSummary = `${movementName} · Front view · 3 reps`;

  const guideEyebrow =
    runtimeState === 'ready'
      ? movementSummary
      : runtimeState === 'capturing'
        ? isFinishHold
          ? 'All 3 reps detected'
          : isNeutralBaseline
            ? 'Recording started'
            : movementSummary
        : runtimeState === 'processing'
          ? 'Recording finished'
          : runtimeState === 'complete'
            ? 'Movement 1 of 1'
            : movementSummary;
  const guideTitle =
    runtimeState === 'ready'
      ? !trackingReady
        ? 'Fit your full body inside'
        : startPoseReady
          ? 'Hold your position'
          : isBodyweightSquat
            ? 'Arms straight forward'
            : 'Hold your position'
      : runtimeState === 'capturing'
        ? isFinishHold
          ? 'Stand still'
          : isNeutralBaseline
            ? 'Hold the start position'
            : movementName
        : runtimeState === 'processing'
          ? 'Checking recording'
          : runtimeState === 'complete'
            ? outcome?.ok
              ? 'Recording successful'
              : 'Recording needs another try'
            : runtimeState === 'idle'
              ? movementName
              : 'Get ready';
  const guideValue =
    runtimeState === 'ready' && startPoseReady
      ? `${framingRemainingSeconds.toFixed(1)}s`
      : isNeutralBaseline
        ? `${baselineRemainingSeconds.toFixed(1)}s`
        : isFinishHold
          ? `${finishRemainingSeconds.toFixed(1)}s`
          : runtimeState === 'capturing'
            ? `Rep ${Math.min(detectedRepetitions + 1, EXPECTED_REPETITIONS)} of ${EXPECTED_REPETITIONS}`
            : null;
  const guideDetail =
    runtimeState === 'ready'
      ? !trackingReady
        ? 'Step back. Keep your wrists and both ankles inside the bright green frame.'
        : startPoseReady
          ? 'The test starts automatically after 3 seconds.'
          : isBodyweightSquat
            ? 'Stand tall and reach both arms straight forward at shoulder height.'
            : 'Hold the required start position.'
      : runtimeState === 'capturing'
        ? isFinishHold
          ? isBodyweightSquat
            ? 'Stand tall with arms straight forward. Stay still while the recording saves.'
            : 'Keep your arms overhead and body still. The recording saves automatically.'
          : isNeutralBaseline
            ? isBodyweightSquat
              ? 'Arms straight forward. Do not move until the countdown ends.'
              : 'Arms overhead. Do not move until the countdown ends.'
            : `Move slowly · ${TEMPO_CUE}`
        : runtimeState === 'processing'
          ? 'Stay close. Your three repetitions are being verified.'
          : runtimeState === 'complete'
            ? outcome?.ok
              ? 'The Phase 1 screen is complete. Your result is ready below.'
              : 'Review the quality note below, then redo this movement.'
            : runtimeState === 'idle'
              ? 'Front view · 3 repetitions'
              : 'The pose model is preparing your hands-free test.';

  return (
    <div className="min-h-full w-full max-w-full overflow-hidden rounded-[18px] border border-black/8 bg-[rgba(255,255,255,0.62)] p-3 shadow-[0_18px_70px_rgba(0,0,0,0.06)] backdrop-blur-xl sm:rounded-[24px] sm:p-4 md:p-7">
      <header className="flex flex-col gap-5 border-b border-black/8 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-black/38">
              PT / Movement Screening / Phase 1
            </span>
            <span className="border border-amber-700/20 bg-amber-50 px-2 py-1 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-amber-800">
              Rules uncalibrated
            </span>
          </div>
          <h1 className="mt-3 max-w-3xl text-[2rem] font-medium leading-[1.02] tracking-[-0.045em] text-black md:text-5xl">
            {movementName},
            <span className="text-black/35"> measured in-browser.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/52">
            Front camera · front view · three repetitions · hip
            translation and squat-depth proxy.
          </p>
        </div>
        <div className="flex w-full items-center gap-2 border border-black/10 bg-white/60 px-3 py-2 text-xs text-black/55 sm:w-auto">
          <LockKeyhole className="h-3.5 w-3.5 text-black/45" />
          Video and landmarks stay on this device
        </div>
      </header>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="min-w-0">
          <div className="relative mx-auto aspect-[3/4] w-full max-w-[28rem] overflow-hidden rounded-[20px] bg-[#080b09] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] md:aspect-[4/3] md:max-w-none">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full -scale-x-100 object-contain"
            />
            <canvas
              ref={overlayRef}
              aria-label="Live pose tracking overlay"
              className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-contain"
            />

            <div
              className={`pointer-events-none absolute inset-x-[8%] bottom-[4%] top-[4%] border-[3px] border-[#42ff88] bg-[#42ff88]/[0.025] outline outline-1 outline-black/70 transition-shadow duration-200 md:inset-x-[20%] md:bottom-[7%] md:top-[8%] ${
                startPoseReady
                  ? 'shadow-[0_0_30px_rgba(66,255,136,0.8),inset_0_0_24px_rgba(66,255,136,0.16)]'
                  : 'shadow-[0_0_18px_rgba(66,255,136,0.55),inset_0_0_16px_rgba(66,255,136,0.1)]'
              }`}
            >
              <span className="absolute -left-[3px] -top-[3px] h-12 w-12 border-l-[6px] border-t-[6px] border-[#42ff88]" />
              <span className="absolute -right-[3px] -top-[3px] h-12 w-12 border-r-[6px] border-t-[6px] border-[#42ff88]" />
              <span className="absolute -bottom-[3px] -left-[3px] h-12 w-12 border-b-[6px] border-l-[6px] border-[#42ff88]" />
              <span className="absolute -bottom-[3px] -right-[3px] h-12 w-12 border-b-[6px] border-r-[6px] border-[#42ff88]" />
              <span className="absolute bottom-10 left-1/2 top-14 border-l-2 border-dashed border-[#42ff88]/40" />

              <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 bg-black/85 px-3 py-2.5 text-xs font-semibold text-white shadow-lg backdrop-blur">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      runtimeState === 'capturing'
                        ? 'animate-pulse bg-red-500'
                        : startPoseReady
                          ? 'bg-[#42ff88]'
                          : 'bg-white/35'
                    }`}
                  />
                  <span className="truncate">{runtimeLabel(runtimeState)}</span>
                </div>

                <div className="shrink-0 bg-[#42ff88] px-3 py-2.5 font-mono text-xs font-bold text-black shadow-lg">
                  {runtimeState === 'capturing'
                    ? `${detectedRepetitions} / ${EXPECTED_REPETITIONS}`
                    : '1 / 1'}
                </div>
              </div>

              <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 bg-black/82 px-4 py-5 text-center text-white shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[#42ff88]">
                  {guideEyebrow}
                </p>
                <p
                  aria-live="polite"
                  className="mt-2 text-xl font-bold leading-tight tracking-[-0.03em] sm:text-2xl"
                >
                  {guideTitle}
                </p>
                {guideValue && (
                  <p className="mt-2 font-mono text-4xl font-bold leading-none text-[#42ff88] sm:text-5xl">
                    {guideValue}
                  </p>
                )}
                <p className="mx-auto mt-3 max-w-[17rem] text-xs font-medium leading-5 text-white/80 sm:text-sm">
                  {guideDetail}
                </p>
              </div>

              <div className="absolute inset-x-2 bottom-2 bg-black/88 px-3 py-2.5 text-center text-white shadow-lg backdrop-blur">
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#42ff88]">
                  {runtimeState === 'ready'
                    ? 'Hands-free auto start'
                    : runtimeState === 'capturing'
                      ? isFinishHold
                        ? 'Hands-free auto save'
                        : 'Keep your body inside the frame'
                      : runtimeState === 'complete'
                        ? statusSuccessful
                          ? 'Screen complete'
                          : 'Redo required'
                        : 'Full-body capture zone'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 border border-black/8 bg-white/55 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  startPoseReady || statusSuccessful
                    ? 'bg-[#d9ffe8] text-emerald-800'
                    : 'bg-black/5 text-black/35'
                }`}
              >
                {startPoseReady || statusSuccessful ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-black">
                  {runtimeState === 'complete'
                    ? outcome?.ok
                      ? 'Recording successful'
                      : 'Recording finished · quality check failed'
                    : runtimeState === 'ready' && startPoseReady
                      ? `Auto start in ${framingRemainingSeconds.toFixed(1)} seconds`
                      : trackingReady
                        ? isBodyweightSquat
                          ? 'Full body detected · move arms straight forward'
                          : 'Full body is inside the capture zone'
                        : 'Waiting for full-body tracking'}
                </p>
                <p className="truncate text-xs text-black/43">
                  {runtimeState === 'complete'
                    ? 'Movement 1 of 1 · result available below'
                    : source
                    ? `${source.width} × ${source.height} · ${delegate ?? 'model loading'} worker`
                    : 'Front camera · actual resolution detected at runtime'}
                </p>
              </div>
            </div>

            <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              {runtimeState === 'idle' || runtimeState === 'error' ? (
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  disabled={isBusy}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                >
                  <Camera className="h-4 w-4" />
                  Enable camera
                </button>
              ) : runtimeState === 'capturing' ? (
                <button
                  type="button"
                  onClick={() => void finishTrial()}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 sm:w-auto"
                >
                  <CircleStop className="h-4 w-4" />
                  Stop early & analyse
                </button>
              ) : runtimeState === 'complete' ? (
                <button
                  type="button"
                  onClick={resetTrial}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/80 sm:w-auto"
                >
                  <RefreshCw className="h-4 w-4" />
                  New trial
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startTrial}
                  disabled={!canStartTrial || isBusy}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-35 sm:w-auto"
                >
                  <Video className="h-4 w-4" />
                  Start now
                </button>
              )}
              {runtimeState !== 'idle' && runtimeState !== 'complete' && (
                <button
                  type="button"
                  onClick={stopCamera}
                  disabled={runtimeState === 'capturing' || !source}
                  className="min-h-11 w-full border border-black/12 px-3 py-2.5 text-sm text-black/55 transition hover:border-black/25 hover:text-black disabled:opacity-30 sm:w-auto"
                >
                  Camera off
                </button>
              )}
            </div>
          </div>

          {errorMessage && (
            <div className="mt-3 flex gap-3 border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{errorMessage}</p>
            </div>
          )}
        </section>

        <aside className="border border-black/8 bg-white/50 p-5">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-black/35">
            Capture protocol
          </p>
          <ol className="mt-5 space-y-6">
            {[
              {
                number: '01',
                title: 'Enable camera nearby',
                copy: 'Tap once, then step back. You will not need to reach the phone again.',
              },
              {
                number: '02',
                title: 'Enter the green frame',
                copy: isBodyweightSquat
                  ? 'Face the camera, stand tall, and reach both arms straight forward at shoulder height. Hold for three seconds to start automatically.'
                  : 'Face the camera with arms overhead. Hold inside the rectangle for three seconds to start automatically.',
              },
              {
                number: '03',
                title: 'Hold the start position',
                copy: 'Once recording starts, stay still for the three-second neutral baseline.',
              },
              {
                number: '04',
                title: 'Complete 3 slow reps',
                copy: 'Use 2 seconds down, pause for 1 second, then take 2 seconds to stand. Repeat exactly three times.',
              },
              {
                number: '05',
                title: 'Finish standing still',
                copy: isBodyweightSquat
                  ? 'After rep three, stand tall with arms straight forward and hold still for three seconds. The recording saves and checks itself.'
                  : 'After rep three, hold still for three seconds. The recording saves and checks itself.',
              },
            ].map((step) => (
              <li key={step.number} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="font-mono text-xs text-black/30">
                  {step.number}
                </span>
                <div>
                  <p className="text-sm font-medium text-black">{step.title}</p>
                  <p className="mt-1.5 text-xs leading-5 text-black/48">
                    {step.copy}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-7 border-t border-black/8 pt-5">
            <dl className="space-y-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-black/40">Rules</dt>
                <dd className="font-mono text-black/65">v{rules.version}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-black/40">Model</dt>
                <dd className="text-right font-mono text-black/65">Full f16 v1</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-black/40">Entry</dt>
                <dd className="font-mono text-black/65">live_camera</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-black/40">Upload</dt>
                <dd className="font-mono text-emerald-700">none</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-black/40">Rep progress</dt>
                <dd className="font-mono text-black/65">
                  {detectedRepetitions} / 3
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      {visibleJson && (
        <section className="mt-5 border border-black/8 bg-[#0b0d0c]">
          <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[#42ff88]">
                Diagnostic JSON
              </p>
              <p className="mt-1 text-xs text-white/42">
                {outcome?.ok
                  ? 'Accepted trial · findings use provisional uncalibrated rules'
                  : 'Rejected trial · fix the quality gate before calibration'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadVideo}
                disabled={!videoBlob}
                className="inline-flex items-center gap-2 border border-white/15 px-3 py-2 text-xs font-medium text-white transition hover:border-white/35 disabled:opacity-30"
              >
                <Download className="h-3.5 w-3.5" />
                Video
              </button>
              <button
                type="button"
                onClick={downloadJson}
                disabled={!exportBundle}
                className="inline-flex items-center gap-2 bg-[#42ff88] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[#73ffa5] disabled:opacity-30"
              >
                <Download className="h-3.5 w-3.5" />
                JSON bundle
              </button>
              <button
                type="button"
                onClick={() => void copyResultJson()}
                className="inline-flex items-center gap-2 border border-white/15 px-3 py-2 text-xs font-medium text-white transition hover:border-white/35"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : null}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  type="button"
                  onClick={() => void shareEvidence()}
                  disabled={!videoBlob || !exportBundle}
                  className="inline-flex items-center gap-2 border border-white/15 px-3 py-2 text-xs font-medium text-white transition hover:border-white/35 disabled:opacity-30"
                >
                  {shared ? <Check className="h-3.5 w-3.5" /> : null}
                  {shared ? 'Shared' : 'Share evidence'}
                </button>
              )}
            </div>
          </div>
          <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-[0.7rem] leading-5 text-white/70">
            {JSON.stringify(visibleJson, null, 2)}
          </pre>
          {videoUrl && (
            <div className="border-t border-white/10 p-4">
              <video
                src={videoUrl}
                controls
                playsInline
                className="max-h-64 w-full bg-black object-contain"
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
