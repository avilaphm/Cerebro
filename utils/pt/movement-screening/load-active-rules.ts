import 'server-only';

import { createClient } from '@/utils/supabase/server';
import { sha256CanonicalJson } from './canonical-json';
import type { RulesEnvelope } from './contracts';
import { validateRulesEnvelope } from './rules-engine';

interface RuleVersionRow {
  version: number;
  status: 'active';
  calibration_status: RulesEnvelope['calibrationStatus'];
  config_sha256: string;
  config: unknown;
  schema_version: string;
}

export async function loadActiveMovementScreeningRules(): Promise<RulesEnvelope> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pt_movement_screening_rule_versions')
    .select(
      'version, status, calibration_status, config_sha256, config, schema_version',
    )
    .eq('status', 'active')
    .single();

  if (error || !data) {
    throw new Error(
      `Active movement-screening rules are unavailable: ${error?.message ?? 'no active version'}`,
    );
  }

  const row = data as RuleVersionRow;
  const envelope = validateRulesEnvelope({
    schemaVersion: row.schema_version,
    version: row.version,
    status: row.status,
    calibrationStatus: row.calibration_status,
    configSha256: row.config_sha256,
    config: row.config,
  });
  const computedHash = await sha256CanonicalJson(envelope.config);
  if (computedHash !== envelope.configSha256) {
    throw new Error('Active movement-screening rules failed integrity check.');
  }

  return envelope;
}
