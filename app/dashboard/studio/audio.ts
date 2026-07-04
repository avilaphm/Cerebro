export interface MergedAudio {
  tracks: MediaStreamTrack[];
  cleanup: () => void;
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Mixes the audio tracks from any number of streams into `outputs` independent
 * tracks via the Web Audio API, so mic (always) and system audio (optional)
 * land on one track per simultaneous recorder (landscape + portrait each need
 * their own). Streams without audio are ignored; if nothing has audio, returns
 * no tracks and a no-op cleanup.
 */
export function mergeAudioTracks(
  streams: (MediaStream | null)[],
  outputs = 1,
): MergedAudio {
  const withAudio = streams.filter(
    (s): s is MediaStream => !!s && s.getAudioTracks().length > 0,
  );
  if (withAudio.length === 0 || outputs < 1) return { tracks: [], cleanup: () => {} };

  const AudioCtx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AudioCtx) return { tracks: [], cleanup: () => {} };

  const ctx = new AudioCtx();
  const dests = Array.from({ length: outputs }, () => ctx.createMediaStreamDestination());
  const nodes = withAudio.map((stream) => {
    const node = ctx.createMediaStreamSource(stream);
    dests.forEach((dest) => node.connect(dest));
    return node;
  });

  const tracks = dests
    .map((d) => d.stream.getAudioTracks()[0])
    .filter((t): t is MediaStreamTrack => !!t);

  return {
    tracks,
    cleanup: () => {
      nodes.forEach((n) => n.disconnect());
      ctx.close().catch(() => {});
    },
  };
}
