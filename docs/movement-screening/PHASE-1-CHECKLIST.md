# Cerebro Movement Screening - Phase 1 Build Checklist

## Status

- Current phase: Phase 1 only
- Current state: iPhone capture compatibility implemented and automated checks passing; HTTPS deployment is next
- Current target: Pedro's iPhone 16 Pro, Chrome, front camera, authenticated Cerebro HTTPS deployment
- Next action: Deploy the verified build, then follow `PHONE-CAPTURE-TEST-GUIDE.md`
- Source PRD: `Cerebro Knowledge/cerebro-movement-screening-PRD.md`
- Pedro test guide: `docs/movement-screening/PHONE-CAPTURE-TEST-GUIDE.md`
- Route: `/dashboard/pt/movement-screening`
- Later phases: Locked until every Phase 1 completion gate passes

This file is the durable source of truth for the build. Update it after every working session. A new session must continue from the first unchecked item unless the Current Resume Point says otherwise.

## Pedro's decisions that override the draft PRD

1. Pedro's laptop webcam is unavailable, so the Phase 1 capture and calibration device is now his iPhone 16 Pro front camera.
2. Use Chrome on the authenticated Cerebro HTTPS deployment; do not use the laptop's insecure LAN URL.
3. The phone records and processes the live trial. The matching video and JSON evidence pair is transferred to the laptop for calibration review.
4. Keep the existing device-independent live-camera pipeline. Do not fork phone metrics or rules logic.
5. Build the interface, camera pipeline, recording, pose extraction, metrics pipeline, and rules workflow before asking Pedro for final movement thresholds.
6. Pedro will record clean and deliberately faulted overhead squats on the phone.
7. Those recordings, landmark data, metrics, and Pedro's judgement will define the ceiling, squat-depth boundary, hip-shift thresholds, and severity bands.
8. Do not treat provisional research values as Pedro's final rules.
9. This does not unlock the later client self-screening flow or any post-Phase-1 feature.

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
- Chrome on iPhone 16 Pro with front-camera capture through HTTPS.
- A live bright-green MediaPipe landmark overlay.
- One movement: overhead squat, front view.
- Three repetitions per trial.
- A locally downloadable or shareable MP4/WebM calibration video from the same live-camera session.
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
- A client-facing guided phone-screening flow.
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

These rules keep phone capture and later browser/video adapters on one pipeline:

- Never hardcode camera dimensions.
- Read the actual stream width and height.
- Keep video capture behind the `FrameSource` interface.
- Process unmirrored source frames.
- Mirror only the visible preview and overlay.
- Store direction as the subject's anatomical left or right.
- Keep overlay sizing derived from the source frame.
- Keep metrics in body-relative ratios, not pixels or centimetres.
- Run MediaPipe through a dedicated browser worker.
- Under Next.js 16 Turbopack, allow the generated worker bootstrap to remain classic because it loads bundled chunks with `importScripts()`; forcing `type: "module"` prevents Chrome from starting it.
- Keep GPU and CPU-worker delegates interchangeable.
- Do not use desktop-only file paths or browser APIs without capability checks.
- Keep camera controls usable with touch.
- Do not change metrics or rules for iPhone capture.

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

- [x] `pose-extraction`
  - Input: camera or video frame source.
  - Output: timestamped landmark series and quality metadata.
  - Owns MediaPipe loading, worker lifecycle, landmark coordinates, and pose-quality gates.
  - Does not know squat rules or Pedro's thresholds.

- [x] `metrics-extraction`
  - Input: landmark series plus movement and angle.
  - Output: per-repetition and aggregate movement metrics.
  - Owns filtering, neutral baseline, repetition segmentation, hip translation, and depth proxy.
  - Does not create prose or decide coaching meaning.

- [x] `rules-engine`
  - Input: movement metrics plus validated rules config.
  - Output: structured findings.
  - Owns JSON validation, condition evaluation, severity mapping, direction, and provenance.
  - Does not compute landmarks or movement metrics.

### Required stubs

- [x] `commentary-parser`
  - Valid skill scaffold.
  - Hard stop stating it is unavailable in Phase 1.

- [x] `report-generator`
  - Valid skill scaffold.
  - Hard stop stating it is unavailable in Phase 1.

- [x] `refinement-proposer`
  - Valid skill scaffold.
  - Hard stop stating it is unavailable in Phase 1.

### Skill validation gate

