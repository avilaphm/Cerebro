'use client';

import { useEffect } from 'react';
import type { LayoutId } from './types';

interface StudioHotkeys {
  enabled: boolean;
  onLayout: (id: LayoutId) => void;
  onCycle: () => void;
  onEscape: () => void;
  // Window the listener attaches to. Omit for the main window; pass the Document
  // Picture-in-Picture window so shortcuts also fire while it is focused. `null`
  // (the floating window isn't open) attaches nothing.
  target?: Window | null;
  // Compositing now happens offline after the take is captured, so switching
  // layout mid-recording has no live effect — it would only silently change
  // what gets painted at finalize time. Defaults to true (setup screen); pass
  // false during recording to keep 1/2/3/Space inert while Esc still stops.
  layoutSwitchingEnabled?: boolean;
}

/**
 * Keyboard shortcuts for Studio: 1/2/3 jump to a layout, Space cycles through
 * them, Esc cancels the countdown or stops recording. Ignored while typing in a
 * form control, and Space blurs the focused control + preventDefaults so it
 * doesn't also scroll the page or re-trigger a button.
 */
export function useStudioHotkeys({
  enabled,
  onLayout,
  onCycle,
  onEscape,
  target,
  layoutSwitchingEnabled = true,
}: StudioHotkeys) {
  useEffect(() => {
    const win = target === undefined ? (typeof window !== 'undefined' ? window : null) : target;
    if (!enabled || !win) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        if (layoutSwitchingEnabled) onLayout(Number(e.key) as LayoutId);
      } else if (e.key === ' ' || e.code === 'Space') {
        if (!layoutSwitchingEnabled) return;
        e.preventDefault();
        (win.document.activeElement as HTMLElement | null)?.blur?.();
        onCycle();
      } else if (e.key === 'Escape') {
        onEscape();
      }
    };
    win.addEventListener('keydown', handler);
    return () => win.removeEventListener('keydown', handler);
  }, [enabled, onLayout, onCycle, onEscape, target, layoutSwitchingEnabled]);
}
