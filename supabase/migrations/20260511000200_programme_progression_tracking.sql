-- Progressive overload tracking: week blocks + client progress state
ALTER TABLE pt_program_assignments
  ADD COLUMN IF NOT EXISTS current_week int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_block_index int NOT NULL DEFAULT 0;

ALTER TABLE pt_workout_logs
  ADD COLUMN IF NOT EXISTS block_index int,
  ADD COLUMN IF NOT EXISTS is_quick_done boolean NOT NULL DEFAULT false;
