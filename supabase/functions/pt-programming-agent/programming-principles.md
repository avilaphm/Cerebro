# Cerebro PT Programming Rules

These are Pedro Avila's hard coaching rules. Follow them exactly. They override generic AI assumptions.

---

## Programme Arc (New Clients - MANDATORY)

Every new programme MUST use this exact phase order. Do NOT collapse into fewer phases:

1. Phase 1 - Foundations (6-7 weeks)
2. 1RM Testing Session (1 week)
3. Phase 2 - Hypertrophy (10-12 weeks)
4. Phase 3 - Strength (10-12 weeks)
5. Retesting Session (1 week)
6. Taper / Deload

Year 3+ only: optional Power phase after Strength.

---

## Phase 1 - Foundations (HARD RULES)

ALWAYS exactly 3 workout days. Full body every session.
Do not create 2 days or 4+ days for Phase 1.

Week progression MUST follow this pattern:
- Weeks 1-2: 2 sets per exercise. Slow tempo. Movement quality only. No heavy loading.
- Weeks 3-4: 3 sets per exercise. Controlled tempo. Slightly higher intensity.
- Weeks 5-7: Introduce the Big 5 compounds. Tempo stays controlled.

Big 5 compounds introduced in weeks 5-7:
- BB Back Squat
- BB Deadlift
- BB Bench Press
- BB Shoulder Press
- Pull-up

week_blocks for Phase 1:
[{"weeks": 2, "sets": "2"}, {"weeks": 2, "sets": "3"}, {"weeks": 2, "sets": "3"}]

---

## Warm-Up Rules (HARD - every workout day)

EVERY workout day must have EXACTLY 4 warm-up exercises in the Warm Up section.
Each warm-up exercise: 1 set, 10-12 reps.
Purpose: blood flow, activation, movement prep. NOT fatigue or conditioning.

Use section_start: "Warm Up" on the first warm-up exercise only.

Select from this approved pool only (match to workout demands):
- 90/90 hip switches
- Cobra to child pose
- Spider-Man lunges
- Best stretch in the world
- T-spine rotations
- Thread the needle
- Downward dog dorsiflexion shifts
- Glute bridge marchers
- Hip CARs on all fours
- Seated hip pikes
- Seated leg lifts
- Dead bugs
- Bird dogs
- Bodyweight squats
- Band pull-aparts
- Half-kneeling rotations
- Knee-over-toe ankle rocks

Squat/deadlift day: choose hip, glute, and thoracic warm-ups.
Press day: choose shoulder, thoracic, and scapular warm-ups.
Pull day: choose thoracic, lat, and shoulder warm-ups.

---

## Workout Structure (every session)

Use section_start: "Workout" on the first main exercise.

Standard: 6 main exercises in 3 supersets.
Maximum: 9 exercises total per session.
Target session duration: 45 minutes.

Every week must include:
- At least one compound lift (squat, hinge, press, or pull)
- Mobility work
- Hip work
- Unilateral exercise
- Bilateral exercise
- Push + pull + hinge or squat pattern

Superset pairing: pair exercises that do not compete (e.g., upper/lower, push/pull, or compound/isolation).
Use superset_id to link paired exercises.

If adding MetCon or Stretches sections, use section_start: "MetCon" or "Stretches" on the first exercise of that section.

---

## Compound Tempo Rules (HARD - apply these exact tempos)

BB Back Squat: 3 sec descent, 2-3 sec pause at bottom, controlled ascent.
BB Deadlift: 2-3 sec controlled descent, 2-3 sec ascent off floor.
BB Shoulder Press: pause fully overhead, 3 sec eccentric (lowering phase).
Pull-up: 3 sec eccentric (lowering). Full hang at bottom.
BB Bench Press: 3 sec eccentric (lowering to chest), 2 sec pause at chest, press.

Write these tempos in the exercise notes field so clients see them.

---

## Hypertrophy Phase Rules

Target: 65-75% of 1RM.
Reps: 8-15 per set.
Sets: 3-5 per exercise.

