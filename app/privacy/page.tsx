import Nav from '@/app/components/Nav';

export const metadata = {
  title: 'Privacy Policy — Cerebro',
  description: 'How Cerebro collects, uses, and protects your information.',
};

export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <div className="min-h-screen bg-white pt-24 pb-32 px-6 md:px-12">
        <div className="max-w-2xl mx-auto">
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-6">
            Legal
          </p>
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] font-light tracking-[-0.025em] text-black mb-4">
            Privacy Policy
          </h1>
          <p className="text-xs text-black/30 mb-16">Last updated: July 2026</p>

          <div className="space-y-12 text-sm font-light text-black/70 leading-relaxed">

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Overview</h2>
              <p>
                Cerebro (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is an embedded business systems consultancy operated by Pedro Avila, based in Sydney, Australia. This policy explains how we collect, use, and handle your personal information when you visit cerebroai.au or engage with our services.
              </p>
              <p className="mt-3">
                We handle your information in accordance with the Australian Privacy Act 1988 and the Australian Privacy Principles (APPs).
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Information we collect</h2>
              <p>We collect information you provide directly, including:</p>
              <ul className="mt-3 space-y-2 list-none pl-0">
                {[
                  'Name and business name, when you fill out our contact or onboarding form',
                  'Email address and phone number, used to follow up on your inquiry',
                  'Details about your business, processes, systems, and delivery constraints, shared through our chatbot or during an engagement',
                  'Any other information you voluntarily provide during our conversations',
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="text-black/20 mt-1">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4">
                We also automatically collect basic usage data (page visits, browser type) through standard web server logs.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">How we use your information</h2>
              <p>Your information is used to:</p>
              <ul className="mt-3 space-y-2 list-none pl-0">
                {[
                  'Respond to your inquiry and prepare a personalised starting point or proposal',
                  'Schedule and conduct business diagnostic sessions',
                  'Deliver and manage embedded systems work you engage us for',
                  'Send relevant follow-up communications about your project',
                  'Improve our service and website',
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="text-black/20 mt-1">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4">
                We do not sell, rent, or share your personal information with third parties for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Third-party services</h2>
              <p>We use the following services to operate our business. Each has its own privacy policy.</p>
              <ul className="mt-3 space-y-2 list-none pl-0">
                {[
                  { name: 'Supabase', use: 'Database and authentication — stores lead and conversation data' },
                  { name: 'Anthropic (Claude)', use: 'Processes chatbot responses and supports agreed systems work' },
                  { name: 'Resend', use: 'Email delivery for inquiry notifications' },
                  { name: 'Vercel', use: 'Website hosting' },
                ].map(({ name, use }) => (
                  <li key={name} className="flex gap-3">
                    <span className="text-black/20 mt-1">—</span>
                    <span><span className="text-black font-medium">{name}:</span> {use}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Data retention</h2>
              <p>
                We retain your information for as long as necessary to deliver our services or as required by law. If you would like your data removed, contact us and we will delete it within 30 days unless we are legally required to keep it.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Your rights</h2>
              <p>You have the right to:</p>
              <ul className="mt-3 space-y-2 list-none pl-0">
                {[
                  'Request access to the personal information we hold about you',
                  'Request correction of inaccurate or outdated information',
                  'Request deletion of your personal information',
                  'Withdraw consent to receive communications from us at any time',
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="text-black/20 mt-1">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Cookies</h2>
              <p>
                Our website uses essential cookies for basic functionality. We do not use tracking cookies or third-party advertising cookies.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Contact</h2>
              <p>
                For privacy-related questions or requests, contact us at{' '}
                <a href="mailto:pedro@cerebroai.au" className="text-black underline underline-offset-2">
                  pedro@cerebroai.au
                </a>
                .
              </p>
            </section>

          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between px-6 md:px-12 py-8 border-t border-black">
        <span className="font-display text-sm font-medium tracking-[0.1em] uppercase text-black">
          Cerebro
        </span>
        <span className="text-xs font-light text-black/30">
          &copy; 2026 Cerebro
        </span>
      </footer>
    </>
  );
}