- [x] Every skill contains a valid `SKILL.md`.
- [x] Every skill contains generated `agents/openai.yaml`.
- [x] `quick_validate.py` passes for all six.
- [x] Root `AGENTS.md` documents the chain and the Phase 1 limit.
- [x] No later-phase runtime code exists.

## Implementation checklist

### 0. Approval and safety baseline

- [x] Read and research the PRD.
- [x] Complete MediaPipe repository and package due diligence.
- [x] Complete movement-science research.
- [x] Complete Cerebro architecture and blast-radius review.
- [x] Persist the initial laptop-first decision and Pedro's later iPhone-camera override in this checklist.
- [x] Receive Pedro's authorization to begin implementation.
- [x] Confirm a clean or understood worktree.
- [x] Record the starting commit in the Session Continuation Log.
- [x] Re-read the current Next.js 16 local documentation before writing code.

### 1. Create the skill chain

- [x] Run `skill-creator` initialisation for all six skills.
- [x] Implement the three Phase 1 skill instructions.
- [x] Stub the three later skills.
- [x] Validate all skills.
- [x] Update root `AGENTS.md`.
- [x] Stop if any skill contract overlaps another skill's responsibility.

### 2. Verify and install MediaPipe

- [x] Re-run npm registry provenance checks.
- [x] Re-run package dry-run inspection.
- [x] Confirm exact package integrity.
- [x] Install only `@mediapipe/tasks-vision@0.10.35` with exact pinning.
- [x] Review `package.json` and lockfile diff.
- [x] Reject unexpected packages, scripts, or transitive dependencies.
- [x] Download official Full v1 model.
- [x] Verify the model SHA-256.
- [x] Copy only required official WASM, loader, model, and licence assets to a versioned same-origin path.
- [x] Add immutable caching only for the versioned MediaPipe asset path.
- [x] Run dependency audit.

### 3. Add isolated route and navigation

- [x] Add `/dashboard/pt/movement-screening`.
- [x] Add Movement Screening directly after M & L Assessment in PT navigation.
- [x] Confirm dashboard authentication and Pedro admin authorization are inherited.
- [x] Keep the server page shell separate from the client camera runtime.
- [x] Add a route-level loading state.
- [x] Add a route-level error boundary.
- [x] Do not modify M & L implementation files.
- [x] Do not modify global CSS unless a feature-scoped rule is unavoidable.

### 4. Define shared contracts

- [x] Define `EntryPoint`.
- [x] Define `FrameSource`.
- [x] Define `InputFrame`.
- [x] Define `PoseFrame`.
- [x] Define `LandmarkSeries`.
- [x] Define `MovementContext`.
- [x] Define `MovementMetrics`.
- [x] Define `RulesConfig`.
- [x] Define `StructuredFinding`.
- [x] Define `ScreeningResult`.
- [x] Include explicit schema versions.
- [x] Include `AbortSignal` and cleanup contracts.
- [x] Include calibration status and complete provenance.
- [x] Add a fake frame source for pipeline tests.

### 5. Implement live front camera and overlay

- [x] Request camera only after a user gesture.
- [x] Request `facingMode: user`.
- [x] Set `audio: false` for analysis capture.
- [x] Use `playsInline`, muted preview, and `object-contain`.
- [x] Read actual source dimensions.
- [x] Show clear permission-denied and no-camera errors.
- [x] Draw minimalist bright-green landmarks.
- [x] Draw thin green pose connections.
- [x] Keep preview and overlay visually mirrored together.
- [x] Keep inference coordinates unmirrored.
- [ ] Verify anatomical left and right using a deliberate hand-raise test.
- [x] Stop every media track on completion, error, navigation, page hiding, and unmount.

### 6. Implement worker-based pose extraction

- [x] Lazy-load MediaPipe after camera activation.
- [x] Initialise it inside a dedicated Web Worker compatible with the Next.js 16 Turbopack bootstrap.
- [x] Use `VIDEO` running mode.
- [x] Set `numPoses` to 1.
- [x] Disable segmentation output.
- [x] Try GPU delegate first.
- [x] Retry in the worker with CPU on GPU or WebGL failure.
- [x] Transfer one image bitmap at a time.
- [x] Skip new frames while the worker is busy.
- [x] Never build an inference queue.
- [x] Record inference time and effective FPS.
- [x] Require at least 15 effective FPS for a valid trial.
- [x] Add geometric plausibility checks in addition to confidence scores.
- [x] Treat main-thread inference as diagnostic only.
- [x] Do not allow Phase 1 acceptance through a main-thread fallback.

