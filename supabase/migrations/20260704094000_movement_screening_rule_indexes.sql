create index if not exists pt_movement_screening_rules_parent_version_idx
  on public.pt_movement_screening_rule_versions (parent_version)
  where parent_version is not null;

create index if not exists pt_movement_screening_rules_created_by_idx
  on public.pt_movement_screening_rule_versions (created_by)
  where created_by is not null;
