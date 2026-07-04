import MovementScreeningPhaseOne from './MovementScreeningPhaseOne';
import { loadActiveMovementScreeningRules } from '@/utils/pt/movement-screening/load-active-rules';

export default async function MovementScreeningPage() {
  const rules = await loadActiveMovementScreeningRules();
  return <MovementScreeningPhaseOne rules={rules} />;
}
