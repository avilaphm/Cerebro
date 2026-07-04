export interface RecorderFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

export const RECORDER_FORMAT_CANDIDATES: readonly RecorderFormat[] = [
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
];

export function selectRecorderFormat(
  isTypeSupported: (mimeType: string) => boolean,
): RecorderFormat | undefined {
  return RECORDER_FORMAT_CANDIDATES.find(({ mimeType }) =>
    isTypeSupported(mimeType),
  );
}

export function videoExtensionForMimeType(
  mimeType: string | undefined,
): RecorderFormat['extension'] {
  return mimeType?.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

export function jsonFileNameForVideo(videoFileName: string): string {
  return videoFileName.replace(/\.(?:mp4|webm)$/i, '.json');
}
