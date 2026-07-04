export interface MergedAudio {
  track: MediaStreamTrack | null;
  cleanup: () => void;
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Mixes the audio tracks from any number of streams into a single track via
 * the Web Audio API, so mic (always) and system audio (optional) land on one
 * track in the recording. Streams without audio are ignored; if nothing has
 * audio, returns a null track and a no-op cleanup.
 */
export function mergeAudioTracks(streams: (MediaStream | null)[]): MergedAudio {
  const withAudio = streams.filter(
    (s): s is MediaStream => !!s && s.getAudioTracks().length > 0,
  );
  if (withAudio.length === 0) return { track: null, cleanup: () => {} };

  const AudioCtx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AudioCtx) return { track: null, cleanup: () => {} };

  const ctx = new AudioCtx();
  const dest = ctx.createMediaStreamDestination();
  const nodes = withAudio.map((stream) => {
    const node = ctx.createMediaStreamSource(stream);
    node.connect(dest);
    return node;
  });

  const [track] = dest.stream.getAudioTracks();
  return {
    track: track ?? null,
    cleanup: () => {
      nodes.forEach((n) => n.disconnect());
      ctx.close().catch(() => {});
    },
  };
}
