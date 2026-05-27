-- Older programme runs accidentally stored movement_assessment_summary as a
-- JSON string inside jsonb. Normalize valid object-looking strings so later
-- agents can read the mind map directly.

update public.pt_client_exercise_doc
set movement_assessment_summary = (movement_assessment_summary #>> '{}')::jsonb,
    updated_at = now()
where jsonb_typeof(movement_assessment_summary) = 'string'
  and left(trim(movement_assessment_summary #>> '{}'), 1) = '{';
