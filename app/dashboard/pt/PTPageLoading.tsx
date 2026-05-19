'use client';

import { useEffect, useState } from 'react';

const CIRC = 2 * Math.PI * 28;

export default function PTPageLoading({ label }: { label?: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / 5000)))));
    }, 150);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div className="relative h-16 w-16">
        <svg className="absolute inset-0 -rotate-90" width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" className="text-black/10" />
          <circle
            cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3"
            strokeLinecap="round"
            className="text-black"
            style={{
              strokeDasharray: CIRC,
              strokeDashoffset: CIRC * (1 - progress / 100),
              transition: 'stroke-dashoffset 0.3s ease-out',
            }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
          {progress}%
        </span>
      </div>
      {label && (
        <p className="text-[0.65rem] uppercase tracking-[0.14em] text-black/35">{label}</p>
      )}
    </div>
  );
}
