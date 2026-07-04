export default function MovementScreeningLoading() {
  return (
    <div className="min-h-full rounded-[24px] border border-black/8 bg-white/55 p-5 md:p-8">
      <div className="h-3 w-32 animate-pulse bg-black/8" />
      <div className="mt-5 h-10 w-80 max-w-full animate-pulse bg-black/8" />
      <div className="mt-8 aspect-video w-full animate-pulse rounded-[20px] bg-black/8" />
    </div>
  );
}
