import type { Metadata } from 'next';
import MovementAssessmentBooking from './MovementAssessmentBooking';

export const metadata: Metadata = {
  title: 'Movement Assessment | Pedro Avila Coaching',
  description: 'Complete your PAR-Q and book a movement assessment with Pedro Avila.',
};

export default function MovementAssessmentPage() {
  return <MovementAssessmentBooking />;
}
