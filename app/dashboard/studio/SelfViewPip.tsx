'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { SwitchCamera, Square } from 'lucide-react';
import type { LayoutId } from './types';

interface SelfViewPipProps {
  cameraStream: MediaStream | null;
  layout: LayoutId;
  recording: boolean;
  paused: boolean;
  elapsedLabel: string;
  canFlip: boolean;
  onLayout: (id: LayoutId) => void;
  onFlip: () => void;
  onStop: () => void;
}

// Rendered through a portal into the Document Picture-in-Picture window, whose
// document has NO stylesheet — so this uses inline styles rather than Tailwind.
// The camera is mirrored like a normal self-view. The controls are the ones the
// user needs while working in another tab: switch layout, flip camera, stop.
const BAR: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 10px',
  background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))',
};

const BTN_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 30,
  minWidth: 30,
  padding: '0 8px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(255,255,255,0.12)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const LAYOUT_IDS: LayoutId[] = [1, 2, 3];

export function SelfViewPip({
  cameraStream,
  layout,
  recording,
  paused,
  elapsedLabel,
  canFlip,
  onLayout,
  onFlip,
  onStop,
}: SelfViewPipProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = cameraStream;
    v.muted = true;
    if (cameraStream) v.play().catch(() => {});
  }, [cameraStream]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
        }}
      />

      {recording && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: paused ? '#fbbf24' : '#ef4444',
            }}
          />
          {elapsedLabel}
        </div>
      )}

      <div style={BAR}>
        {LAYOUT_IDS.map((id) => {
          const active = layout === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onLayout(id)}
              aria-pressed={active}
              style={
                active
                  ? { ...BTN_BASE, background: '#fff', color: '#000', borderColor: '#fff' }
                  : BTN_BASE
              }
            >
              {id}
            </button>
          );
        })}

        {canFlip && (
          <button type="button" onClick={onFlip} title="Flip camera" style={BTN_BASE}>
            <SwitchCamera size={16} />
          </button>
        )}

        {recording && (
          <button
            type="button"
            onClick={onStop}
            title="Stop recording"
            style={{ ...BTN_BASE, background: '#dc2626', borderColor: '#dc2626' }}
          >
            <Square size={13} fill="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
}
