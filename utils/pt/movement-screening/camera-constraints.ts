interface CameraTrackCapabilities extends MediaTrackCapabilities {
  zoom?: {
    min?: number;
    max?: number;
    step?: number;
  };
}

interface CameraTrackConstraintSet extends MediaTrackConstraintSet {
  resizeMode?: ConstrainDOMString;
  zoom?: ConstrainDouble;
}

interface CameraTrackConstraints extends MediaTrackConstraints {
  resizeMode?: ConstrainDOMString;
  advanced?: CameraTrackConstraintSet[];
}

function cameraConstraints(
  constraints: CameraTrackConstraints,
): MediaTrackConstraints {
  return constraints as MediaTrackConstraints;
}

export function createFrontCameraConstraints(
  portrait: boolean,
): MediaTrackConstraints {
  return cameraConstraints({
    facingMode: 'user',
    width: { ideal: portrait ? 960 : 1280 },
    height: { ideal: portrait ? 1280 : 960 },
    aspectRatio: { ideal: portrait ? 3 / 4 : 4 / 3 },
    resizeMode: { ideal: 'none' },
    frameRate: { ideal: 30, max: 30 },
  });
}

export async function requestMinimumCameraZoom(
  stream: MediaStream,
): Promise<boolean> {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') return false;

  const capabilities = track.getCapabilities() as CameraTrackCapabilities;
  const minimumZoom = capabilities.zoom?.min;
  if (typeof minimumZoom !== 'number' || !Number.isFinite(minimumZoom)) {
    return false;
  }

  try {
    await track.applyConstraints(
      cameraConstraints({
        advanced: [{ zoom: minimumZoom }],
      }),
    );
    return true;
  } catch {
    return false;
  }
}
