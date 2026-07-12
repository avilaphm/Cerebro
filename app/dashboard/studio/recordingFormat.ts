export interface StudioRecordingFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
  label: 'MP4' | 'WebM';
}

const FORMAT_CANDIDATES: StudioRecordingFormat[] = [
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

export function pickStudioRecordingFormat(): StudioRecordingFormat {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: '', extension: 'webm', label: 'WebM' };
  }

  return (
    FORMAT_CANDIDATES.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? {
      mimeType: '',
      extension: 'webm',
      label: 'WebM',
    }
  );
}

export function extensionForMimeType(mimeType: string): 'mp4' | 'webm' {
  return mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

export function labelForMimeType(mimeType: string): 'MP4' | 'WebM' {
  return extensionForMimeType(mimeType) === 'mp4' ? 'MP4' : 'WebM';
}
