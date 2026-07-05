'use client';

import { useEffect } from 'react';
import type { LayoutId } from './types';

interface StudioHotkeys {
  enabled: boolean;
  onLayout: (id: LayoutId) => void;
  onCycle: () => void;
  onEscape: () => void;
}

/**
 * Keyboard shortcuts for Studio: 1/2/3 jump to a layout, Space cycles through
 * them, Esc cancels the countdown or stops recording. Ignored while typing in a
 * form control, and Space blurs the focused control + preventDefaults so it
 * doesn't also scroll the page or re-trigger a button.
 */
export function useStudioHotkeys({ enabled, onLayout, onCycle, onEscape }: StudioHotkeys) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        onLayout(Number(e.key) as LayoutId);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        onCycle();
      } else if (e.key === 'Escape') {
        onEscape();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onLayout, onCycle, onEscape]);
}
