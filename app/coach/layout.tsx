import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pedro Avila Coaching',
  description:
    'Out of pain, moving freely, back to the things you stopped doing. Personal coaching with Pedro Avila — P.E. Dept, Potts Point.',
};

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