### 7. Implement local calibration recording

The recording exists to create Pedro's calibration evidence, not to create a client screening record.

- [x] Record the same live-camera trial used by pose extraction.
- [x] Detect a browser-supported local format at runtime: WebM on compatible Chromium and MP4 fallback for iPhone/WebKit.
- [x] Do not upload the video.
- [x] Keep the video in browser memory until Pedro downloads or discards it.
- [x] Generate a stable trial ID.
- [x] Download the raw camera recording with the trial ID.
- [x] Download a matching JSON bundle with the same trial ID.
- [x] Offer a phone share-sheet action containing the matching video and JSON files.
- [x] Include frame timestamps and landmark series in the JSON bundle.
- [x] Include quality gates, per-repetition metrics, aggregate metrics, rules version, and findings.
- [x] Mark all pre-calibration output as `uncalibrated`.
- [x] Allow Pedro to discard and redo a capture.
- [x] Stop and release recording resources after download, discard, or redo.
- [ ] Confirm the phone-exported MP4/WebM plays correctly on the laptop.
- [ ] Confirm video and JSON timestamps align.

### 8. Implement metrics extraction without final Pedro thresholds

#### Shared preprocessing

- [x] Convert normalised landmarks into source-frame pixel coordinates before mixed-axis geometry.
- [x] Capture a stable three-second standing baseline.
- [x] Use medians across the baseline.
- [x] Freeze baseline body dimensions for the trial.
- [x] Filter noisy landmark trajectories deterministically.
- [x] Segment exactly three squat repetitions.
- [x] Reject incomplete or ambiguous repetition sets.
- [x] Detect bottom positions from filtered hip descent and direction reversal.
- [x] Preserve raw and filtered values in the calibration bundle.

#### Lateral hip or pelvis translation

- [x] Calculate hip midpoint.
- [x] Calculate ankle midpoint.
- [x] Subtract the neutral standing hip-to-ankle offset.
- [x] Divide by neutral standing hip width.
- [x] Calculate a robust peak for each repetition.
- [x] Preserve sign for anatomical direction.
- [x] Aggregate using the median across three repetitions.
- [x] Return `variable` direction when repetitions do not agree.
- [x] Name the metric `hip_lateral_translation_ratio`.
- [x] Never label the metric as weakness, imbalance, or injury risk.

#### Front-view squat-depth proxy

- [x] Calculate hip midpoint and knee midpoint.
- [x] Divide the vertical hip-knee margin by neutral femur length.
- [x] Calculate the bottom-window value for each repetition.
- [x] Aggregate using the median across three repetitions.
- [x] Name the metric `hip_knee_vertical_margin_ratio`.
- [x] Label it explicitly as a front-view proxy.
- [x] Support `pass`, `finding`, and `indeterminate` configuration bands.
- [x] Never claim that the front camera directly measures the anatomical hip crease.

### 9. Implement versioned JSON rules data

- [x] Create a dedicated versioned movement-screening rules table.
- [x] Store the full rules document in JSONB.
- [x] Enable RLS.
- [x] Permit authenticated Pedro/admin reads only.
- [x] Expose no browser write policy.
- [x] Enforce one active version.
- [x] Keep versions immutable.
- [x] Include parent version, creator, timestamp, and config hash.
- [x] Seed an `uncalibrated` Phase 1 config from a checked-in local JSON fixture.
- [x] Load the active config server-side.
- [x] Validate it before passing it to the client runtime.
- [x] Lock the loaded rules version when a trial begins.
- [x] Fail closed when the config is missing or invalid.
- [x] Confirm threshold changes can be made by adding and activating JSON data without an application deploy.
- [x] Run Supabase security advisors after the schema change.

### 10. Implement the pure rules engine

- [x] Accept only metrics and validated config.
- [x] Support explicit enumerated conditions.
- [x] Never evaluate arbitrary code or expressions from JSON.
- [x] Reject invalid metric names and malformed severity bands.
- [x] Reject non-monotonic thresholds.
- [x] Skip findings when metric quality is invalid.
- [x] Add rule ID and rules version to every finding.
- [x] Add observed value, comparison, and threshold to every finding.
- [x] Add anatomical direction where relevant.
- [x] Produce structured fields only.
- [x] Render findings JSON on screen.
- [x] Keep uncalibrated findings visibly marked as provisional.

### 11. Build the one-page live-camera workflow

