import FadeIn from '@/app/components/FadeIn';

export default function CoachVideos() {
  return (
    <section className="py-20 md:py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <div className="flex items-end justify-between mb-10">
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black">
              Client stories
            </p>
            <p className="text-[0.7rem] font-light text-black/40">In their words below.</p>
          </div>
        </FadeIn>

        <FadeIn>
          <div className="aspect-video bg-black overflow-hidden border border-black/10">
            <video
              src="/coach/client-soma.mp4"
              controls
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
            />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
