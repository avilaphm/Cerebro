'use client';

export default function MovementScreeningError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-full items-center justify-center rounded-[24px] border border-black/8 bg-white/60 p-6">
      <div className="max-w-lg border-l-2 border-red-500 pl-5">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-red-700">
          Movement Screening unavailable
        </p>
        <h1 className="mt-3 text-2xl font-medium tracking-[-0.03em] text-black">
          The active rules could not be loaded safely.
        </h1>
        <p className="mt-3 text-sm leading-6 text-black/55">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/80"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
