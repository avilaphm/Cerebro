# Cerebro Movement Screening - Phase 1 Build Checklist

## Status

- Current phase: Phase 1 only
- Current state: Plan persisted, implementation not started
- Current target: Pedro's laptop, desktop Chrome, built-in front camera
- Next action: Wait for Pedro to authorize implementation, then start at the first unchecked item
- Source PRD: `Cerebro Knowledge/cerebro-movement-screening-PRD.md`
- Route: `/dashboard/pt/movement-screening`
- Later phases: Locked until every Phase 1 completion gate passes

This file is the durable source of truth for the build. Update it after every working session. A new session must continue from the first unchecked item unless the Current Resume Point says otherwise.

## Pedro's decisions that override the draft PRD

1. Build and calibrate on Pedro's laptop before testing a phone.
2. Use the laptop's front camera through desktop Chrome.
3. Build the interface, camera pipeline, recording, pose extraction, metrics pipeline, and rules workflow before asking Pedro for final movement thresholds.
4. Pedro will then record clean and deliberately faulted overhead squats on the laptop.
5. Those recordings, landmark data, metrics, and Pedro's judgement will define the ceiling, squat-depth boundary, hip-shift thresholds, and severity bands.
6. Do not treat provisional research values as Pedro's final rules.
7. Keep the capture and pipeline interfaces device-independent so a phone camera can be added later without replacing metrics or rules code.
8. Phone testing is not part of the current Phase 1 acceptance gate.

## Mandatory new-session protocol

Before doing any work:

- [ ] Read `Cerebro Knowledge/cerebro-movement-screening-PRD.md` in full.
- [ ] Read this checklist in full.
- [ ] Read `HANDOFF.md`.
- [ ] Read `../session-logs/learning-log.md`.
- [ ] Run `git status --short`.
- [ ] Preserve all unrelated user changes.
- [ ] Confirm the current work is still Phase 1.
- [ ] Start from the Current Resume Point or the first unchecked implementation item.

Before ending any implementation session:

- [ ] Update the Status and Current Resume Point in this file.
- [ ] Check off only work that was implemented and verified.
- [ ] Record failures and blockers in the Session Continuation Log.
- [ ] Update `HANDOFF.md`.
- [ ] Append to the learning log only when the feature or a substantial milestone is complete.
- [ ] Run the verification appropriate to the changed files.
- [ ] Commit and push the completed, verified session work.
- [ ] Never leave partial implementation undocumented.

## Locked Phase 1 scope

Phase 1 will contain:

- One authenticated PT dashboard page beside M & L Assessment.
- Desktop Chrome and laptop front-camera capture.
- A live bright-green MediaPipe landmark overlay.
- One movement: overhead squat, front view.
- Three repetitions per trial.
- A locally downloadable calibration video from the same live-camera session.
- A matching JSON calibration bundle with timestamps, landmark quality, metrics, rules version, and findings.
- Two movement metrics:
  - Lateral hip or pelvis translation.
  - Front-view squat-depth proxy.
- A pure rules engine using validated JSON configuration.
- Active rules loaded at runtime from versioned Supabase JSONB.
- A checked-in local JSON fixture for tests and initial seeding.
- Findings and diagnostic data rendered as JSON on screen.
- A clean pipeline interface that supports live camera now and recorded-video or self-screening adapters later.
- Six Codex skills, with the first three functional and the final three stubbed.

Phase 1 will not contain:

- Client screening links.
- A phone-specific interface or phone acceptance testing.
- The other eight screening movements.
- Video upload to Supabase.
- Persistent client screening records.
- Claude report generation.
- Pedro's voice review workflow.
- Commentary parsing.
- Rule-refinement jobs.
- Client-facing reports.
- Automated delivery.
- Injury diagnosis or causal muscle claims.

## Architecture contract

All entry points must feed the same pipeline:

```text
Entry adapter
  -> FrameSource
  -> pose-extraction
  -> LandmarkSeries
  -> metrics-extraction
  -> MovementMetrics
  -> rules-engine
  -> ScreeningResult JSON
```

Required entry-point identifiers:

