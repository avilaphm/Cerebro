-- Add activity level 6 (Extra Active) and new activity tags
-- Also add reasoning_steps column to pt_client_nutrition_doc

ALTER TABLE pt_clients
  DROP CONSTRAINT IF EXISTS pt_clients_activity_level_check;

ALTER TABLE pt_clients
  ADD CONSTRAINT pt_clients_activity_level_check
  CHECK (activity_level IS NULL OR (activity_level >= 1 AND activity_level <= 6));

ALTER TABLE pt_clients
  DROP CONSTRAINT IF EXISTS pt_clients_activity_tag_check;

ALTER TABLE pt_clients
  ADD CONSTRAINT pt_clients_activity_tag_check
  CHECK (activity_tag IS NULL OR activity_tag = ANY (ARRAY[
    'sedentary', 'lightly_active', 'light_active', 'moderately_active',
    'active', 'very_active', 'extra_active', 'athlete_level'
  ]));

ALTER TABLE pt_client_nutrition_doc
  ADD COLUMN IF NOT EXISTS reasoning_steps jsonb;
