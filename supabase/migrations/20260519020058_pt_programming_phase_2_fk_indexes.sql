-- Cover foreign keys introduced by PT Programming System Phase 2.

create index if not exists pt_client_documents_uploaded_by_idx
  on public.pt_client_documents (uploaded_by);

create index if not exists pt_program_generation_runs_intake_document_idx
  on public.pt_program_generation_runs (intake_document_id);

create index if not exists pt_program_generation_runs_assessment_document_idx
  on public.pt_program_generation_runs (assessment_document_id);

create index if not exists pt_program_generation_runs_created_by_idx
  on public.pt_program_generation_runs (created_by);

create index if not exists pt_client_1rm_tests_generation_run_idx
  on public.pt_client_1rm_tests (generation_run_id);

create index if not exists pt_client_1rm_results_exercise_idx
  on public.pt_client_1rm_results (exercise_id);

create index if not exists pt_phase_nutrition_generation_run_idx
  on public.pt_phase_nutrition (generation_run_id);

create index if not exists pt_program_review_outputs_assignment_idx
  on public.pt_program_review_outputs (assignment_id);

create index if not exists pt_extra_sessions_generation_run_idx
  on public.pt_extra_sessions (generation_run_id);