Must include:
- Progressive overload across weeks (sets, reps, or load)
- Supersets to increase density
- Nutrition synchronization (higher carbs, protein support)
- Recovery coaching in notes

week_blocks example: [{"weeks": 3, "weight_pct": "65%"}, {"weeks": 3, "weight_pct": "70%"}, {"weeks": 3, "weight_pct": "75%"}]

---

## Strength Phase Rules

Target: 75-90% of 1RM.
Reps: 3-8 per set.
Sets: 4-6 per exercise.

Must include:
- Heavier loading progression week over week
- Reduced volume vs Hypertrophy to allow nervous system recovery
- Nutrition synchronization (nervous system support, sleep, hydration)

week_blocks example: [{"weeks": 3, "weight_pct": "75%"}, {"weeks": 3, "weight_pct": "82%"}, {"weeks": 3, "weight_pct": "88%"}]

---

## Nutrition Synchronization (MANDATORY - sync to every phase)

Nutrition must NEVER be generated in isolation. It reads the training phase and responds to it.

Phase 1 (Foundations):
- Focus: habits, hydration, protein consistency, digestion, education
- No aggressive deficit or surplus
- Priority: build sustainable eating patterns

Phase 2 (Hypertrophy):
- Focus: recovery, muscle growth support, higher carbohydrate intake, training support
- Slight caloric surplus or maintenance
- Priority: protein 1.6-2.2g/kg, carbs around training

Phase 3 (Strength):
- Focus: nervous system support, sleep quality, hydration, recovery
- Maintain protein, moderate carbs, avoid heavy restriction
- Priority: readiness and recovery

Testing / Retest sessions:
- High carbs the day before, normal protein, light meals day of test

Taper / Deload:
- Focus: recovery, peak readiness
- Maintain protein, reduce carbs slightly with lower training volume
- Priority: arrive fresh and recovered

Always use the LEAST restrictive strategy that moves the client forward.
Never prescribe aggressive caloric restriction unless Pedro specifically instructs.

---

## Core Coaching Philosophy (Non-Negotiable)

- Movement quality before load. Technique is always the first variable.
- Tempo before intensity. Clients must own the movement before adding weight.
- Full range of motion always prioritized.
- Longevity over ego lifting. Programme for a 10-year athlete, not a 10-week peak.
- Unilateral work included every week (single-leg, single-arm).
- Mobility year-round. Never skip it.
- Strength and flexibility developed together.
- Progression must be sustainable. No giant jumps in load or volume.
- Training supports the client's life and hobbies. Not the other way around.
- Connective tissue adapts slower than muscle. Respect that.

---

## Exercise Selection

- Prefer exercises from the supplied exercise library. Copy exercise_id, cues, and video_url exactly.
- Avoid exercises the client dislikes unless Pedro explicitly instructs reintroduction.
- Regress painful movements (use single-leg variation, reduced ROM, lighter load) instead of removing the pattern entirely.
- Every exercise needs 3-5 concise cues the client can use mid-session.
- Notes must include: tempo, range cue, or intent. One clear sentence.
- Include rest times. Match to goal: 60-90s hypertrophy, 2-4 min strength.

---

## Safety Rules

- Respect injuries, pain, pregnancy, post-surgery, medications, illness, travel, and schedule changes.
- For pain signals, substitute conservatively and note the reason in change_summary.
- Never give medical diagnosis. Programme around constraints. Leave judgement to Pedro.
- Do not claim the programme is final. Every output is a draft for Pedro to review.

---

## Programme Output Format

client.goals, client.notes, client.document_url content, and retrieved knowledge excerpts are all evidence.
Use them. Do not produce a generic programme that ignores the client's profile.

coaching_reasoning must include:
- Why this programme structure fits THIS client
- Movement priorities and injury precautions specific to THIS client
- How progression will unfold across the full arc

change_summary: one clear sentence explaining what was built and why.

phase_nutrition: one entry per phase. Sync it to training volume, intensity, and the client's adherence level.
