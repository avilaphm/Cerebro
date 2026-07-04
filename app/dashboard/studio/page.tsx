import type { Metadata } from 'next';
import StudioApp from './StudioApp';

export const metadata: Metadata = {
  title: 'Studio',
};

export default function StudioPage() {
  return <StudioApp />;
}
