create table if not exists public.pt_movement_screening_rule_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  schema_version text not null
    check (schema_version = 'movement-screening-rules/1.0.0'),
  status text not null
    check (status in ('draft', 'active', 'retired')),
  calibration_status text not null
    check (calibration_status in ('uncalibrated', 'calibrating', 'calibrated')),
  config jsonb not null,
  config_sha256 text not null
    check (config_sha256 ~ '^[0-9a-f]{64}$'),
  parent_version integer
    references public.pt_movement_screening_rule_versions(version),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  check (
    (status = 'active' and activated_at is not null)
    or status <> 'active'
  )
);

create unique index if not exists pt_movement_screening_one_active_version
  on public.pt_movement_screening_rule_versions ((status))
  where status = 'active';

alter table public.pt_movement_screening_rule_versions
  enable row level security;

revoke all on table public.pt_movement_screening_rule_versions
  from anon, authenticated;
grant select on table public.pt_movement_screening_rule_versions
  to authenticated;
grant select, insert, update, delete
  on table public.pt_movement_screening_rule_versions
  to service_role;

drop policy if exists "pt admins read movement screening rules"
  on public.pt_movement_screening_rule_versions;

create policy "pt admins read movement screening rules"
  on public.pt_movement_screening_rule_versions
  for select
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in (
      'pedro@meetavila.com',
      'pedroavila.phm@gmail.com',
      'pedro@cerebroai.au',
      'avila.phm@gmail.com'
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

create or replace function public.protect_movement_screening_rule_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version is distinct from old.version
    or new.schema_version is distinct from old.schema_version
    or new.config is distinct from old.config
    or new.config_sha256 is distinct from old.config_sha256
    or new.parent_version is distinct from old.parent_version
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception
      'movement-screening rule versions are immutable; create a new version';
  end if;
  return new;
end;
$$;

revoke execute
  on function public.protect_movement_screening_rule_version()
  from public, anon, authenticated;
grant execute
  on function public.protect_movement_screening_rule_version()
  to service_role;

drop trigger if exists protect_movement_screening_rule_version
  on public.pt_movement_screening_rule_versions;
create trigger protect_movement_screening_rule_version
  before update on public.pt_movement_screening_rule_versions
  for each row
  execute function public.protect_movement_screening_rule_version();

insert into public.pt_movement_screening_rule_versions (
  version,
  schema_version,
  status,
  calibration_status,
  config,
  config_sha256,
  activated_at
)
values (
  1,
  'movement-screening-rules/1.0.0',
  'active',
  'uncalibrated',
  $config$
  {
    "movementId": "overhead_squat_front",
    "metricSchemaVersion": "movement-metrics/1.0.0",
    "expectedRepetitions": 3,
    "qualityGates": {
      "landmarkConfidenceMin": 0.75,
      "validFrameFractionMin": 0.9,
      "minInferenceFps": 15,
      "maxAnkleDriftHipWidthRatio": 0.1,
      "maxSegmentJumpHipWidthRatio": 0.35,
      "minOverheadArmFrameFraction": 0.8
    },
    "segmentation": {
      "neutralBaselineDurationMs": 3000,
      "smoothingWindowFrames": 5,
      "descentStartRatio": 0.12,
      "standingReturnRatio": 0.08,
      "minimumBottomDescentRatio": 0.25,
      "minimumRepDurationMs": 500,
      "maximumRepDurationMs": 6000,
      "bottomWindowMs": 100
    },
    "ruleGroups": [
      {
        "ruleId": "ohs_front_hip_translation_v1",
        "metricId": "hip_lateral_translation_ratio",
        "findingCode": "lateral_hip_translation",
        "label": "Lateral hip translation observed",
        "includeMetricDirection": true,
        "bands": [
          {
            "bandId": "high",
            "severity": "high",
            "message": "Large lateral hip translation was observed relative to the neutral stance.",
            "minInclusive": 0.4
          },
          {
            "bandId": "moderate",
            "severity": "moderate",
            "message": "Moderate lateral hip translation was observed relative to the neutral stance.",
            "minInclusive": 0.25,
            "maxExclusive": 0.4
          },
          {
            "bandId": "low",
            "severity": "low",
            "message": "Small lateral hip translation was observed relative to the neutral stance.",
            "minInclusive": 0.15,
            "maxExclusive": 0.25
          }
        ]
      },
      {
        "ruleId": "ohs_front_depth_proxy_v1",
        "metricId": "hip_knee_vertical_margin_ratio",
        "findingCode": "squat_depth_proxy",
        "label": "Front-view squat-depth proxy",
        "includeMetricDirection": false,
        "bands": [
          {
            "bandId": "insufficient",
            "severity": "moderate",
            "message": "The front-view hip-to-knee depth proxy remained above the provisional adequate-depth boundary.",
            "maxExclusive": -0.05
          },
          {
            "bandId": "borderline",
            "severity": "indeterminate",
            "message": "The front-view squat-depth proxy is within the provisional borderline band and requires Pedro's review.",
            "minInclusive": -0.05,
            "maxExclusive": 0.05
          }
        ]
      }
    ],
    "metadata": {
      "purpose": "Phase 1 software verification and Pedro-led laptop calibration only",
      "thresholdSource": "Provisional research values; not Pedro-approved and not valid for client use",
      "calibrationFixtureIds": [],
      "pedroReasons": []
    }
  }
  $config$::jsonb,
  'e1a687dabed783ce93e2b4916aa45ff815a53d84a82c3e77ba697f178fdb318e',
  now()
)
on conflict (version) do nothing;
