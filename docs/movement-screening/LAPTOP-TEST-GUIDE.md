# Cerebro Movement Screening - Laptop Test Guide

Use this guide after each new build or rules version. Phase 1 is laptop-only. Do not use these outputs for clients until the calibrated acceptance gate passes.

## Before you start

- [ ] Use the same laptop and built-in front camera intended for calibration.
- [ ] Update desktop Chrome.
- [ ] Log in to Cerebro as Pedro/admin.
- [ ] Open `/dashboard/pt/movement-screening`.
- [ ] Allow camera access for the Cerebro site.
- [ ] Use a bright room with the camera near hip height where practical.
- [ ] Leave enough distance to show both wrists and both ankles at all times.
- [ ] Wear clothing that keeps the outline of the hips, knees, and ankles visible.
- [ ] Confirm the page says `Rules uncalibrated`.

Record this environment before the first accepted run:

| Item | Value |
| --- | --- |
| Laptop model | |
| macOS version | |
| Chrome version | |
| Camera label | |
| Camera resolution shown by Cerebro | |
| Worker delegate shown by Cerebro | GPU / CPU |
| Rules version | |

## A. Technical camera check

1. Click `Enable camera`.
2. Wait for `Ready to record`.
3. Stand inside the green corners with arms overhead.
4. Confirm the status changes to `Required landmarks visible`.
5. Confirm the green dots and thin lines follow the wrists, shoulders, hips, knees, and ankles.
6. Raise only your anatomical left hand. The visible preview is mirrored, but later JSON direction must still say anatomical `left`.
7. Lower the left hand, then repeat with the anatomical right hand.
8. If the overlay is offset, flickering heavily, or swaps left and right, stop. Do not calibrate rules.

## B. Record one technical trial

1. Stand upright with both arms overhead.
2. Click `Start 3-rep trial`.
3. Hold completely still while the top-right label counts down `HOLD 3.0s`.
4. Perform exactly three controlled overhead squats.
5. Return fully upright after every repetition.
6. Watch the counter move from `0 / 3 REPS` to `3 / 3 REPS`.
7. The trial should stop automatically after the third completed repetition. Use `Stop & analyse` only if automatic stopping fails.
8. Wait for `Trial complete`.
9. Confirm the camera light turns off after analysis.

## C. Check the result

- [ ] The page shows either accepted `screening-result/1.0.0` JSON or a clear rejection reason.
- [ ] An accepted result contains exactly three `perRepetition` entries.
- [ ] Both metrics exist:
  - `hip_lateral_translation_ratio`
  - `hip_knee_vertical_margin_ratio`
- [ ] `rulesVersion`, `rulesConfigSha256`, model hash, worker delegate, frame rate, and quality fields are present.
- [ ] `calibrationStatus` is still `uncalibrated`.
- [ ] Findings contain observed metric value, matched rule/band, comparison bounds, and anatomical direction where relevant.
- [ ] The output does not claim injury, weakness, diagnosis, or cause.

If rejected, use the message:

| Message | Action |
| --- | --- |
| Neutral baseline missing | Hold still for the full first three seconds. |
| Fewer or more than 3 repetitions | Repeat exactly three reps and finish upright. |
| Low-confidence landmarks | Improve light, clothing contrast, and full-body framing. |
| Frame rate below threshold | Close heavy tabs/apps and retry. Record whether GPU or CPU was used. |
| Foot position or camera framing moved | Keep the laptop and feet fixed for the full trial. |
| Wrists not overhead | Keep both wrists above both shoulders through the trial. |

## D. Download and verify the evidence pair

1. Click `Video`.
2. Click `JSON bundle`.
3. Confirm both filenames share the same trial ID.
4. Play the WebM from start to finish in Chrome.
5. Confirm it contains the neutral hold and all three repetitions.
6. Open the JSON and confirm:
   - the same trial ID;
   - frame timestamps start near zero;
   - landmark frames cover the video duration;
   - exactly three repetition windows;
   - rules version and config hash;
   - raw landmark series;
   - filtered trajectory;
   - metrics and findings.
7. Keep the WebM and JSON together. Never rename only one file.
8. Click `New trial`; confirm the old preview is discarded and camera access must be enabled again.

## E. Privacy and network check

Open Chrome DevTools → Network before enabling the camera.

- [ ] The MediaPipe JavaScript/WASM/model requests come from the Cerebro origin.
- [ ] No video blob, image frame, landmark series, metrics payload, or JSON bundle is sent to Supabase or another server.
- [ ] Record any unexpected Google/MediaPipe telemetry request, including URL and request type.
- [ ] Do not proceed to client testing if capture data leaves the browser.

## F. Technical acceptance record

Run three ordinary trials before calibration.

| Trial ID | Overlay aligned | 3 reps detected | FPS ≥15 | Video plays | JSON matches | Result |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |
| | | | | | | |
| | | | | | | |

Technical acceptance passes only when all three rows pass, anatomical direction is correct, the camera releases after each run/navigation, and no capture payload is uploaded.

## G. Pedro calibration recordings

Start this only after technical acceptance passes.

1. Record at least five clean trials.
2. Record deliberate subject-left and subject-right hip shifts.
3. Record mild, moderate, and clear shifts where practical.
4. Record adequate, borderline, and clearly insufficient squat depth.
5. Save every accepted WebM and JSON pair.
6. For each pair, record Pedro's label and reason.
7. Use those labelled distributions to propose rules version 2.
8. Pedro approves the bands before version 2 becomes active.
9. Activate version 2 as data; do not redeploy the app.
10. Keep version 1 as the immutable uncalibrated baseline.

Do not start phone testing or later report/commentary/refinement skills during this process.
