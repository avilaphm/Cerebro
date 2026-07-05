alter table public.pt_movement_screening_rule_versions
  drop constraint if exists pt_movement_screening_rule_versions_schema_version_check;

alter table public.pt_movement_screening_rule_versions
  add constraint pt_movement_screening_rule_versions_schema_version_check
  check (
    schema_version in (
      'movement-screening-rules/1.0.0',
      'movement-screening-rules/1.1.0'
    )
  );

update public.pt_movement_screening_rule_versions
set
  status = 'retired',
  retired_at = now()
where status = 'active';

insert into public.pt_movement_screening_rule_versions (
  version,
  schema_version,
  status,
  calibration_status,
  config,
  config_sha256,
  parent_version,
  activated_at
)
values (
  2,
  'movement-screening-rules/1.1.0',
  'active',
  'uncalibrated',
  $config$
  {
    "movementId": "bodyweight_squat_front",
    "metricSchemaVersion": "movement-metrics/1.1.0",
    "expectedRepetitions": 3,
    "qualityGates": {
      "landmarkConfidenceMin": 0.75,
      "validFrameFractionMin": 0.9,
      "minInferenceFps": 15,
      "maxAnkleDriftHipWidthRatio": 0.1,
      "maxSegmentJumpHipWidthRatio": 0.35
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
        "ruleId": "bws_front_hip_translation_v1",
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
        "ruleId": "bws_front_depth_proxy_v1",
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
      "purpose": "Phase 1 bodyweight-squat software verification and Pedro-led iPhone calibration only",
      "thresholdSource": "Provisional research values; not Pedro-approved and not valid for client use",
      "calibrationFixtureIds": [],
      "pedroReasons": []
    }
  }
  $config$::jsonb,
  '62c7807db75597d843f8caf2a320bf27f723e0157a9d045b1c1abbd0bc757c88',
  1,
  now()
);
