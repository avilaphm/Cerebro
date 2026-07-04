export function createFrontCameraConstraints(
  portrait: boolean,
): MediaTrackConstraints {
  return {
    facingMode: 'user',
    width: { ideal: portrait ? 720 : 1280 },
    height: { ideal: portrait ? 1280 : 720 },
    aspectRatio: { ideal: portrait ? 9 / 16 : 16 / 9 },
    frameRate: { ideal: 30, max: 30 },
  };
}
