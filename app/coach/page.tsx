import CoachNav from './components/CoachNav';
import CoachHero from './components/CoachHero';
import CoachProblem from './components/CoachProblem';
import CoachBio from './components/CoachBio';
import CoachVideos from './components/CoachVideos';
import CoachTestimonials from './components/CoachTestimonials';
import CoachBetweenSessions from './components/CoachBetweenSessions';
import CoachProcess from './components/CoachProcess';
import CoachChat from './components/CoachChat';
import CoachFooter from './components/CoachFooter';

export default function CoachPage() {
  return (
    <>
      <CoachNav />
      <CoachHero />

      <div className="border-t border-black" />
      <CoachProblem />

      <div className="border-t border-black" />
      <CoachBio />

      <div className="border-t border-black" />
      <CoachVideos />

      <div className="border-t border-black" />
      <CoachTestimonials />

      <div className="border-t border-black" />
      <CoachBetweenSessions />

      {/* Cinematic break */}
      <section className="relative h-[58vh] min-h-[360px] overflow-hidden">
        <img
          src="/coach/powder.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative h-full flex items-center justify-center px-6">
          <h2
            className="font-display font-light tracking-[-0.02em] leading-[1.1] text-white text-center max-w-3xl"
            style={{ fontSize: 'clamp(1.8rem, 4vw, 3.4rem)' }}
          >
            Strong, mobile and independent — for decades, not weeks.
          </h2>
        </div>
      </section>

      <CoachProcess />

      <div className="border-t border-black" />
      <CoachChat />

      <div className="border-t border-black" />
      <CoachFooter />
    </>
  );
}
