'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Circle,
  Download,
  Mic,
  Monitor,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useMediaStreams } from './useMediaStreams';
import { useCompositor } from './useCompositor';
import { useRecorder } from './useRecorder';
import { mergeAudioTracks } from './audio';
import type { CompositorConfig, CanvasWithCapture, StudioPhase } from './types';

const LANDSCAPE_BITRATE = 8_000_000;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function makeFilename(): string {
  const d = new Date();
  return `cerebro-studio-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}.webm`;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DARK_BTN =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#080808] text-white hover:bg-[#242424] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const LIGHT_BTN =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border border-black/15 text-black/80 hover:bg-black/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function StudioApp() {
  const [phase, setPhase] = useState<StudioPhase>('setup');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [systemAudio, setSystemAudio] = useState(false);
  const [config] = useState<CompositorConfig>({
    layout: 1,
    orientation: 'landscape',
    bubblePosition: 'bottom-right',
    bubbleSize: 'medium',
  });

  const {
    cameras,
    mics,
    camMicStream,
    screenStream,
    camMicError,
    screenError,
    startCamMic,
    startScreen,
    stopAll,
    registerScreenEnded,
  } = useMediaStreams();

  const recorder = useRecorder();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const configRef = useRef(config);
  const phaseRef = useRef<StudioPhase>(phase);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useCompositor({
    canvasRef,
    screenVideoRef,
    cameraVideoRef,
    configRef,
    active: phase === 'setup' || phase === 'recording',
  });

  // Acquire camera + mic on first mount.
  useEffect(() => {
    void startCamMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bind streams to the hidden source videos the compositor draws from.
  useEffect(() => {
    const v = cameraVideoRef.current;
    if (!v) return;
    v.srcObject = camMicStream;
    v.muted = true;
    if (camMicStream) v.play().catch(() => {});
  }, [camMicStream]);

  useEffect(() => {
    const v = screenVideoRef.current;
    if (!v) return;
    v.srcObject = screenStream;
    v.muted = true;
    if (screenStream) v.play().catch(() => {});
  }, [screenStream]);

  // Native "Stop sharing" → finalize gracefully instead of losing footage.
  useEffect(() => {
    registerScreenEnded(() => {
      if (phaseRef.current === 'recording') recorder.stop();
    });
    return () => registerScreenEnded(null);
  }, [registerScreenEnded, recorder]);

  // Called from the recorder's stop event: review the take and free every
  // capture source so no camera light lingers.
  const finalizeRecording = useCallback(() => {
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordingStreamRef.current = null;
    stopAll();
    setPhase('review');
  }, [stopAll]);

  const handleShareScreen = useCallback(() => {
    void startScreen(systemAudio);
  }, [startScreen, systemAudio]);

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current as CanvasWithCapture | null;
    if (!canvas || !camMicStream || !screenStream) return;

    const canvasStream = canvas.captureStream(30);
    const audio = mergeAudioTracks([camMicStream, systemAudio ? screenStream : null]);
    audioCleanupRef.current = audio.cleanup;
    if (audio.track) canvasStream.addTrack(audio.track);
    recordingStreamRef.current = canvasStream;

    recorder.start(canvasStream, LANDSCAPE_BITRATE, finalizeRecording);
    setPhase('recording');
  }, [camMicStream, screenStream, systemAudio, recorder, finalizeRecording]);

  const returnToSetup = useCallback(() => {
    recorder.reset();
    setPhase('setup');
    void startCamMic(selectedCamera || undefined, selectedMic || undefined);
  }, [recorder, startCamMic, selectedCamera, selectedMic]);

  const download = useCallback(() => {
    if (!recorder.result) return;
    const a = document.createElement('a');
    a.href = recorder.result.url;
    a.download = makeFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [recorder.result]);

  const canRecord = !!camMicStream && !!screenStream;

  // Derive the dropdown selection from the live stream so it reflects the
  // browser's default device until the user explicitly picks one.
  const cameraValue = selectedCamera || camMicStream?.getVideoTracks()[0]?.getSettings().deviceId || '';
  const micValue = selectedMic || camMicStream?.getAudioTracks()[0]?.getSettings().deviceId || '';

  return (
    <div className="cerebro-studio p-6 md:p-8">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Cerebro
      </p>
      <div className="mb-8 flex items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black">Studio</h1>
        <p className="hidden max-w-xs text-right text-xs leading-relaxed text-black/45 sm:block">
          Record your screen with your face in a bubble. Everything stays in your browser — no
          uploads.
        </p>
      </div>

      {camMicError && (
        <ErrorBanner
          message={camMicError}
          onRetry={() => void startCamMic(selectedCamera || undefined, selectedMic || undefined)}
        />
      )}
      {screenError && phase !== 'recording' && (
        <ErrorBanner message={screenError} onRetry={handleShareScreen} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Stage — the exact frame that records */}
        <div className="relative overflow-hidden rounded-2xl bg-[#111] shadow-[0_18px_45px_-28px_rgba(0,0,0,0.6)]">
          <canvas
            ref={canvasRef}
            width={1920}
            height={1080}
            className="block aspect-video w-full"
          />

          {phase !== 'review' && !screenStream && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <Monitor className="h-8 w-8 text-white/50" strokeWidth={1.4} />
              <p className="max-w-xs px-6 text-sm text-white/70">
                Share your screen to see the full Layout 1 preview.
              </p>
            </div>
          )}

          {phase === 'recording' && (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-sm">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-mono text-sm tabular-nums text-white">
                {formatDuration(recorder.elapsedMs)}
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="cb-card rounded-2xl border border-black/10 p-5">
          {phase === 'setup' && (
            <SetupControls
              cameras={cameras}
              mics={mics}
              selectedCamera={cameraValue}
              selectedMic={micValue}
              systemAudio={systemAudio}
              screenShared={!!screenStream}
              canRecord={canRecord}
              onCameraChange={(id) => {
                setSelectedCamera(id);
                void startCamMic(id, selectedMic || undefined);
              }}
              onMicChange={(id) => {
                setSelectedMic(id);
                void startCamMic(selectedCamera || undefined, id);
              }}
              onToggleSystemAudio={() => setSystemAudio((v) => !v)}
              onShareScreen={handleShareScreen}
              onRecord={startRecording}
            />
          )}

          {phase === 'recording' && (
            <div className="space-y-4">
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">
                Recording
              </p>
              <p className="text-sm text-black/60">
                Layout 1 — screen with camera bubble. Mic audio is being captured.
              </p>
              <button type="button" onClick={recorder.stop} className={`w-full ${DARK_BTN}`}>
                <Square className="h-4 w-4" fill="currentColor" /> Stop recording
              </button>
            </div>
          )}

          {phase === 'review' && recorder.result && (
            <ReviewControls
              durationMs={recorder.elapsedMs}
              sizeBytes={recorder.result.blob.size}
              onDownload={download}
              onRecordAgain={returnToSetup}
              onDiscard={returnToSetup}
            />
          )}
        </div>
      </div>

      {phase === 'review' && recorder.result && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="overflow-hidden rounded-2xl bg-black">
            <video src={recorder.result.url} controls className="block aspect-video w-full" />
          </div>
          <p className="self-start rounded-xl border border-black/10 bg-black/[0.02] p-4 text-xs leading-relaxed text-black/55">
            WebM downloads. Convert to MP4 for LinkedIn with CapCut or ffmpeg.
          </p>
        </div>
      )}

      {/* Hidden capture sources for the compositor */}
      <video ref={cameraVideoRef} className="hidden" playsInline muted />
      <video ref={screenVideoRef} className="hidden" playsInline muted />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
      <p className="flex-1 text-sm text-red-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900"
      >
        Retry
      </button>
    </div>
  );
}

interface SetupControlsProps {
  cameras: { deviceId: string; label: string }[];
  mics: { deviceId: string; label: string }[];
  selectedCamera: string;
  selectedMic: string;
  systemAudio: boolean;
  screenShared: boolean;
  canRecord: boolean;
  onCameraChange: (id: string) => void;
  onMicChange: (id: string) => void;
  onToggleSystemAudio: () => void;
  onShareScreen: () => void;
  onRecord: () => void;
}

function SetupControls({
  cameras,
  mics,
  selectedCamera,
  selectedMic,
  systemAudio,
  screenShared,
  canRecord,
  onCameraChange,
  onMicChange,
  onToggleSystemAudio,
  onShareScreen,
  onRecord,
}: SetupControlsProps) {
  return (
    <div className="space-y-5">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">Setup</p>

      <label className="block space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-black/60">
          <Camera className="h-3.5 w-3.5" /> Camera
        </span>
        <select
          value={selectedCamera}
          onChange={(e) => onCameraChange(e.target.value)}
          className="w-full border border-black/10 px-3 py-2 text-sm"
        >
          {cameras.length === 0 && <option value="">Detecting…</option>}
          {cameras.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-black/60">
          <Mic className="h-3.5 w-3.5" /> Microphone
        </span>
        <select
          value={selectedMic}
          onChange={(e) => onMicChange(e.target.value)}
          className="w-full border border-black/10 px-3 py-2 text-sm"
        >
          {mics.length === 0 && <option value="">Detecting…</option>}
          {mics.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onToggleSystemAudio}
        className="flex w-full items-center justify-between border border-black/10 px-3 py-2.5 text-sm text-black/70 hover:bg-black/5"
      >
        <span className="flex items-center gap-2">
          {systemAudio ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          System audio
        </span>
        <span
          className={`text-xs font-medium ${systemAudio ? 'text-emerald-600' : 'text-black/40'}`}
        >
          {systemAudio ? 'On' : 'Off'}
        </span>
      </button>

      <button
        type="button"
        onClick={onShareScreen}
        className={`w-full ${screenShared ? LIGHT_BTN : DARK_BTN}`}
      >
        <Monitor className="h-4 w-4" />
        {screenShared ? 'Re-share screen' : 'Share screen'}
      </button>

      <div className="border-t border-black/10 pt-4">
        <button
          type="button"
          onClick={onRecord}
          disabled={!canRecord}
          className="inline-flex w-full items-center justify-center gap-2 bg-[#dc2626] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Circle className="h-4 w-4" fill="currentColor" /> Start recording
        </button>
        {!canRecord && (
          <p className="mt-2 text-center text-xs text-black/45">
            {screenShared ? 'Waiting for camera…' : 'Share your screen to start.'}
          </p>
        )}
      </div>
    </div>
  );
}

interface ReviewControlsProps {
  durationMs: number;
  sizeBytes: number;
  onDownload: () => void;
  onRecordAgain: () => void;
  onDiscard: () => void;
}

function ReviewControls({
  durationMs,
  sizeBytes,
  onDownload,
  onRecordAgain,
  onDiscard,
}: ReviewControlsProps) {
  return (
    <div className="space-y-5">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">Review</p>

      <div className="flex gap-6 text-sm">
        <div>
          <p className="font-mono tabular-nums text-black">{formatDuration(durationMs)}</p>
          <p className="text-xs text-black/45">Duration</p>
        </div>
        <div>
          <p className="font-mono tabular-nums text-black">{formatBytes(sizeBytes)}</p>
          <p className="text-xs text-black/45">Size</p>
        </div>
      </div>

      <button type="button" onClick={onDownload} className={`w-full ${DARK_BTN}`}>
        <Download className="h-4 w-4" /> Download
      </button>
      <button type="button" onClick={onRecordAgain} className={`w-full ${LIGHT_BTN}`}>
        <RotateCcw className="h-4 w-4" /> Record again
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm text-black/50 hover:text-black/80"
      >
        <Trash2 className="h-4 w-4" /> Discard
      </button>
    </div>
  );
}