- `live_camera`: implemented in Phase 1.
- `uploaded_video`: interface only.
- `self_screening`: interface only.

The downstream pose, metrics, and rules stages must never contain entry-point-specific branches.

Every result must preserve:

- Entry-point identifier.
- Trial identifier.
- Source width, height, orientation, and mirror transform.
- Browser and device information.
- MediaPipe package and model version.
- Worker and inference delegate.
- Inference frame-rate summary.
- Landmark-quality summary.
- Metrics schema version.
- Rules version.
- Rule IDs.
- Per-repetition metrics.
- Aggregate metrics.
- Structured findings.
- Calibration status: `uncalibrated`, `calibrating`, or `calibrated`.

## Device-independence guardrails

These rules make the later phone step additive:

- Never hardcode laptop camera dimensions.
- Read the actual stream width and height.
- Keep video capture behind the `FrameSource` interface.
- Process unmirrored source frames.
- Mirror only the visible preview and overlay.
- Store direction as the subject's anatomical left or right.
- Keep overlay sizing derived from the source frame.
- Keep metrics in body-relative ratios, not pixels or centimetres.
- Run MediaPipe through a browser module worker.
- Keep GPU and CPU-worker delegates interchangeable.
- Do not use desktop-only file paths or browser APIs without capability checks.
- Keep camera controls usable with touch even though Phase 1 is tested with a laptop.
- Do not change metrics or rules when a phone adapter is added.

## Package and security decision

Approved implementation candidate:

