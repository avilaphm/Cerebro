import FadeIn from '@/app/components/FadeIn';

const VIDEOS = [
  'Client video 1',
  'Client video 2',
  'Client video 3',
  'Client video 4',
];

export default function CoachVideos() {
  return (
    <section className="py-20 md:py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-10">
            Client stories
          </p>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {VIDEOS.map((label) => (
            <FadeIn key={label}>
              <div className="aspect-video bg-black flex items-center justify-center group cursor-pointer">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-full border border-white/30 flex items-center justify-center group-hover:border-white/60 transition-colors duration-200">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="white"
                      className="translate-x-0.5"
                    >
                      <polygon points="4,2 16,9 4,16" />
                    </svg>
                  </div>
                  <span className="text-[0.6rem] font-medium tracking-[0.15em] uppercase text-white/30">
                    {label}
                  </span>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn>
          <p className="text-[0.7rem] font-light text-black/40 mt-6">
            More stories from real people below.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
