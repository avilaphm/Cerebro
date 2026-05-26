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

      <div className="border-t border-black" />
      <CoachProcess />

      <div className="border-t border-black" />
      <CoachChat />

      <div className="border-t border-black" />
      <CoachFooter />
    </>
  );
}