- Package: `@mediapipe/tasks-vision`
- Exact version: `0.10.35`
- Model: Pose Landmarker Full float16 v1
- Package source: official npm registry
- Repository source: `google-ai-edge/mediapipe`
- License: Apache 2.0
- Runtime dependencies: zero
- Install scripts: none
- Model SHA-256: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`

Security rules:

- Never install `@latest`.
- Never use a caret version.
- Never use third-party MediaPipe wrappers.
- Recheck registry maintainers and integrity immediately before installation.
- Inspect the package manifest and dry-run tarball before installation.
- Commit the lockfile.
- Self-host checksum-verified WASM and model assets.
- Do not load runtime code from a CDN.
- Do not add broad `unsafe-eval`, COOP, or COEP settings.
- Do not expose a Supabase service-role key to the browser.
- Run dependency audit after installation.
- Treat Google's documented performance and utilisation telemetry as an unresolved privacy item before any client rollout.

## Six-skill workflow

Create all skills under the workspace root `skills/` directory with `skill-creator`.

### Functional Phase 1 skills

- [ ] `pose-extraction`
  - Input: camera or video frame source.
  - Output: timestamped landmark series and quality metadata.
  - Owns MediaPipe loading, worker lifecycle, landmark coordinates, and pose-quality gates.
  - Does not know squat rules or Pedro's thresholds.

- [ ] `metrics-extraction`
  - Input: landmark series plus movement and angle.
  - Output: per-repetition and aggregate movement metrics.
  - Owns filtering, neutral baseline, repetition segmentation, hip translation, and depth proxy.
  - Does not create prose or decide coaching meaning.

- [ ] `rules-engine`
  - Input: movement metrics plus validated rules config.
  - Output: structured findings.
  - Owns JSON validation, condition evaluation, severity mapping, direction, and provenance.
  - Does not compute landmarks or movement metrics.

### Required stubs

- [ ] `commentary-parser`
  - Valid skill scaffold.
  - Hard stop stating it is unavailable in Phase 1.

- [ ] `report-generator`
  - Valid skill scaffold.
  - Hard stop stating it is unavailable in Phase 1.

- [ ] `refinement-proposer`
  - Valid skill scaffold.
  - Hard stop stating it is unavailable in Phase 1.

### Skill validation gate

- [ ] Every skill contains a valid `SKILL.md`.
- [ ] Every skill contains generated `agents/openai.yaml`.
- [ ] `quick_validate.py` passes for all six.
- [ ] Root `AGENTS.md` documents the chain and the Phase 1 limit.
- [ ] No later-phase runtime code exists.

## Implementation checklist

### 0. Approval and safety baseline

- [x] Read and research the PRD.
- [x] Complete MediaPipe repository and package due diligence.
- [x] Complete movement-science research.
- [x] Complete Cerebro architecture and blast-radius review.
- [x] Persist the laptop-first decision in this checklist.
- [ ] Receive Pedro's authorization to begin implementation.
- [ ] Confirm a clean or understood worktree.
- [ ] Record the starting commit in the Session Continuation Log.
- [ ] Re-read the current Next.js 16 local documentation before writing code.

### 1. Create the skill chain

- [ ] Run `skill-creator` initialisation for all six skills.
- [ ] Implement the three Phase 1 skill instructions.
- [ ] Stub the three later skills.
- [ ] Validate all skills.
- [ ] Update root `AGENTS.md`.
- [ ] Stop if any skill contract overlaps another skill's responsibility.

### 2. Verify and install MediaPipe

- [ ] Re-run npm registry provenance checks.
- [ ] Re-run package dry-run inspection.
- [ ] Confirm exact package integrity.
- [ ] Install only `@mediapipe/tasks-vision@0.10.35` with exact pinning.
- [ ] Review `package.json` and lockfile diff.
- [ ] Reject unexpected packages, scripts, or transitive dependencies.
- [ ] Download official Full v1 model.
- [ ] Verify the model SHA-256.
- [ ] Copy only required official WASM, loader, model, and licence assets to a versioned same-origin path.
- [ ] Add immutable caching only for the versioned MediaPipe asset path.
- [ ] Run dependency audit.

### 3. Add isolated route and navigation

- [ ] Add `/dashboard/pt/movement-screening`.
- [ ] Add Movement Screening directly after M & L Assessment in PT navigation.
- [ ] Confirm dashboard authentication and Pedro admin authorization are inherited.
- [ ] Keep the server page shell separate from the client camera runtime.
- [ ] Add a route-level loading state.
- [ ] Add a route-level error boundary.
- [ ] Do not modify M & L implementation files.
- [ ] Do not modify global CSS unless a feature-scoped rule is unavoidable.

### 4. Define shared contracts

- [ ] Define `EntryPoint`.
- [ ] Define `FrameSource`.
- [ ] Define `InputFrame`.
- [ ] Define `PoseFrame`.
- [ ] Define `LandmarkSeries`.
- [ ] Define `MovementContext`.
- [ ] Define `MovementMetrics`.
- [ ] Define `RulesConfig`.
- [ ] Define `StructuredFinding`.
- [ ] Define `ScreeningResult`.
- [ ] Include explicit schema versions.
- [ ] Include `AbortSignal` and cleanup contracts.
- [ ] Include calibration status and complete provenance.
- [ ] Add a fake frame source for pipeline tests.

### 5. Implement laptop camera and overlay

- [ ] Request camera only after a user gesture.
- [ ] Request `facingMode: user`.
- [ ] Set `audio: false` for analysis capture.
- [ ] Use `playsInline`, muted preview, and `object-contain`.
- [ ] Read actual source dimensions.
- [ ] Show clear permission-denied and no-camera errors.
- [ ] Draw minimalist bright-green landmarks.
- [ ] Draw thin green pose connections.
- [ ] Keep preview and overlay visually mirrored together.
- [ ] Keep inference coordinates unmirrored.
- [ ] Verify anatomical left and right using a deliberate hand-raise test.
- [ ] Stop every media track on completion, error, navigation, page hiding, and unmount.

### 6. Implement worker-based pose extraction

- [ ] Lazy-load MediaPipe after camera activation.
- [ ] Initialise it inside a module Web Worker.
- [ ] Use `VIDEO` running mode.
- [ ] Set `numPoses` to 1.
- [ ] Disable segmentation output.
- [ ] Try GPU delegate first.
- [ ] Retry in the worker with CPU on GPU or WebGL failure.
- [ ] Transfer one image bitmap at a time.
- [ ] Skip new frames while the worker is busy.
- [ ] Never build an inference queue.
- [ ] Record inference time and effective FPS.
- [ ] Require at least 15 effective FPS for a valid trial.
- [ ] Add geometric plausibility checks in addition to confidence scores.
- [ ] Treat main-thread inference as diagnostic only.
- [ ] Do not allow Phase 1 acceptance through a main-thread fallback.

### 7. Implement laptop calibration recording

The recording exists to create Pedro's calibration evidence, not to create a client screening record.

- [ ] Record the same live-camera trial used by pose extraction.
- [ ] Use a browser-supported local format, expected to be WebM in desktop Chrome.
- [ ] Do not upload the video.
- [ ] Keep the video in browser memory until Pedro downloads or discards it.
- [ ] Generate a stable trial ID.
- [ ] Download the raw camera recording with the trial ID.
- [ ] Download a matching JSON bundle with the same trial ID.
- [ ] Include frame timestamps and landmark series in the JSON bundle.
- [ ] Include quality gates, per-repetition metrics, aggregate metrics, rules version, and findings.
- [ ] Mark all pre-calibration output as `uncalibrated`.
- [ ] Allow Pedro to discard and redo a capture.
- [ ] Stop and release recording resources after download, discard, or redo.
- [ ] Confirm a downloaded video plays correctly in desktop Chrome.
- [ ] Confirm video and JSON timestamps align.

### 8. Implement metrics extraction without final Pedro thresholds

#### Shared preprocessing

- [ ] Convert normalised landmarks into source-frame pixel coordinates before mixed-axis geometry.
- [ ] Capture a stable three-second standing baseline.
- [ ] Use medians across the baseline.
- [ ] Freeze baseline body dimensions for the trial.
- [ ] Filter noisy landmark trajectories deterministically.
- [ ] Segment exactly three squat repetitions.
- [ ] Reject incomplete or ambiguous repetition sets.
- [ ] Detect bottom positions from filtered hip descent and direction reversal.
- [ ] Preserve raw and filtered values in the calibration bundle.

#### Lateral hip or pelvis translation

- [ ] Calculate hip midpoint.
- [ ] Calculate ankle midpoint.
- [ ] Subtract the neutral standing hip-to-ankle offset.
- [ ] Divide by neutral standing hip width.
- [ ] Calculate a robust peak for each repetition.
- [ ] Preserve sign for anatomical direction.
- [ ] Aggregate using the median across three repetitions.
- [ ] Return `variable` direction when repetitions do not agree.
- [ ] Name the metric `hip_lateral_translation_ratio`.
- [ ] Never label the metric as weakness, imbalance, or injury risk.

#### Front-view squat-depth proxy

- [ ] Calculate hip midpoint and knee midpoint.
- [ ] Divide the vertical hip-knee margin by neutral femur length.
- [ ] Calculate the bottom-window value for each repetition.
- [ ] Aggregate using the median across three repetitions.
- [ ] Name the metric `hip_knee_vertical_margin_ratio`.
- [ ] Label it explicitly as a front-view proxy.
- [ ] Support `pass`, `finding`, and `indeterminate` configuration bands.
- [ ] Never claim that the front camera directly measures the anatomical hip crease.

### 9. Implement versioned JSON rules data

- [ ] Create a dedicated versioned movement-screening rules table.
- [ ] Store the full rules document in JSONB.
- [ ] Enable RLS.
- [ ] Permit authenticated Pedro/admin reads only.
- [ ] Expose no browser write policy.
- [ ] Enforce one active version.
- [ ] Keep versions immutable.
- [ ] Include parent version, creator, timestamp, and config hash.
- [ ] Seed an `uncalibrated` Phase 1 config from a checked-in local JSON fixture.
- [ ] Load the active config server-side.
- [ ] Validate it before passing it to the client runtime.
- [ ] Lock the loaded rules version when a trial begins.
- [ ] Fail closed when the config is missing or invalid.
- [ ] Confirm threshold changes can be made by adding and activating JSON data without an application deploy.
- [ ] Run Supabase security advisors after the schema change.

### 10. Implement the pure rules engine

- [ ] Accept only metrics and validated config.
- [ ] Support explicit enumerated conditions.
- [ ] Never evaluate arbitrary code or expressions from JSON.
- [ ] Reject invalid metric names and malformed severity bands.
- [ ] Reject non-monotonic thresholds.
- [ ] Skip findings when metric quality is invalid.
- [ ] Add rule ID and rules version to every finding.
- [ ] Add observed value, comparison, and threshold to every finding.
- [ ] Add anatomical direction where relevant.
- [ ] Produce structured fields only.
- [ ] Render findings JSON on screen.
- [ ] Keep uncalibrated findings visibly marked as provisional.

### 11. Build the one-page laptop workflow

- [ ] Show simple setup instructions.
- [ ] Add Enable camera.
- [ ] Show camera and live overlay.
- [ ] Show full-body framing and tracking status.
- [ ] Show model-loading progress.
- [ ] Show a three-second neutral-baseline countdown.
- [ ] Prompt for three overhead squats.
- [ ] Show detected repetition count.
- [ ] Automatically finish after the third valid repetition, with a manual stop fallback.
- [ ] Show processing progress.
- [ ] Show quality result.
- [ ] Show metrics JSON.
- [ ] Show findings JSON.
- [ ] Show active rules version and calibration status.
- [ ] Add Download video.
- [ ] Add Download calibration JSON.
- [ ] Add Copy result JSON.
- [ ] Add Redo trial.
- [ ] Keep one primary action visible at a time.

### 12. Automated tests

- [ ] Test pipeline source independence with a fake source.
- [ ] Test clean synthetic landmark series.
- [ ] Test left-shift series.
- [ ] Test right-shift series.
- [ ] Test shallow-depth series.
- [ ] Test adequate-depth series.
- [ ] Test borderline depth.
- [ ] Test low-confidence frames.
- [ ] Test missing hip, knee, or ankle landmarks.
- [ ] Test phone or camera movement simulation.
- [ ] Test fewer and more than three repetitions.
- [ ] Test exact rule-boundary values.
- [ ] Test invalid JSON config.
- [ ] Test non-monotonic thresholds.
- [ ] Test provenance and rules version in findings.
- [ ] Test cancellation and cleanup.
- [ ] Use the smallest safe test setup and avoid an unnecessary test-framework dependency.

### 13. Laptop browser technical acceptance

This gate proves the software before Pedro defines final movement rules.

- [ ] Test through an authenticated HTTPS deployment or an approved secure local setup.
- [ ] Record laptop model, operating-system version, Chrome version, and camera label.
- [ ] Camera permission succeeds.
- [ ] Full body remains visible.
- [ ] Green landmarks and connections align with the body.
- [ ] Anatomical left and right are correct.
- [ ] Worker inference runs.
- [ ] GPU works, or CPU-worker fallback sustains at least 15 FPS.
- [ ] No main-thread fallback is used for acceptance.
- [ ] Three repetitions are detected consistently.
- [ ] Recording starts and stops correctly.
- [ ] Downloaded WebM plays correctly.
- [ ] Matching JSON downloads correctly.
- [ ] JSON and video timestamps align.
- [ ] Redo releases the previous camera and recording resources.
- [ ] Navigating away turns the camera off.
- [ ] No video, image frame, or landmark payload is uploaded.
- [ ] Network inspection documents any MediaPipe telemetry.
- [ ] TypeScript passes.
- [ ] Targeted lint passes.
- [ ] Production build passes.
- [ ] Dependency audit has no new high or critical vulnerability.

## Pedro calibration workflow

Do not begin this section until the laptop browser technical acceptance gate passes.

Pedro will provide the source-of-truth examples using the laptop front camera.

### A. Clean ceiling recordings

- [ ] Pedro records at least five technically valid clean trials.
- [ ] Each trial contains three overhead squats.
- [ ] Video and calibration JSON are saved together.
- [ ] Pedro confirms which trial best represents his clean ceiling.
- [ ] Store the selected ceiling fixtures in the approved project fixture location.
- [ ] Record Pedro's explanation of what makes the movement clean.

### B. Lateral-shift fault recordings

- [ ] Pedro records deliberate subject-left shifts.
- [ ] Pedro records deliberate subject-right shifts.
- [ ] Pedro records mild, moderate, and clear examples where practical.
- [ ] Pedro identifies which examples should and should not be flagged.
- [ ] Pedro explains why.
- [ ] Compare ratios against the clean ceiling distribution.
- [ ] Propose initial JSON bands for Pedro.
- [ ] Pedro approves or edits the bands.

### C. Squat-depth recordings

- [ ] Pedro records examples he considers adequate depth.
- [ ] Pedro records borderline examples.
- [ ] Pedro records clearly insufficient-depth examples.
- [ ] Pedro defines the line between pass, indeterminate, and finding.
- [ ] Pedro explains how the front-view proxy should be interpreted.
- [ ] Compare depth-proxy values against Pedro's labels.
- [ ] Propose initial JSON bands for Pedro.
- [ ] Pedro approves or edits the bands.

### D. Freeze the calibrated Phase 1 rules

- [ ] Create a new immutable rules version.
- [ ] Mark it `calibrated` for Pedro's laptop setup only.
- [ ] Activate it without deploying the app.
- [ ] Preserve the previous uncalibrated version.
- [ ] Record the calibration fixture IDs and Pedro's reasons in the config metadata.
- [ ] Do not generalise the thresholds to clients or phones.

## Final Phase 1 functional acceptance

Run only after Pedro approves the calibrated laptop rules.

### Hip translation

- [ ] Five clean trials produce no lateral-translation finding.
- [ ] Five deliberately shifted trials produce a lateral-translation finding.
- [ ] At least two left and two right trials confirm anatomical direction.
- [ ] No rules are edited during the formal run.
- [ ] Every counted trial passes quality gates.
- [ ] Invalid-trial rate is no higher than 20 percent.

### Squat depth

- [ ] Five Pedro-approved adequate-depth trials pass.
- [ ] Five Pedro-labelled insufficient-depth trials produce a finding.
- [ ] Borderline trials produce `indeterminate`.
- [ ] No borderline trial silently passes.
- [ ] No rules are edited during the formal run.

### Phase completion

- [ ] All six skills validate.
- [ ] All automated tests pass.
- [ ] Laptop technical acceptance passes.
- [ ] Pedro calibration is stored and versioned.
- [ ] Hip-translation acceptance passes 5 out of 5 both ways.
- [ ] Squat-depth acceptance passes 5 out of 5 both ways.
- [ ] No known critical or high-severity regression remains.
- [ ] No unrelated Cerebro feature is affected.
- [ ] `HANDOFF.md` and this checklist show the final verified state.
- [ ] Commit and push the completed Phase 1.
- [ ] Only then discuss the next phase or phone validation.

## Current Resume Point

Last completed:

- PRD read and researched.
- Package, science, browser, Supabase, and repository due diligence completed.
- Laptop-first plan persisted.

Next action:

1. Pedro authorises implementation.
2. Re-read the required project files.
3. Start at Implementation Checklist item 1: Create the skill chain.

Current blockers:

- No implementation blocker.
- Pedro's final ceiling, hip-shift, and squat-depth definitions are intentionally deferred until the laptop interface and recording bundle work.

## Session Continuation Log

| Date | Completed | Verification | Next action | Blockers |
| --- | --- | --- | --- | --- |
| 2026-07-04 | Phase 1 plan persisted with laptop-first calibration workflow | Planning review only, no application code changed | Wait for implementation authorization, then create six skills | Final movement thresholds intentionally deferred |

## Research references

- Google Pose Landmarker Web guide: `https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js`
- Official MediaPipe repository: `https://github.com/google-ai-edge/mediapipe`
- Official worker sample: `https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/pose-landmarker.worker.ts`
- BlazePose GHUM model card: `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf`
- Markerless squat systematic review: `https://pubmed.ncbi.nlm.nih.gov/40526450/`
- Functional Movement Screen review: `https://pmc.ncbi.nlm.nih.gov/articles/PMC4060319/`
- Supabase data-security guidance: `https://supabase.com/docs/guides/database/secure-data`
