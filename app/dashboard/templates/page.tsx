export default function TemplatesPage() {
  return (
    <div className="p-8 min-h-screen">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Dashboard
      </p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-4">
        Email Templates
      </h1>
      <p className="text-sm text-black/50 max-w-xl leading-relaxed">
        No tracked template phase is outstanding right now.
      </p>
    </div>
  );
}