- [x] Show simple setup instructions.
- [x] Add Enable camera.
- [x] Show camera and live overlay.
- [x] Show full-body framing and tracking status.
- [x] Show model-loading progress.
- [x] Show a three-second neutral-baseline countdown.
- [x] Prompt for three overhead squats.
- [x] Show detected repetition count.
- [x] Automatically finish after the third valid repetition, with a manual stop fallback.
- [x] Show processing progress.
- [x] Show quality result.
- [x] Show metrics JSON.
- [x] Show findings JSON.
- [x] Show active rules version and calibration status.
- [x] Add Download video.
- [x] Add Download calibration JSON.
- [x] Add Copy result JSON.
- [x] Add Redo trial.
- [x] Keep one primary action visible at a time.

### 12. Automated tests

- [x] Test pipeline source independence with a fake source.
- [x] Test clean synthetic landmark series.
- [x] Test left-shift series.
- [x] Test right-shift series.
- [x] Test shallow-depth series.
- [x] Test adequate-depth series.
- [x] Test borderline depth.
- [x] Test low-confidence frames.
- [x] Test missing hip, knee, or ankle landmarks.
- [x] Test phone or camera movement simulation.
- [x] Test fewer and more than three repetitions.
- [x] Test exact rule-boundary values.
- [x] Test invalid JSON config.
- [x] Test non-monotonic thresholds.
- [x] Test provenance and rules version in findings.
- [x] Test cancellation and cleanup.
- [x] Use the smallest safe test setup and avoid an unnecessary test-framework dependency.

### 13. iPhone browser technical acceptance

This gate proves the software before Pedro defines final movement rules.

- Target environment: iPhone 16 Pro front camera, Chrome, authenticated HTTPS Cerebro deployment.
- Exact iOS version, Chrome version, camera label, source resolution, delegate, and FPS remain pending the first phone trial.

- [ ] Test through an authenticated HTTPS deployment or an approved secure local setup.
- [ ] Record iPhone model, iOS version, Chrome version, and camera label.
- [ ] Camera permission succeeds.
- [ ] Full body remains visible.
- [ ] Green landmarks and connections align with the body.
- [ ] Anatomical left and right are correct.
- [ ] Worker inference runs.
- [ ] GPU works, or CPU-worker fallback sustains at least 15 FPS.
- [ ] No main-thread fallback is used for acceptance.
- [ ] Three repetitions are detected consistently.
- [ ] Recording starts and stops correctly.
- [ ] Exported MP4/WebM plays correctly on the laptop.
- [ ] Matching JSON downloads correctly.
- [ ] `Share evidence` presents both matching files on iPhone.
- [ ] JSON and video timestamps align.
- [ ] Redo releases the previous camera and recording resources.
- [ ] Navigating away turns the camera off.
- [ ] No video, image frame, or landmark payload is uploaded.
- [ ] Network inspection documents any MediaPipe telemetry.
- [x] TypeScript passes.
- [x] Targeted lint passes.
- [x] Production build passes.
- [x] Dependency audit has no new high or critical vulnerability.

## Pedro calibration workflow

Do not begin this section until the iPhone browser technical acceptance gate passes.

Pedro will provide the source-of-truth examples using the iPhone front camera.

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
- [ ] Mark it `calibrated` for Pedro's iPhone 16 Pro setup only.
- [ ] Activate it without deploying the app.
- [ ] Preserve the previous uncalibrated version.
- [ ] Record the calibration fixture IDs and Pedro's reasons in the config metadata.
- [ ] Do not generalise the thresholds to clients or other devices.

## Final Phase 1 functional acceptance

Run only after Pedro approves the calibrated iPhone rules.

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

- [x] All six skills validate.
- [x] All automated tests pass.
- [ ] iPhone technical acceptance passes.
- [ ] Pedro calibration is stored and versioned.
- [ ] Hip-translation acceptance passes 5 out of 5 both ways.
- [ ] Squat-depth acceptance passes 5 out of 5 both ways.
- [ ] No known critical or high-severity regression remains.
- [ ] No unrelated Cerebro feature is affected.
- [ ] `HANDOFF.md` and this checklist show the final verified state.
- [ ] Commit and push the completed Phase 1.
- [ ] Only then discuss the next phase or broader client/device validation.

## Current Resume Point

Last completed:

