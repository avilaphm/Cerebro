export interface StudioRecordingFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
  label: 'MP4' | 'WebM';
}

const MP4_CANDIDATES: StudioRecordingFormat[] = [
  {
    mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    extension: 'mp4',
    label: 'MP4',
  },
  {
    mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2',
    extension: 'mp4',
    label: 'MP4',
  },
  {
    mimeType: 'video/mp4;codecs=h264,aac',
    extension: 'mp4',
    label: 'MP4',
  },
  {
    mimeType: 'video/mp4',
    extension: 'mp4',
    label: 'MP4',
  },
];

const WEBM_CANDIDATES: StudioRecordingFormat[] = [
  {
    mimeType: 'video/webm;codecs=h264,opus',
    extension: 'webm',
    label: 'WebM',
  },
  {
    mimeType: 'video/webm;codecs=vp8,opus',
    extension: 'webm',
    label: 'WebM',
  },
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    extension: 'webm',
    label: 'WebM',
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    label: 'WebM',
  },
];

// Raw takes prefer WebM: MediaRecorder-produced fragmented MP4 is unreliable
// when replayed back through a <video> blob URL in Chrome (stalls / frame
// pinning / bad duration), which is exactly what composeExports does with
// these blobs. WebM has none of that trouble on the same round trip. iOS
// Safari has no WebM decoder at all, so the MP4 candidates stay as a fallback.
const RAW_CANDIDATES: StudioRecordingFormat[] = [
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    extension: 'webm',
    label: 'WebM',
  },
  {
    mimeType: 'video/webm;codecs=vp8,opus',
    extension: 'webm',
    label: 'WebM',
  },
  {
    mimeType: 'video/webm;codecs=h264,opus',
    extension: 'webm',
    label: 'WebM',
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    label: 'WebM',
  },
  ...MP4_CANDIDATES,
];

// Downloads stay MP4-first — Pedro edits these directly, and MP4 needs no
// conversion in his tools. Only used for what actually leaves the browser:
// the composited canvas exports, and the camera-only mobile raw take (which
// IS the download, since there is nothing to composite there).
const EXPORT_CANDIDATES: StudioRecordingFormat[] = [...MP4_CANDIDATES, ...WEBM_CANDIDATES];

function pickFormat(candidates: StudioRecordingFormat[]): StudioRecordingFormat {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: '', extension: 'webm', label: 'WebM' };
  }
  return (
    candidates.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? {
      mimeType: '',
      extension: 'webm',
      label: 'WebM',
    }
  );
}

/** For the internal raw screen/camera takes captured live during recording. */
export function pickRawRecordingFormat(): StudioRecordingFormat {
  return pickFormat(RAW_CANDIDATES);
}

/** For anything that leaves the browser as a download. */
export function pickExportRecordingFormat(): StudioRecordingFormat {
  return pickFormat(EXPORT_CANDIDATES);
}

// A silent stream (e.g. screen share with "system audio" off) must never get a
// mimeType that declares an audio codec — some browsers reject or misbehave on
// a MediaRecorder whose declared codecs don't match the track set. Strips the
// audio half of `;codecs=video,audio` down to just the video codec.
export function formatForStream(
  format: StudioRecordingFormat,
  stream: MediaStream,
): StudioRecordingFormat {
  if (stream.getAudioTracks().length > 0 || !format.mimeType) return format;
  const [container, codecsPart] = format.mimeType.split(';codecs=');
  if (!codecsPart) return format;
  const videoCodec = codecsPart.split(',')[0];
  return { ...format, mimeType: `${container};codecs=${videoCodec}` };
}

export function extensionForMimeType(mimeType: string): 'mp4' | 'webm' {
  return mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

export function labelForMimeType(mimeType: string): 'MP4' | 'WebM' {
  return extensionForMimeType(mimeType) === 'mp4' ? 'MP4' : 'WebM';
}
