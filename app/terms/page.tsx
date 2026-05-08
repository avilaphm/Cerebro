import Nav from '@/app/components/Nav';

export const metadata = {
  title: 'Terms of Service — Cerebro',
  description: 'Terms governing the use of Cerebro\'s website and services.',
};

export default function TermsPage() {
  return (
    <>
      <Nav />
      <div className="min-h-screen bg-white pt-24 pb-32 px-6 md:px-12">
        <div className="max-w-2xl mx-auto">
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-6">
            Legal
          </p>
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] font-light tracking-[-0.025em] text-black mb-4">
            Terms of Service
          </h1>
          <p className="text-xs text-black/30 mb-16">Last updated: May 2026</p>

          <div className="space-y-12 text-sm font-light text-black/70 leading-relaxed">

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">About</h2>
              <p>
                These terms govern your use of cerebroai.au and any services provided by Cerebro, operated by Pedro Avila (ABN available on request), Sydney, Australia. By using this website or engaging our services, you agree to these terms.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Services</h2>
              <p>
                Cerebro provides AI automation consulting services to small businesses, including workflow analysis, automation design, and implementation. The scope, deliverables, timeline, and fees for any engagement are agreed in writing before work begins.
              </p>
              <p className="mt-3">
                We reserve the right to decline any engagement at our discretion.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Website use</h2>
              <p>
                You may use this website for lawful purposes only. You agree not to:
              </p>
              <ul className="mt-3 space-y-2 list-none pl-0">
                {[
                  'Use the site in a way that disrupts or damages its operation',
                  'Attempt to gain unauthorised access to any part of the site or its systems',
                  'Reproduce or redistribute any content without written permission',
                  'Use our chatbot or contact forms to submit false or misleading information',
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="text-black/20 mt-1">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Intellectual property</h2>
              <p>
                All content on this website — including copy, design, code, and visual assets — is the property of Cerebro unless otherwise stated. Nothing on this site grants you a licence to use our brand, name, or materials.
              </p>
              <p className="mt-3">
                Work product created for a client engagement is covered by the specific agreement for that project.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Payment</h2>
              <p>
                Payment terms are set out in individual engagement agreements. Unless agreed otherwise, invoices are due within 14 days of issue. Late payments may incur interest at the rate permitted under the Late Payment of Commercial Debts legislation applicable in NSW, Australia.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Limitation of liability</h2>
              <p>
                To the maximum extent permitted by Australian law, Cerebro is not liable for any indirect, incidental, or consequential loss arising from your use of this website or our services. Our total liability for any claim is limited to the fees paid by you for the specific service giving rise to the claim.
              </p>
              <p className="mt-3">
                Nothing in these terms excludes any right or guarantee that cannot be excluded under the Australian Consumer Law.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Third-party tools</h2>
              <p>
                Our services may involve the use of third-party AI and automation platforms. We are not responsible for the terms, availability, or performance of those platforms. Where relevant, their use will be disclosed in your engagement agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Changes to these terms</h2>
              <p>
                We may update these terms from time to time. The current version is always available at cerebroai.au/terms. Continued use of the site after an update constitutes acceptance of the revised terms.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Governing law</h2>
              <p>
                These terms are governed by the laws of New South Wales, Australia. Any disputes are subject to the exclusive jurisdiction of the courts of NSW.
              </p>
            </section>

            <section>
              <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-black mb-4">Contact</h2>
              <p>
                Questions about these terms can be directed to{' '}
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
