import type { Metadata } from 'next';
import MovementAssessmentBooking from './MovementAssessmentBooking';

export const metadata: Metadata = {
  title: 'Movement Assessment | Pedro Avila Coaching',
  description: 'Complete your PAR-Q and book a movement assessment with Pedro Avila.',
};

export default async function MovementAssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  return <MovementAssessmentBooking inviteToken={token} />;
}