- PRD read and researched.
- Package, science, browser, Supabase, and repository due diligence completed.
- Initial laptop-first plan and later iPhone-camera override persisted.
- Six-skill chain created and validated; only the first three are functional.
- Isolated PT route, worker pose extraction, two-metric pipeline, JSON rules engine, local recording/export, and versioned Supabase rule storage implemented.
- Fifteen deterministic movement-screening tests, TypeScript, targeted lint, production build, production dependency audit, RLS checks, asset hashes, route protection, and immutable asset-header checks pass.
- Fixed the real-browser startup failure where Next.js 16 Turbopack emitted a classic `importScripts()` worker bootstrap but the app forced Chrome to treat it as a module worker.

Next action:

1. Finish automated verification and deploy the current commit to Cerebro HTTPS.
2. Open the authenticated movement-screening route in Chrome on the iPhone 16 Pro.
3. Follow `docs/movement-screening/PHONE-CAPTURE-TEST-GUIDE.md` and complete three technical trials.
4. Record the iOS/Chrome/camera environment and verify overlay alignment, anatomical direction, worker FPS, automatic three-rep detection, MP4/WebM playback, JSON alignment, evidence sharing, camera cleanup, and network privacy.
5. Only after that gate passes, record Pedro's clean and faulted calibration examples.

Current blockers:

- Automated browser control still cannot attach to Pedro's Chrome extension session. Chrome is running, the Codex Chrome Extension 1.1.5 is installed and enabled in the selected Default profile, and the native-host manifest is valid. The approved fresh-window helper failed at macOS LaunchServices, and the required one-time connection retry still failed. Chrome plugin reinstallation from the Codex plugin UI is now required before another automated attempt.
- Pedro's real-camera test now depends on the phone-compatible build reaching the HTTPS deployment.
- Pedro's final ceiling, hip-shift, and squat-depth definitions remain intentionally deferred until technical iPhone acceptance passes.

## Session Continuation Log

| Date | Completed | Verification | Next action | Blockers |
| --- | --- | --- | --- | --- |
| 2026-07-04 | Phase 1 plan persisted with laptop-first calibration workflow | Planning review only, no application code changed | Wait for implementation authorization, then create six skills | Final movement thresholds intentionally deferred |
| 2026-07-04 | Implementation authorised at start commit `163619f9bf5f`; six skills created and root chain documented | `quick_validate.py` passed all six; unrelated concurrent Studio changes identified and preserved | Verify and install exact-pinned MediaPipe assets | Final movement thresholds intentionally deferred |
| 2026-07-04 | Laptop-first technical build implemented through the manual camera gate; active uncalibrated rules v1 applied to Supabase | 13/13 tests, TypeScript, targeted lint, Next 16.2.10 build, production audit 0, RLS/read-only checks, hashes, auth redirect, and asset headers pass | Pedro runs `LAPTOP-TEST-GUIDE.md` | Controlled browser surfaces unavailable; final thresholds deferred |
| 2026-07-04 | Captured the laptop, OS, and Chrome environment and completed Chrome-control diagnostics | MacBookPro15,1; macOS 15.7.7 build 24G720; Chrome 149.0.7827.198; extension installed/enabled; native-host manifest valid | Reinstall the Chrome plugin from the Codex plugin UI, then retry the authenticated camera test | Browser control cannot attach; approved fresh-window helper failed in macOS LaunchServices |
| 2026-07-04 | Fixed Chrome camera shutdown during pose startup by removing the incompatible module-worker flag from the Turbopack-generated classic worker bootstrap; preserved module WASM loading and added per-delegate errors | 14/14 tests, TypeScript, targeted lint, skill validation, production build, and compiled-worker inspection pass | Pedro hard-refreshes and reruns the real-camera startup | Real camera confirmation pending |
| 2026-07-04 | Pedro replaced the unavailable laptop webcam with iPhone 16 Pro front-camera capture; added runtime MP4/WebM selection, first-frame gating, phone-safe copy, and matched evidence sharing | 15/15 movement tests, TypeScript, targeted lint, production build, and compiled-worker inspection pass | Deploy, then run `PHONE-CAPTURE-TEST-GUIDE.md` | Final thresholds remain deferred |

## Research references

- Google Pose Landmarker Web guide: `https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js`
- Official MediaPipe repository: `https://github.com/google-ai-edge/mediapipe`
- Official worker sample: `https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/pose-landmarker.worker.ts`
- BlazePose GHUM model card: `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf`
- Markerless squat systematic review: `https://pubmed.ncbi.nlm.nih.gov/40526450/`
- Functional Movement Screen review: `https://pmc.ncbi.nlm.nih.gov/articles/PMC4060319/`
- Supabase data-security guidance: `https://supabase.com/docs/guides/database/secure-data`
