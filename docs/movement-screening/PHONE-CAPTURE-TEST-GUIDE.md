# Cerebro Movement Screening - iPhone Capture Guide

Use this guide for Phase 1 technical acceptance and Pedro's calibration recordings. The iPhone captures the trial; the laptop browser is used afterwards to inspect the evidence and calibrate the JSON rules.

Current production note, 2026-07-07: the live iPhone HUD uses a 4:3 full-sensor stream that fills the green capture card. Side cropping is expected, so stay centred. The instruction HUD is now a compact one-phrase cue at the top so Pedro can read it from distance without it blocking his head or torso.

Do not use these outputs for clients until the calibrated Phase 1 acceptance gate passes.

## Before you start

- [ ] Use the iPhone 16 Pro front camera.
- [ ] Update Chrome from the App Store.
- [ ] Confirm iOS allows Chrome to use the camera under `Settings > Apps > Chrome > Camera`.
- [ ] Use Wi-Fi with a stable internet connection.
- [ ] Open `https://cerebroai.au` in Chrome.
- [ ] Log in to Cerebro as Pedro/admin.
- [ ] Open `/dashboard/pt/movement-screening`.
- [ ] Confirm the page says `Rules uncalibrated`.
- [ ] Confirm the live image fills the green capture card with no big black bars. The sides may be cropped; keep your body centred.
- [ ] Confirm the top cue is readable from your squat distance and does not cover your head or torso.
- [ ] Do not use the laptop's `http://192.168...` address. Phone camera access requires the HTTPS Cerebro deployment.

## Position the phone

1. Keep the phone in portrait orientation.
2. Use the front camera.
3. Prop the phone securely near hip height where practical.
4. Start approximately 1.5 to 2.5 metres away, then adjust your body position only as much as needed to keep wrists and ankles inside the green frame.
5. Use a bright room with light facing you, not behind you.
6. Keep your full body visible, including both wrists and both ankles.
7. Keep the phone completely still for the whole trial.
8. Wear clothing that keeps the outline of the hips, knees, and ankles visible.

## Record the environment

| Item | Value |
| --- | --- |
| iPhone model | iPhone 16 Pro |
| iOS version | |
| Chrome version | |
| Camera label shown in JSON | |
| Camera resolution shown by Cerebro | |
| Preview shape | Filled 4:3 crop / other |
| Top cue readable at distance | Yes / No |
| Worker delegate shown by Cerebro | GPU / CPU |
| Inference FPS | |
| Recording format | MP4 / WebM |
| Rules version | |

## A. Technical camera check

1. Keep the screening page visible.
2. Tap `Enable camera`.
3. Allow camera access when Chrome asks.
4. Wait for `Loading pose model` to change to `Ready to record`.
5. Confirm your front-camera image fills the capture card. If your body is cut off sideways, centre yourself rather than touching the phone.
6. Confirm the top cue is short and readable. Expected setup cues include `Step back`, `Arms forward`, and `Hold still`.
7. Stand tall inside the green corners with both arms straight forward at shoulder height.
8. Confirm the status changes to `Auto start in 3.0 seconds` or the top cue changes to `Hold still`, then step outside before the countdown reaches zero.
9. Confirm the green dots and thin lines follow the wrists, shoulders, hips, knees, and ankles.
10. Raise only your anatomical left hand. The visible preview is mirrored, but stored direction must remain anatomical left.
11. Repeat with your anatomical right hand.

Stop here and report the exact red message if:

- the preview remains black;
- the camera closes before `Ready to record`;
- the overlay is offset or unstable;
- the cue blocks your head or torso;
- the worker never becomes ready;
- the page reports fewer than 15 inference frames per second.

## B. Record one technical trial

1. With the camera still ready, stand tall inside the green rectangle with both arms straight forward at shoulder height.
2. If the camera was turned off after the technical check, tap `Enable camera` before stepping back.
3. Hold inside the rectangle for three continuous seconds. Confirm stepping outside resets the auto-start countdown.
4. Let Cerebro start the trial automatically. Use `Start now` only as a fallback.
5. Hold completely still during the second three-second neutral-baseline countdown. The top cue should read `Freeze`.
6. Perform exactly three controlled bodyweight squats while keeping your arms straight forward.
7. Use the top cue to track the trial: `Squat 1 of 3`, `Squat 2 of 3`, then `Squat 3 of 3`.
8. Return fully upright after every repetition.
9. Watch the counter move from `0 / 3` to `3 / 3`.
10. After rep three, stand tall with your arms straight forward and remain still for three seconds. The top cue should read `Stand tall`.
11. Confirm movement resets the finish countdown and stillness resumes it.
12. Let Cerebro save and analyse automatically. Use `Stop early & analyse` only if automatic stopping fails.
13. Wait for `Recording successful` or a clear redo instruction.
14. Confirm the camera indicator turns off after analysis.

## C. Check the result

- [ ] The page shows accepted `screening-result/1.1.0` JSON or a clear rejection reason.
- [ ] An accepted result contains exactly three `perRepetition` entries.
- [ ] Both metrics exist:
  - `hip_lateral_translation_ratio`
  - `hip_knee_vertical_margin_ratio`
- [ ] `rulesVersion`, `rulesConfigSha256`, model hash, worker delegate, frame rate, and quality fields are present.
- [ ] `calibrationStatus` remains `uncalibrated`.
- [ ] Findings contain observed value, matched rule/band, comparison bounds, and anatomical direction where relevant.
- [ ] The output makes no injury, weakness, diagnosis, or causal claim.

## D. Move the evidence pair to the laptop

Preferred method:

1. Tap `Share evidence`.
2. Choose `Save to Files`, AirDrop, or another private destination you control.
3. Confirm the video and JSON are both included.

Fallback method:

1. Tap `Video`.
2. Tap `JSON bundle`.
3. Save both files to the same Files folder.

Verification:

- [ ] Both filenames share the same trial ID.
- [ ] The video is `.mp4` or `.webm`.
- [ ] The JSON filename uses the same trial ID.
- [ ] The video plays from start to finish on the laptop.
- [ ] The video contains the neutral hold and all three repetitions.
- [ ] JSON frame timestamps start near zero and cover the video duration.
- [ ] The JSON contains three repetition windows, raw landmarks, filtered trajectory, metrics, findings, rules version, and config hash.

Never rename only one file. Keep each video and matching JSON together.

## E. Privacy check

- [ ] MediaPipe JavaScript, WASM, and model files load from the Cerebro origin.
- [ ] No video blob, image frame, landmark series, metrics payload, or JSON bundle uploads to Supabase or another server.
- [ ] `Share evidence` opens the iOS share sheet; nothing leaves the phone until Pedro chooses a destination.
- [ ] Any unexpected network request is recorded before calibration continues.

## F. Technical acceptance record

Run three ordinary trials before collecting calibration examples.

| Trial ID | HUD readable | Overlay aligned | 3 reps | FPS at least 15 | Video plays | JSON matches | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

## G. Calibration capture order

Only begin after all three technical trials pass:

1. Five clean trials.
2. Deliberate subject-left hip shifts.
3. Deliberate subject-right hip shifts.
4. Adequate-depth examples.
5. Borderline-depth examples.
6. Clearly insufficient-depth examples.

For every trial, transfer the video and matching JSON to the laptop before recording the next category.
