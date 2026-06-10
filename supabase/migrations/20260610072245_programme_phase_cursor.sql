alter table public.pt_program_assignments
  add column if not exists current_phase_index int;
