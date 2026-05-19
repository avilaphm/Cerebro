#!/usr/bin/env python3
"""
Add new exercises across 7 categories with full data + YouTube video.
Uses curl for Supabase HTTP calls and yt-dlp for video search (no API quota).
"""

import json
import subprocess
import sys
import time

SUPABASE_URL = "https://otcnrkfvgyvwolironoz.supabase.co"

# ---------------------------------------------------------------------------
# Exercise definitions — all 7 categories
# ---------------------------------------------------------------------------

EXERCISES = [

  # ── DUMBBELL ──────────────────────────────────────────────────────────────

  { "name": "Single Arm Dumbbell Row",
    "primary_muscles": ["Lats", "Upper Back"], "secondary_muscles": ["Biceps", "Rear Deltoid", "Core"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Unilateral pulling movement for lat and upper back thickness with anti-rotation core demand",
    "conditions": ["Avoid if acute low back pain", "Use neutral grip for shoulder impingement"],
    "setup_cues": ["Brace one hand and same-side knee on bench", "Back flat and parallel to floor", "Hold dumbbell directly below shoulder", "Brace core and lock hips square"],
    "cues": ["Drive elbow back toward hip", "Squeeze shoulder blade at top", "Lower under full control", "Keep hips square throughout", "No torso rotation"],
    "yt_query": "single arm dumbbell row form tutorial" },

  { "name": "Single Arm Dumbbell Overhead Press",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Triceps", "Core", "Traps"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Unilateral overhead press that exposes and corrects shoulder asymmetries",
    "conditions": ["Avoid with shoulder impingement or rotator cuff injury", "Reduce range if overhead mobility limited"],
    "setup_cues": ["Sit or stand with dumbbell at shoulder height", "Elbow at 90 degrees, palm forward", "Core braced, ribs down", "Feet shoulder-width, stable base"],
    "cues": ["Press directly overhead in a slight arc", "Fully extend without locking elbow", "Lower under control to start", "Avoid lateral lean", "Breathe out on press"],
    "yt_query": "single arm dumbbell overhead press tutorial" },

  { "name": "Dumbbell Romanian Deadlift",
    "primary_muscles": ["Hamstrings", "Glutes"], "secondary_muscles": ["Lower Back", "Core", "Traps"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Hip hinge pattern with dumbbells to develop hamstring length and posterior chain strength",
    "conditions": ["Avoid with acute lower back pain", "Limit range of motion if hamstrings are very tight"],
    "setup_cues": ["Stand hip-width, dumbbells in front of thighs", "Soft bend in knees, chest tall", "Shoulder blades pulled back", "Core engaged"],
    "cues": ["Push hips back, not down", "Lower dumbbells along legs", "Feel hamstring stretch at bottom", "Drive hips forward to stand", "Squeeze glutes at top"],
    "yt_query": "dumbbell romanian deadlift tutorial form" },

  { "name": "Dumbbell Deadlift",
    "primary_muscles": ["Glutes", "Hamstrings", "Lower Back"], "secondary_muscles": ["Quadriceps", "Core", "Traps"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Full deadlift pattern with dumbbells — accessible entry point for posterior chain development",
    "conditions": ["Avoid with acute back pain", "Keep spine neutral throughout"],
    "setup_cues": ["Dumbbells beside shins, feet hip-width", "Hinge at hips, grip dumbbells", "Chest up, back flat", "Arms straight, core braced"],
    "cues": ["Push floor away to stand", "Keep dumbbells close to body", "Lock hips and knees at the same time", "Hinge back down under control", "Breathe in before each rep"],
    "yt_query": "dumbbell deadlift form tutorial" },

  { "name": "Dumbbell Forward Lunge",
    "primary_muscles": ["Quadriceps", "Glutes"], "secondary_muscles": ["Hamstrings", "Core", "Calves"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Loaded forward lunge for single-leg strength, balance, and hip mobility",
    "conditions": ["Avoid if knee pain at front", "Reduce stride if hip flexor tight"],
    "setup_cues": ["Stand tall, dumbbell in each hand", "Core braced, chest up", "Feet hip-width to start"],
    "cues": ["Step forward, lower back knee toward floor", "Front shin vertical, knee tracking toes", "Drive through front heel to return", "Alternate legs each rep", "Stay tall, avoid forward lean"],
    "yt_query": "dumbbell forward lunge tutorial form" },

  { "name": "Dumbbell Sumo Deadlift",
    "primary_muscles": ["Glutes", "Inner Thighs", "Hamstrings"], "secondary_muscles": ["Quadriceps", "Lower Back", "Core"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Wide-stance deadlift variation that increases glute and adductor recruitment",
    "conditions": ["Avoid with hip impingement", "Ensure hip external rotation mobility first"],
    "setup_cues": ["Feet wider than shoulder-width, toes pointed out", "Dumbbell held vertically between legs", "Chest up, hips loaded back", "Knees tracking over toes"],
    "cues": ["Push knees out as you drive up", "Squeeze glutes at lockout", "Lower dumbbell under control", "Keep spine long", "Lead with chest on the way up"],
    "yt_query": "dumbbell sumo deadlift tutorial" },

  { "name": "Dumbbell Floor Press",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Triceps", "Shoulders"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Chest press from the floor that eliminates leg drive and shoulder stress at end range",
    "conditions": ["Good option for shoulder discomfort on bench press", "Reduces range of motion naturally"],
    "setup_cues": ["Lie on floor, knees bent, feet flat", "Dumbbells at chest height, elbows on floor", "Upper arms at roughly 45 degrees to torso", "Brace core"],
    "cues": ["Press dumbbells up and slightly in", "Full extension without locking elbows", "Lower until elbows touch floor", "Pause briefly at bottom", "Keep shoulder blades pinched"],
    "yt_query": "dumbbell floor press tutorial" },

  { "name": "Incline Dumbbell Fly",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Shoulders", "Biceps"],
    "equipment": "dumbbells", "tags": ["strength-isolation"],
    "purpose": "Incline fly variation for upper chest development with a deep stretch",
    "conditions": ["Avoid with shoulder impingement", "Use lighter weight — joint under stress at stretch"],
    "setup_cues": ["Set bench to 30-45 degrees", "Lie back, dumbbells above chest, slight elbow bend", "Shoulder blades retracted and depressed", "Feet flat on floor"],
    "cues": ["Arc dumbbells out and down in a wide arc", "Feel stretch across upper chest", "Squeeze chest to bring dumbbells back up", "Maintain slight elbow bend throughout", "Control the descent"],
    "yt_query": "incline dumbbell fly tutorial form" },

  { "name": "Decline Dumbbell Press",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Triceps", "Shoulders"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Decline angle shifts emphasis to the lower chest fibres",
    "conditions": ["Avoid with lower back pain", "Secure feet firmly in decline"],
    "setup_cues": ["Set bench to 15-30 degree decline", "Lock feet under pad, lie back with dumbbells", "Lower chest as starting position", "Elbows at 45-75 degrees from torso"],
    "cues": ["Press dumbbells up and slightly together", "Full extension at top", "Lower to chest level under control", "Keep wrists stacked over elbows", "Drive through the chest not shoulders"],
    "yt_query": "decline dumbbell press tutorial" },

  { "name": "Dumbbell Power Clean",
    "primary_muscles": ["Glutes", "Hamstrings", "Traps"], "secondary_muscles": ["Shoulders", "Core", "Quadriceps"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Explosive triple extension movement for power development with dumbbells",
    "conditions": ["Master hip hinge before loading", "Not suitable for beginners without coaching"],
    "setup_cues": ["Feet hip-width, dumbbells in front of thighs", "Hip hinge position, back flat", "Arms relaxed, chest up", "Eyes forward"],
    "cues": ["Explosive hip extension first", "Shrug as hips extend", "Pull dumbbells up close to body", "Rotate elbows under at shoulder height", "Soft catch with knees bent"],
    "yt_query": "dumbbell power clean tutorial" },

  { "name": "Dumbbell Step Up",
    "primary_muscles": ["Quadriceps", "Glutes"], "secondary_muscles": ["Hamstrings", "Core", "Calves"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Unilateral lower body strength and balance with minimal equipment",
    "conditions": ["Reduce box height if knee pain", "Avoid with acute knee injury"],
    "setup_cues": ["Stand facing box or step", "Hold dumbbells at sides", "Foot fully on box, not just heel", "Core engaged"],
    "cues": ["Drive through the heel on the box", "Step up without pushing off the back foot", "Bring trail leg up to stand", "Lower back leg under control", "Keep torso upright"],
    "yt_query": "dumbbell step up tutorial form" },

  { "name": "Dumbbell Calf Raise",
    "primary_muscles": ["Calves"], "secondary_muscles": ["Soleus"],
    "equipment": "dumbbells", "tags": ["strength-isolation"],
    "purpose": "Loaded calf raise for gastrocnemius and soleus development",
    "conditions": ["Achilles tendon pain — reduce range", "Can elevate toes for deeper stretch"],
    "setup_cues": ["Stand on edge of step or flat, one dumbbell in each hand", "Ball of foot on edge for full range", "Stand tall, core light"],
    "cues": ["Rise onto toes as high as possible", "Pause and squeeze at top", "Lower heel below step for full stretch", "Control the descent", "Move through full range each rep"],
    "yt_query": "dumbbell calf raise tutorial" },

  { "name": "Dumbbell Overhead Squat",
    "primary_muscles": ["Quadriceps", "Glutes"], "secondary_muscles": ["Shoulders", "Core", "Upper Back"],
    "equipment": "dumbbells", "tags": ["strength-compound", "mobility"],
    "purpose": "Full body stability and mobility challenge — squat pattern with arms locked overhead",
    "conditions": ["Requires good shoulder and thoracic mobility", "Master bodyweight overhead squat first"],
    "setup_cues": ["Press dumbbells overhead, arms fully extended", "Feet shoulder-width, toes slightly out", "Lock ribcage down", "Active shoulders pressing up"],
    "cues": ["Squat down keeping arms vertical", "Chest up, knees track toes", "Drive hips through to stand", "Keep arms locked out throughout", "Think 'push the ceiling' the whole time"],
    "yt_query": "dumbbell overhead squat tutorial" },

  { "name": "Dumbbell Single Leg Romanian Deadlift",
    "primary_muscles": ["Hamstrings", "Glutes"], "secondary_muscles": ["Lower Back", "Core", "Hip Flexors"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Unilateral hip hinge for single-leg hamstring strength, balance, and pelvic stability",
    "conditions": ["Avoid with inner ear or balance issues without support", "Lower back pain — reduce range"],
    "setup_cues": ["Stand on one leg, soft knee", "Hold dumbbells in front of thighs", "Hip hinge position with free leg floating back", "Spine long"],
    "cues": ["Hinge forward, free leg rises behind as counterbalance", "Lower dumbbells along standing leg", "Feel hamstring stretch at bottom", "Drive hip forward to stand", "Keep hips square — don't open"],
    "yt_query": "single leg dumbbell romanian deadlift tutorial" },

  { "name": "Dumbbell Chest Supported Row",
    "primary_muscles": ["Upper Back", "Lats"], "secondary_muscles": ["Biceps", "Rear Deltoid"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Chest-supported row removes lower back load for strict upper back isolation",
    "conditions": ["Preferred option for lower back pain", "Good for hypertrophy focus"],
    "setup_cues": ["Set incline bench to 45 degrees", "Lie face down with chest on pad", "Dumbbells hanging below", "Retract shoulder blades to start"],
    "cues": ["Row dumbbells to lower chest / hips", "Lead with elbows, not hands", "Squeeze shoulder blades together at top", "Lower all the way down", "Keep forehead on bench"],
    "yt_query": "chest supported dumbbell row tutorial" },

  { "name": "Dumbbell Swing",
    "primary_muscles": ["Glutes", "Hamstrings"], "secondary_muscles": ["Core", "Shoulders", "Lower Back"],
    "equipment": "dumbbells", "tags": ["strength-compound", "cardio"],
    "purpose": "Explosive hip hinge drill using a dumbbell when a kettlebell is unavailable",
    "conditions": ["Not suitable with acute lower back pain", "Master hip hinge pattern first"],
    "setup_cues": ["Feet shoulder-width, dumbbell held vertically at chest", "Hip hinge back, dumbbell swings back between legs", "Spine neutral, weight in heels", "Core braced"],
    "cues": ["Explosive hip snap forward", "Squeeze glutes hard at top", "Let momentum swing dumbbell to chest height", "Hinge back as dumbbell falls", "This is a hip drive, not a squat"],
    "yt_query": "dumbbell swing exercise tutorial" },

  { "name": "Dumbbell Close Grip Press",
    "primary_muscles": ["Triceps", "Chest"], "secondary_muscles": ["Shoulders"],
    "equipment": "dumbbells", "tags": ["strength-compound"],
    "purpose": "Neutral grip pressing variation with strong tricep emphasis",
    "conditions": ["Easier on wrists and elbows than barbell close grip", "Good option for elbow pain"],
    "setup_cues": ["Lie on bench, dumbbells touching above chest", "Neutral grip (palms facing each other)", "Elbows close to torso", "Shoulder blades pinched"],
    "cues": ["Press up keeping dumbbells touching", "Elbows stay close to sides", "Full extension at top", "Lower slowly under control", "Feel triceps working throughout"],
    "yt_query": "dumbbell close grip press tricep tutorial" },

  # ── SINGLE ARM ────────────────────────────────────────────────────────────

  { "name": "Single Arm Cable Fly",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Shoulders", "Biceps"],
    "equipment": "cable machine", "tags": ["strength-isolation"],
    "purpose": "Unilateral cable fly with constant tension across full range of motion",
    "conditions": ["Avoid with shoulder impingement at end range", "Lighter loads, focus on stretch"],
    "setup_cues": ["Set cable to chest height", "Step forward, staggered stance", "Hold handle, palm up or neutral", "Opposite arm extended or on hip"],
    "cues": ["Arc handle across body in a wide sweep", "Lead with elbow slightly bent", "Squeeze chest at full crossover", "Control return to start", "Keep shoulder down throughout"],
    "yt_query": "single arm cable fly tutorial" },

  { "name": "Single Arm Cable Row",
    "primary_muscles": ["Lats", "Upper Back"], "secondary_muscles": ["Biceps", "Core", "Rear Deltoid"],
    "equipment": "cable machine", "tags": ["strength-compound"],
    "purpose": "Unilateral cable row with strong anti-rotation demand on the core",
    "conditions": ["Avoid if acute lower back pain", "Light loads with full range"],
    "setup_cues": ["Set cable to chest or waist height", "Stand or kneel facing cable", "Hold handle, arm extended", "Staggered or square stance, core tight"],
    "cues": ["Row handle to hip/lower chest", "Drive elbow back past torso", "Squeeze shoulder blade at end", "Resist rotation on the return", "Lower under full control"],
    "yt_query": "single arm cable row tutorial" },

  { "name": "Single Arm Lat Pulldown",
    "primary_muscles": ["Lats"], "secondary_muscles": ["Biceps", "Upper Back", "Core"],
    "equipment": "cable machine", "tags": ["strength-compound"],
    "purpose": "Unilateral lat pulldown to address strength imbalances between sides",
    "conditions": ["Avoid gripping too tight if elbow pain", "Slightly lighter than bilateral version"],
    "setup_cues": ["Attach single handle to lat pulldown cable", "Sit, thighs under pad", "Reach overhead and grip handle", "Slight lean back"],
    "cues": ["Pull elbow down and back toward hip", "Squeeze lat at bottom", "Control the return overhead", "Full stretch at top each rep", "Keep opposite shoulder down"],
    "yt_query": "single arm lat pulldown tutorial" },

  { "name": "Single Arm Tricep Cable Extension",
    "primary_muscles": ["Triceps"], "secondary_muscles": [],
    "equipment": "cable machine", "tags": ["strength-isolation"],
    "purpose": "Unilateral cable pushdown for isolated tricep development and imbalance correction",
    "conditions": ["Elbow pain — reduce range or weight"],
    "setup_cues": ["Set cable overhead or high", "Hold handle, elbow tucked beside torso", "Upper arm vertical, not flared", "Slight forward lean"],
    "cues": ["Extend forearm until arm is straight", "Keep upper arm still", "Squeeze tricep at full extension", "Return slowly — don't let elbow flare", "Focus on full lockout"],
    "yt_query": "single arm tricep cable pushdown tutorial" },

  { "name": "Single Arm Overhead Tricep Extension",
    "primary_muscles": ["Triceps"], "secondary_muscles": ["Core"],
    "equipment": "dumbbells", "tags": ["strength-isolation"],
    "purpose": "Long head tricep isolation through full overhead stretch",
    "conditions": ["Shoulder mobility needed for overhead position", "Avoid with elbow impingement"],
    "setup_cues": ["Sit or stand, one dumbbell held overhead in one hand", "Elbow pointing to ceiling, upper arm vertical", "Support working arm at elbow with free hand if needed"],
    "cues": ["Lower dumbbell behind head by bending elbow", "Keep upper arm vertical and still", "Extend arm fully at top", "Squeeze tricep at lockout", "Control the lowering phase"],
    "yt_query": "single arm overhead tricep extension dumbbell tutorial" },

  { "name": "Single Arm Face Pull",
    "primary_muscles": ["Rear Deltoid", "Upper Back"], "secondary_muscles": ["Rotator Cuff", "Traps"],
    "equipment": "cable machine", "tags": ["strength-isolation"],
    "purpose": "Unilateral rear delt and external rotation work for shoulder health",
    "conditions": ["Good prehab for overhead athletes", "Light loads, high reps"],
    "setup_cues": ["Set cable to face height", "Hold handle with one hand, palm down", "Step back to create tension", "Elbow at shoulder height to start"],
    "cues": ["Pull handle to side of face", "Externally rotate — thumb back, elbow high", "Squeeze rear delt at end range", "Control return", "Keep elbow at or above shoulder"],
    "yt_query": "single arm face pull cable tutorial" },

  { "name": "Single Arm Farmers Carry",
    "primary_muscles": ["Core", "Traps"], "secondary_muscles": ["Forearms", "Glutes", "Lower Back"],
    "equipment": "dumbbells", "tags": ["strength-compound", "core"],
    "purpose": "Offset loading that creates massive anti-lateral-flexion core demand plus grip strength",
    "conditions": ["Low back pain — reduce load", "Scoliosis — monitor carefully"],
    "setup_cues": ["Hold heavy dumbbell in one hand at side", "Stand tall, shoulders level", "Core braced hard", "Walk a set distance or time"],
    "cues": ["Resist side-bending toward the weight", "Keep opposite shoulder from hiking", "Breathe steadily", "Maintain tall posture", "Grip tight throughout"],
    "yt_query": "single arm farmers carry tutorial" },

  { "name": "Single Arm Kettlebell Press",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Triceps", "Core", "Traps"],
    "equipment": "kettlebell", "tags": ["strength-compound"],
    "purpose": "Clean and press pattern with a kettlebell for shoulder and core stability",
    "conditions": ["Wrist position differs from dumbbell — teach the rack position first"],
    "setup_cues": ["Clean kettlebell to rack position — bell resting on forearm", "Elbow at ribs, wrist straight", "Core braced, glutes tight", "Feet hip-width"],
    "cues": ["Press straight up", "Externally rotate at lockout — bicep by ear", "Lower back to rack under control", "Keep ribs down throughout", "Don't lean back to press"],
    "yt_query": "single arm kettlebell press tutorial" },

  # ── SINGLE LEG ────────────────────────────────────────────────────────────

  { "name": "Single Leg Hip Thrust",
    "primary_muscles": ["Glutes"], "secondary_muscles": ["Hamstrings", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Unilateral glute bridge from bench elevation for maximum glute isolation per side",
    "conditions": ["Avoid with knee pain at extreme flexion", "Reduce range if hip flexor tight"],
    "setup_cues": ["Upper back on bench, one foot flat on floor", "Free leg extended or knee to chest", "Hips dropped toward floor to start", "Core braced"],
    "cues": ["Drive through heel to extend hip", "Squeeze glute hard at top", "Hips and shoulders rise together", "Pause at full extension", "Lower slowly — feel the glute working"],
    "yt_query": "single leg hip thrust tutorial" },

  { "name": "Single Leg Box Jump",
    "primary_muscles": ["Glutes", "Quadriceps"], "secondary_muscles": ["Calves", "Core", "Hamstrings"],
    "equipment": "bodyweight", "tags": ["strength-compound", "cardio"],
    "purpose": "Explosive unilateral power development and landing mechanics",
    "conditions": ["Master bilateral box jump first", "Not for beginners or those with knee pain"],
    "setup_cues": ["Stand on one leg in front of box", "Slight forward lean, hip loaded", "Arms ready to swing", "Focus on the target"],
    "cues": ["Load hip by hinging slightly", "Swing arms and drive off one leg", "Land softly on both feet on box", "Absorb landing with bent knees", "Step down — don't jump down"],
    "yt_query": "single leg box jump tutorial" },

  { "name": "Single Leg Calf Raise",
    "primary_muscles": ["Calves"], "secondary_muscles": ["Soleus"],
    "equipment": "bodyweight", "tags": ["strength-isolation"],
    "purpose": "Unilateral calf strength and rehabilitation exercise essential for running and jumping",
    "conditions": ["Achilles tendinopathy rehab — start slow", "Can progress to loaded single leg raises"],
    "setup_cues": ["Stand on edge of step on one foot", "Hold light support if needed", "Ball of foot on edge, heel hanging"],
    "cues": ["Rise as high as possible on toes", "Squeeze calf at top", "Lower heel slowly below step level", "Full range each rep", "3-second lower is ideal"],
    "yt_query": "single leg calf raise tutorial" },

  { "name": "Single Leg Step Up",
    "primary_muscles": ["Quadriceps", "Glutes"], "secondary_muscles": ["Hamstrings", "Core", "Calves"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Bodyweight step up emphasising strict single-leg drive without momentum",
    "conditions": ["Reduce box height for knee pain", "Keep step height so knee stays below hip at bottom"],
    "setup_cues": ["Stand facing box", "Place one foot fully on box", "Hands on hips or at sides", "Don't push off the back foot"],
    "cues": ["Squeeze glute on working leg", "Drive through heel on box", "Bring trail leg up to standing", "Lower slowly on same leg", "Control the entire descent"],
    "yt_query": "single leg step up bodyweight tutorial" },

  { "name": "Single Leg Wall Sit",
    "primary_muscles": ["Quadriceps"], "secondary_muscles": ["Glutes", "Core"],
    "equipment": "bodyweight", "tags": ["strength-isolation"],
    "purpose": "Isometric quad endurance challenge — unilateral variation of wall sit",
    "conditions": ["Avoid with anterior knee pain", "Reduce to 90 degrees if painful"],
    "setup_cues": ["Back flat against wall, thighs parallel to floor", "One leg extended forward", "Both hands off wall", "Chin up, chest tall"],
    "cues": ["Hold position with active glute squeeze", "Keep extended leg straight", "Breathe steadily", "Drive back into wall", "Aim for 30-60 second holds"],
    "yt_query": "single leg wall sit tutorial" },

  { "name": "Single Leg Squat to Box",
    "primary_muscles": ["Quadriceps", "Glutes"], "secondary_muscles": ["Hamstrings", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Controlled single-leg squat to a target — builds toward pistol squat with depth control",
    "conditions": ["Use higher box first", "Knee pain — monitor valgus carefully"],
    "setup_cues": ["Stand on one leg in front of box or bench", "Arms forward for counterbalance", "Chest tall, core engaged"],
    "cues": ["Sit back and down to touch box", "Knee tracks over toes", "Touch lightly — don't fully sit", "Drive through heel to stand", "Resist knee caving in"],
    "yt_query": "single leg squat to box tutorial" },

  # ── MOBILITY ──────────────────────────────────────────────────────────────

  { "name": "Wrist CARs",
    "primary_muscles": ["Forearms"], "secondary_muscles": [],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Controlled articular rotations of the wrist to maintain joint health and range",
    "conditions": ["Wrist injuries — go slow and pain-free", "Common for lifters with wrist tightness"],
    "setup_cues": ["Seated or standing", "One arm extended, fist closed", "Other hand stabilises forearm if needed"],
    "cues": ["Slowly rotate wrist through full circle", "Move to end range in all directions", "Pause at each extreme", "3-5 circles each direction", "No pain — this is controlled movement"],
    "yt_query": "wrist CARs controlled articular rotations tutorial" },

  { "name": "Ankle CARs",
    "primary_muscles": ["Calves"], "secondary_muscles": ["Tibialis Anterior", "Peroneals"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Ankle joint circles to maintain full range of motion and joint health",
    "conditions": ["Post-ankle sprain — work within pain-free range", "Essential for runners and squatters"],
    "setup_cues": ["Seated or lying, one leg extended", "Lift foot off floor", "Keep knee and shin still"],
    "cues": ["Rotate foot through full circle — inversion, plantarflexion, eversion, dorsiflexion", "Make the circle as big as possible", "5 circles each direction each ankle", "Keep knee absolutely still", "Slow and controlled"],
    "yt_query": "ankle CARs controlled articular rotations tutorial" },

  { "name": "Neck CARs",
    "primary_muscles": ["Neck"], "secondary_muscles": ["Upper Traps"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Full neck rotation to maintain cervical spine mobility and reduce tension",
    "conditions": ["Cervical disc issues — avoid end range", "Do slowly — no pain or dizziness"],
    "setup_cues": ["Seated or standing, tall spine", "Shoulders relaxed and down", "Eyes forward to start"],
    "cues": ["Lower chin to chest", "Rotate head left, then tilt ear to shoulder", "Continue rotating back", "Full circle in one direction then reverse", "Slow and deliberate"],
    "yt_query": "neck CARs cervical spine mobility tutorial" },

  { "name": "Quadruped Hip Circle",
    "primary_muscles": ["Glutes", "Hip Flexors"], "secondary_muscles": ["Core"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Hip joint controlled articular rotation in quadruped for hip health and range",
    "conditions": ["Knee pain on ground — use a pad", "Great for sedentary individuals"],
    "setup_cues": ["On hands and knees, neutral spine", "Wrists under shoulders, knees under hips", "Core light, not too rigid"],
    "cues": ["Lift one knee and draw a big circle with it", "Take hip to end range in each direction", "Keep pelvis as still as possible", "5 circles each direction", "Slow — feel the hip joint"],
    "yt_query": "quadruped hip circle mobility tutorial" },

  { "name": "Prone Scorpion",
    "primary_muscles": ["Hip Flexors", "Lower Back"], "secondary_muscles": ["Glutes", "Thoracic Spine"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Dynamic thoracic and hip rotation stretch performed prone",
    "conditions": ["Lower back pain — use gentle range only", "Stop if sharp pain in back"],
    "setup_cues": ["Lie face down, arms outstretched at shoulder height", "Legs straight, feet relaxed", "Head rested on one side or face down"],
    "cues": ["Bend one knee and rotate that leg up and over to opposite side", "Let hip and lower back rotate with it", "Feel the stretch through the front of the hip", "Return and repeat other side", "Keep shoulders down"],
    "yt_query": "prone scorpion mobility stretch tutorial" },

  { "name": "Supine Scorpion",
    "primary_muscles": ["Thoracic Spine", "Hip Flexors"], "secondary_muscles": ["Lower Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Rotational thoracic mobility from supine position — gentler than prone version",
    "conditions": ["Back pain — work within pain-free range", "Good for office workers with thoracic stiffness"],
    "setup_cues": ["Lie on back, arms spread wide", "Legs straight or knees bent", "Relaxed starting position"],
    "cues": ["Take one leg over the body and reach for opposite side", "Let the spine rotate", "Opposite shoulder stays down", "Hold at end range for 2-3 seconds", "Return and alternate"],
    "yt_query": "supine scorpion stretch mobility tutorial" },

  { "name": "90-90 Hip Shift",
    "primary_muscles": ["Hip Flexors", "Glutes"], "secondary_muscles": ["Core", "Adductors"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Hip internal and external rotation drill — develops multi-directional hip mobility",
    "conditions": ["Knee pain — sit on a pillow", "Hip impingement — work within pain-free range"],
    "setup_cues": ["Sit on floor, both hips at 90 degrees — front and back leg", "Sit tall, spine long", "Both shins on floor"],
    "cues": ["Rotate hips to switch to other side 90-90", "Keep chest tall throughout", "Aim to keep both sit bones down", "Slow rotation — don't flop", "Progress to internal rotation hold"],
    "yt_query": "90-90 hip shift mobility tutorial" },

  { "name": "Serratus Wall Slide",
    "primary_muscles": ["Serratus Anterior"], "secondary_muscles": ["Shoulders", "Upper Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Serratus activation and shoulder blade upward rotation for overhead health",
    "conditions": ["Shoulder impingement — essential prehab", "Winged scapula — key rehab drill"],
    "setup_cues": ["Stand facing wall, forearms on wall", "Elbows at shoulder height, bent 90 degrees", "Light abdominal brace"],
    "cues": ["Slide forearms up the wall", "Push shoulder blades apart (protract)", "Reach as high as comfortable", "Slide down under control", "Serratus is active when shoulder blades spread"],
    "yt_query": "serratus wall slide exercise tutorial" },

  { "name": "Thoracic Bridge",
    "primary_muscles": ["Thoracic Spine", "Shoulders"], "secondary_muscles": ["Glutes", "Core", "Hip Flexors"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Full body mobility drill combining hip extension and thoracic rotation",
    "conditions": ["Wrist pain — make fists or use fingertips", "Not for beginners — requires body control"],
    "setup_cues": ["Seated with hands behind, fingers pointing away", "Knees bent, feet flat", "Lean back onto hands to start"],
    "cues": ["Press hips to ceiling while rotating one arm over", "Follow hand with eyes", "Reach as far as comfortable", "Return hips down and bring arm back", "Alternate sides"],
    "yt_query": "thoracic bridge mobility tutorial" },

  { "name": "Side Lying Hip CAR",
    "primary_muscles": ["Glutes", "Hip Flexors"], "secondary_muscles": ["Core"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Hip controlled articular rotation in side-lying to maintain hip joint integrity",
    "conditions": ["Hip replacement — check clearance", "Reduce range if painful"],
    "setup_cues": ["Lie on side, bottom leg slightly bent for stability", "Hips stacked on top of each other", "Top leg straight"],
    "cues": ["Lift top leg and make a large slow circle", "Reach full range in flexion, abduction, extension, adduction", "Keep pelvis still — don't compensate", "5 circles each direction", "Think of painting a circle on the ceiling"],
    "yt_query": "side lying hip CAR controlled articular rotation" },

  { "name": "Adductor Rockback",
    "primary_muscles": ["Inner Thighs"], "secondary_muscles": ["Hip Flexors", "Core"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Groin mobility drill in quadruped — targets inner thigh in a functional position",
    "conditions": ["Groin strain — work pain-free range only"],
    "setup_cues": ["On hands and knees, take one leg wide to the side", "Wide knee straight out, foot flat", "Spine neutral, core light"],
    "cues": ["Rock hips back toward the wide leg", "Feel inner thigh stretch", "Hold 2-3 seconds at end range", "Rock forward and repeat", "Keep back flat — no rounding"],
    "yt_query": "adductor rockback mobility drill tutorial" },

  { "name": "Hip Flexor Rockback",
    "primary_muscles": ["Hip Flexors"], "secondary_muscles": ["Quadriceps", "Lower Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Dynamic hip flexor mobilisation in quadruped for anterior hip tightness",
    "conditions": ["Lower back pain — keep neutral spine", "Common for desk workers"],
    "setup_cues": ["On hands and knees, neutral spine", "Wrists under shoulders, knees under hips"],
    "cues": ["Shift hips back toward heels", "Feel the stretch through the front of the hip", "Hold 2 seconds", "Return to start", "Keep lumbar spine neutral — don't flex"],
    "yt_query": "hip flexor rockback mobility drill" },

  { "name": "Prone Y-T-W",
    "primary_muscles": ["Lower Traps", "Rear Deltoid", "Rhomboids"], "secondary_muscles": ["Rotator Cuff", "Upper Back"],
    "equipment": "bodyweight", "tags": ["mobility", "strength-isolation"],
    "purpose": "Scapular stability and posterior shoulder strength — key for posture and overhead health",
    "conditions": ["Essential for rounded shoulders", "Do this before pressing workouts"],
    "setup_cues": ["Lie face down on bench or floor", "Thumbs up on each position", "Forehead or chin lightly resting"],
    "cues": ["Y: arms at 45 degrees overhead, lift off floor", "T: arms straight out to side, lift", "W: elbows bent, pull back and rotate arms up", "Hold each for 2 seconds", "Squeeze shoulder blades the entire time"],
    "yt_query": "prone Y T W exercise tutorial" },

  { "name": "Jefferson Curl",
    "primary_muscles": ["Hamstrings", "Lower Back"], "secondary_muscles": ["Glutes", "Core"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Weighted spinal flexion drill for active hamstring and spine mobility",
    "conditions": ["Avoid with disc herniation", "Very light load only — not a strength exercise"],
    "setup_cues": ["Stand on step or box, light weight in hands or bodyweight", "Begin standing tall"],
    "cues": ["Tuck chin to chest", "Curl down vertebra by vertebra", "Allow hamstrings to lengthen", "Pause at bottom — feel the full stretch", "Uncurl back up slowly from tailbone"],
    "yt_query": "jefferson curl mobility tutorial" },

  # ── FLEXIBILITY ───────────────────────────────────────────────────────────

  { "name": "Frog Stretch",
    "primary_muscles": ["Inner Thighs", "Hip Flexors"], "secondary_muscles": ["Glutes"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Deep groin and adductor stretch in a supported wide-knee position",
    "conditions": ["Knee pain — use more padding", "Hip impingement — reduce range"],
    "setup_cues": ["On hands and knees, knees as wide as comfortable", "Feet in line with knees, toes out", "Hips sink toward floor"],
    "cues": ["Push hips back and down", "Feel inner thigh and groin opening", "Hold for 30-60 seconds", "Breathe deeply into the stretch", "Progress by widening knees slowly"],
    "yt_query": "frog stretch groin flexibility tutorial" },

  { "name": "Lizard Pose",
    "primary_muscles": ["Hip Flexors", "Glutes"], "secondary_muscles": ["Inner Thighs", "Lower Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Deep hip flexor and groin stretch in a low lunge — yoga-based, highly effective",
    "conditions": ["Knee pain — use a pad under back knee", "Progress slowly into depth"],
    "setup_cues": ["Low lunge position — front foot outside of front hand", "Back knee down on floor", "Both hands inside front foot on floor", "Chest up or drop forearms to floor"],
    "cues": ["Sink hip toward floor", "Front knee tracks toes", "Feel deep hip flexor of back leg", "Hold 30-60 seconds", "Breathe — let body relax into it"],
    "yt_query": "lizard pose hip flexor stretch tutorial" },

  { "name": "Couch Stretch",
    "primary_muscles": ["Hip Flexors", "Quadriceps"], "secondary_muscles": ["Lower Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Highly effective quad and hip flexor stretch using a wall or couch — deep front body opener",
    "conditions": ["Knee pain — use padding", "Start with foot lower on wall"],
    "setup_cues": ["Kneel with back shin against wall or couch", "Front foot forward in lunge", "Upright torso or lean forward"],
    "cues": ["Squeeze glute of back leg hard", "Tuck pelvis slightly under", "Feel deep quad and hip flexor stretch", "Hold 60-120 seconds each side", "Don't arch lower back"],
    "yt_query": "couch stretch hip flexor quad stretch tutorial" },

  { "name": "Downward Dog",
    "primary_muscles": ["Hamstrings", "Calves"], "secondary_muscles": ["Shoulders", "Lats", "Thoracic Spine"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Full posterior chain lengthening and shoulder mobility stretch",
    "conditions": ["Wrist pain — do on fists or forearms", "Tight hamstrings — keep knees bent"],
    "setup_cues": ["Hands shoulder-width on floor, fingers spread", "Feet hip-width", "Hips high, form an inverted V", "Heels reaching toward floor"],
    "cues": ["Push floor away with hands", "Lengthen spine toward tailbone", "Alternate pedalling heels", "Hold 30-60 seconds", "Keep ears between arms — not dropped"],
    "yt_query": "downward dog yoga stretch tutorial" },

  { "name": "Upward Dog",
    "primary_muscles": ["Chest", "Hip Flexors", "Abs"], "secondary_muscles": ["Shoulders", "Lower Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Front body opener — chest, hip flexors and abdominal stretch",
    "conditions": ["Lower back pain — use Cobra variation instead", "Wrist issues — come onto fingertips"],
    "setup_cues": ["Lie face down, hands beside lower ribs", "Tops of feet on floor", "Elbows fully extend to lift chest"],
    "cues": ["Press through hands, lift chest and thighs off floor", "Roll over toes so tops of feet are down", "Open chest and look forward or slightly up", "Hold 20-30 seconds", "Keep glutes relaxed"],
    "yt_query": "upward dog yoga stretch tutorial" },

  { "name": "Warrior I Stretch",
    "primary_muscles": ["Hip Flexors", "Chest"], "secondary_muscles": ["Calves", "Shoulders"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Standing lunge with arms overhead — combines hip flexor stretch with thoracic extension",
    "conditions": ["Balance issues — use wall support", "Tight shoulders — hands on hips instead"],
    "setup_cues": ["Step one foot forward into lunge", "Back foot at 45-90 degrees, heel down", "Hips square to front", "Arms overhead or hands on hips"],
    "cues": ["Sink front hip and knee into lunge", "Square both hips to front", "Reach arms up and open chest", "Feel hip flexor of back leg", "Hold 30 seconds each side"],
    "yt_query": "warrior 1 yoga hip flexor stretch tutorial" },

  { "name": "Seated Butterfly Stretch",
    "primary_muscles": ["Inner Thighs", "Glutes"], "secondary_muscles": ["Lower Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Inner thigh and groin opener in a seated position — great for pre- or post-session",
    "conditions": ["Hip impingement — keep feet further from body", "Back pain — sit on cushion"],
    "setup_cues": ["Sit tall on floor", "Soles of feet pressed together", "Knees fall out to sides", "Hands on feet or ankles"],
    "cues": ["Sit tall — don't round lower back", "Let knees drop toward floor", "Gentle pressure on inner thighs with elbows if needed", "Hold 30-60 seconds", "Breathe out and let go"],
    "yt_query": "butterfly stretch inner thigh groin tutorial" },

  { "name": "Seated Forward Fold",
    "primary_muscles": ["Hamstrings", "Lower Back"], "secondary_muscles": ["Calves"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Seated hamstring and lower back lengthening — accessible flexibility drill",
    "conditions": ["Lower back issues — slight knee bend allowed", "Keep spine long, not rounded"],
    "setup_cues": ["Sit on floor, legs straight ahead", "Feet flexed, hands on thighs", "Sit tall to start"],
    "cues": ["Hinge from hips — not round from back", "Walk hands forward toward feet", "Feel hamstring pull", "Hold 30-60 seconds", "Each exhale let body go further"],
    "yt_query": "seated forward fold hamstring stretch tutorial" },

  { "name": "Standing Forward Fold",
    "primary_muscles": ["Hamstrings", "Calves"], "secondary_muscles": ["Lower Back", "Glutes"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Standing posterior chain stretch — gravity-assisted hamstring and back release",
    "conditions": ["Back pain — keep soft bend in knees", "Dizziness — come up slowly"],
    "setup_cues": ["Stand feet hip-width, soft knees", "Hands at hips to start"],
    "cues": ["Hinge at hips and fold forward", "Let arms hang or hold elbows", "Shake out neck", "Hold 30-60 seconds", "Nod head gently to release neck tension"],
    "yt_query": "standing forward fold stretch hamstrings tutorial" },

  { "name": "Supine Knee to Chest",
    "primary_muscles": ["Lower Back", "Glutes"], "secondary_muscles": ["Hip Flexors"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Gentle lumbar decompression and glute stretch — great for lower back relief",
    "conditions": ["Lower back pain — excellent rehab drill", "Do first thing in the morning"],
    "setup_cues": ["Lie on back, legs straight", "Pull one or both knees to chest", "Relax shoulders and neck"],
    "cues": ["Hug knee(s) gently to chest", "Feel lower back softening", "Rock gently side to side if comfortable", "Hold 30-60 seconds", "Breathe into the lower back"],
    "yt_query": "knee to chest stretch lower back tutorial" },

  { "name": "Wall Hamstring Stretch",
    "primary_muscles": ["Hamstrings"], "secondary_muscles": ["Calves", "Lower Back"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Passive hamstring stretch using a wall for a comfortable sustained hold",
    "conditions": ["Back pain — keep small bend in knee", "Can be done lying next to a wall"],
    "setup_cues": ["Lie on back near a wall", "Extend one leg up the wall", "Other leg flat or bent on floor", "Hips close to wall"],
    "cues": ["Flex foot toward you to deepen stretch", "Relax and breathe", "Hold 60-120 seconds", "Move hips closer to wall to increase", "Keep lower back flat"],
    "yt_query": "wall hamstring stretch tutorial" },

  { "name": "Active Pigeon",
    "primary_muscles": ["Glutes", "Hip External Rotators"], "secondary_muscles": ["Hip Flexors"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Active version of pigeon pose — builds hip external rotation strength and flexibility",
    "conditions": ["Knee pain — use Figure Four stretch instead", "SI joint issues — be cautious"],
    "setup_cues": ["From tabletop, bring front shin parallel to front of mat", "Back leg extended behind", "Hands on floor either side of front knee"],
    "cues": ["Actively press shin into floor", "Square hips toward front", "Lift chest — don't collapse forward initially", "Then hinge forward to deepen", "Hold 60 seconds each side"],
    "yt_query": "pigeon pose hip stretch tutorial" },

  { "name": "Low Lunge Stretch",
    "primary_muscles": ["Hip Flexors", "Quadriceps"], "secondary_muscles": ["Glutes", "Calves"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Classic hip flexor opener in a kneeling lunge position",
    "conditions": ["Knee pain — use padding", "Use wall for balance if needed"],
    "setup_cues": ["Kneel on one knee, other foot forward", "Both knees at 90 degrees", "Hands on front thigh or floor"],
    "cues": ["Drive hips forward and down", "Feel front of back hip opening", "Keep torso upright", "Hold 30-60 seconds", "Add arms overhead to deepen thoracic extension"],
    "yt_query": "low lunge hip flexor stretch tutorial" },

  { "name": "Neck Flexor Stretch",
    "primary_muscles": ["Neck"], "secondary_muscles": ["Upper Traps"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Chin tuck and forward stretch to release neck flexors and reduce forward head posture",
    "conditions": ["Cervical disc issues — gentle only", "Common for desk workers and phone users"],
    "setup_cues": ["Sit or stand tall", "Chin tucked slightly", "Hands clasped lightly behind head"],
    "cues": ["Gently nod chin to chest", "Apply light pressure with hands", "Feel stretch at base of skull and upper neck", "Hold 20-30 seconds", "No pulling — gravity is enough"],
    "yt_query": "neck flexor stretch chin tuck tutorial" },

  { "name": "Tricep Stretch",
    "primary_muscles": ["Triceps"], "secondary_muscles": ["Shoulders"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Overhead tricep stretch for flexibility in the long head of the tricep",
    "conditions": ["Shoulder mobility limited — reduce depth"],
    "setup_cues": ["Stand or sit tall", "Raise one arm overhead and bend at elbow", "Hand drops behind head", "Other hand grasps elbow"],
    "cues": ["Gently pull elbow toward head and slightly back", "Feel stretch down back of upper arm", "Hold 20-30 seconds each side", "Keep head neutral", "Breathe and relax into it"],
    "yt_query": "overhead tricep stretch tutorial" },

  { "name": "Groin Stretch",
    "primary_muscles": ["Inner Thighs"], "secondary_muscles": ["Hip Flexors"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Lateral lunge based groin stretch for adductor flexibility",
    "conditions": ["Groin strain — reduce depth", "Sharp pain — stop"],
    "setup_cues": ["Stand wide, feet wider than shoulders", "Shift weight to one side, knee bent", "Other leg straight to the side", "Hands on bent knee or floor"],
    "cues": ["Sit into the bent knee side", "Feel stretch in straight leg inner thigh", "Hold 20-30 seconds each side", "Keep foot of straight leg flat or flex it up", "Progress by going lower"],
    "yt_query": "groin stretch adductor flexibility tutorial" },

  # ── BODYWEIGHT ────────────────────────────────────────────────────────────

  { "name": "Pike Push Up",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Triceps", "Upper Back"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Vertical pressing progression toward handstand push up — targets shoulders over chest",
    "conditions": ["Wrist pain — reduce range", "Shoulder impingement — not recommended"],
    "setup_cues": ["Start in downward dog position — inverted V", "Hands shoulder-width", "Hips high, body angled", "Chin tucked"],
    "cues": ["Bend elbows and lower head toward floor", "Elbows flare out to sides", "Lower until crown of head near floor", "Press back to starting V position", "Shoulders directly over hands"],
    "yt_query": "pike push up tutorial" },

  { "name": "Wide Push Up",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Shoulders", "Triceps"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Wider hand placement shifts emphasis to the outer chest fibres",
    "conditions": ["Shoulder pain — widen only slightly", "Elbow pain — revert to standard width"],
    "setup_cues": ["Hands wider than shoulder-width", "Fingers pointing slightly out", "Body in rigid plank", "Core and glutes engaged"],
    "cues": ["Lower chest to floor", "Elbows flare wide", "Press through palms to full extension", "No sagging hips", "Keep head neutral"],
    "yt_query": "wide push up chest exercise tutorial" },

  { "name": "Decline Push Up",
    "primary_muscles": ["Upper Chest", "Shoulders"], "secondary_muscles": ["Triceps", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Feet elevated push up that shifts load to upper chest and anterior deltoids",
    "conditions": ["Wrist pain — use push up handles", "Shoulder issues — check for impingement"],
    "setup_cues": ["Place feet on bench or box", "Hands on floor, shoulder-width", "Body in straight line from feet to head", "Core locked"],
    "cues": ["Lower chest toward floor", "Elbows at 45 degrees from torso", "Press to full extension", "Keep hips level", "Control both directions"],
    "yt_query": "decline push up upper chest tutorial" },

  { "name": "Archer Push Up",
    "primary_muscles": ["Chest", "Shoulders"], "secondary_muscles": ["Triceps", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Unilateral push up variation with strong single-side chest and shoulder demand",
    "conditions": ["Advanced — requires significant upper body strength", "Master standard push up first"],
    "setup_cues": ["Wide push up starting position", "One arm stays straight as you lower", "Load goes to the bent-arm side"],
    "cues": ["Shift body to one side as you lower", "Straight arm slides out to the side", "Working arm does the pressing", "Return to centre", "Alternate sides"],
    "yt_query": "archer push up tutorial" },

  { "name": "Inverted Row",
    "primary_muscles": ["Upper Back", "Lats"], "secondary_muscles": ["Biceps", "Core", "Rear Deltoid"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Horizontal pulling bodyweight exercise — great row progression before weighted pulling",
    "conditions": ["Easy to scale by changing body angle", "Good option if pull up not achievable yet"],
    "setup_cues": ["Set bar at waist height in rack", "Lie under bar, grip overhand shoulder-width", "Body in plank — heels on floor", "Arms fully extended to start"],
    "cues": ["Pull chest to bar", "Lead with elbows, squeeze shoulder blades", "Keep body rigid — no hip drop", "Lower with control", "Feet on box to increase difficulty"],
    "yt_query": "inverted row bodyweight tutorial" },

  { "name": "Australian Pull Up",
    "primary_muscles": ["Lats", "Upper Back"], "secondary_muscles": ["Biceps", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Underhand inverted row variation for bicep and lat emphasis — pull up progression",
    "conditions": ["Easier than a full pull up", "Great for beginners or high reps"],
    "setup_cues": ["Bar set at hip height, underhand grip", "Heels on floor, body angled under bar", "Arms extended to start", "Keep body straight"],
    "cues": ["Pull chest to bar with supinated grip", "Elbows travel beside body", "Squeeze at the top", "Lower slowly", "The steeper the angle, the easier"],
    "yt_query": "australian pull up bodyweight row tutorial" },

  { "name": "Superman Hold",
    "primary_muscles": ["Lower Back", "Glutes"], "secondary_muscles": ["Upper Back", "Hamstrings"],
    "equipment": "bodyweight", "tags": ["strength-isolation", "core"],
    "purpose": "Posterior chain isometric activation — basic but effective for lower back endurance",
    "conditions": ["Lower back pain — gentle start, reduce hold time", "Good for lumbar rehabilitation"],
    "setup_cues": ["Lie face down, arms extended overhead", "Legs straight, feet together", "Forehead lightly resting on floor"],
    "cues": ["Lift arms, chest, and legs simultaneously", "Squeeze glutes and back muscles hard", "Hold 2-5 seconds at top", "Lower with control", "Keep neck neutral — look down"],
    "yt_query": "superman hold lower back exercise tutorial" },

  { "name": "Side Plank Hip Dip",
    "primary_muscles": ["Core", "Obliques"], "secondary_muscles": ["Glutes", "Hip Abductors"],
    "equipment": "bodyweight", "tags": ["strength-isolation", "core"],
    "purpose": "Dynamic side plank variation for lateral core endurance and hip stability",
    "conditions": ["Wrist pain — do on forearm", "Shoulder instability — reduce range"],
    "setup_cues": ["Side plank position on forearm or hand", "Feet stacked or staggered", "Body in straight line", "Core braced"],
    "cues": ["Lower hip toward floor without touching", "Drive hip back up to straight line", "Controlled tempo — no momentum", "Keep hips square, not rotating", "10-15 reps each side"],
    "yt_query": "side plank hip dip exercise tutorial" },

  { "name": "Side Plank Rotation",
    "primary_muscles": ["Obliques", "Core"], "secondary_muscles": ["Shoulders", "Upper Back"],
    "equipment": "bodyweight", "tags": ["strength-isolation", "core"],
    "purpose": "Rotational core stability drill combining side plank with thoracic rotation",
    "conditions": ["Shoulder pain — avoid or reduce hold time", "Wrist pain — use forearm"],
    "setup_cues": ["Side plank position, top arm extended to ceiling", "Body straight, core braced", "Hips elevated"],
    "cues": ["Rotate top arm under the body", "Thread arm through as far as comfortable", "Rotate back and reach to ceiling", "Keep hips up throughout", "Controlled breathing"],
    "yt_query": "side plank rotation exercise tutorial" },

  { "name": "Frog Jump",
    "primary_muscles": ["Glutes", "Quadriceps"], "secondary_muscles": ["Calves", "Core", "Hamstrings"],
    "equipment": "bodyweight", "tags": ["strength-compound", "cardio"],
    "purpose": "Explosive plyometric drill combining a deep squat with a full power jump",
    "conditions": ["Knee pain — avoid deep squat position", "High impact — not for beginners"],
    "setup_cues": ["Wide squat stance, toes out", "Squat deep with hands on floor between feet", "Weight through midfoot"],
    "cues": ["Explode up from deep squat", "Full triple extension — hips, knees, ankles", "Land softly with knees bent", "Sink immediately into next rep", "Arms drive up for height"],
    "yt_query": "frog jump exercise tutorial" },

  { "name": "Lateral Jump",
    "primary_muscles": ["Glutes", "Quadriceps"], "secondary_muscles": ["Calves", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound", "cardio"],
    "purpose": "Lateral power and landing mechanics — trains frontal plane explosiveness",
    "conditions": ["Ankle instability — land carefully", "Master bilateral jumps first"],
    "setup_cues": ["Stand on one or both feet", "Slight squat, arms ready", "Focus on landing target"],
    "cues": ["Push off laterally with power", "Land softly on the outside foot with bent knee", "Absorb landing quietly", "Jump back immediately or pause and repeat", "Knee tracks over toes on landing"],
    "yt_query": "lateral jump plyometric exercise tutorial" },

  { "name": "Explosive Push Up",
    "primary_muscles": ["Chest", "Triceps"], "secondary_muscles": ["Shoulders", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Plyometric push up for upper body power development",
    "conditions": ["Wrist pain — modify to regular push up", "Shoulder issues — avoid"],
    "setup_cues": ["Standard push up position", "Core braced hard", "Full range of motion to start"],
    "cues": ["Lower with control", "Explode up with maximum force", "Hands leave ground at top", "Land softly with bent elbows", "Absorb and go directly into next rep"],
    "yt_query": "explosive push up clap push up tutorial" },

  { "name": "Negative Pull Up",
    "primary_muscles": ["Lats", "Upper Back"], "secondary_muscles": ["Biceps", "Core"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Eccentric pull up for building strength toward the full movement",
    "conditions": ["Shoulder impingement — check range", "Ideal pull up progression for beginners"],
    "setup_cues": ["Use step or jump to get chin above bar", "Grip overhand, slightly wider than shoulder-width", "Core braced, body straight"],
    "cues": ["Lower body as slowly as possible — aim 5-10 seconds", "Keep shoulder blades engaged throughout", "Full hang at bottom", "Jump back up and repeat", "Quality over reps — slow and controlled"],
    "yt_query": "negative pull up eccentric pull up tutorial" },

  { "name": "Wall Walk",
    "primary_muscles": ["Shoulders", "Core"], "secondary_muscles": ["Triceps", "Upper Back"],
    "equipment": "bodyweight", "tags": ["strength-compound"],
    "purpose": "Handstand walk progression building shoulder strength and inverted body awareness",
    "conditions": ["Avoid with shoulder instability", "Requires wrist mobility and upper body strength"],
    "setup_cues": ["Start in push up position feet at wall", "Feet walk up wall as hands walk back toward wall"],
    "cues": ["Walk hands closer to wall step by step", "Keep core rigid", "Arms locked out", "Walk back down under control", "Eyes looking at floor between hands"],
    "yt_query": "wall walk exercise tutorial" },

  { "name": "Bear Plank",
    "primary_muscles": ["Core", "Shoulders"], "secondary_muscles": ["Quadriceps", "Hip Flexors"],
    "equipment": "bodyweight", "tags": ["strength-compound", "core"],
    "purpose": "Quadruped plank where knees hover 2 inches off floor — intense core and shoulder stability",
    "conditions": ["Wrist pain — move to forearms or reduce time", "Easier starting point than full plank for beginners"],
    "setup_cues": ["On hands and knees, wrists under shoulders", "Knees under hips", "Lift knees 2-3 inches off floor"],
    "cues": ["Keep back flat — table top position", "Breathe steadily", "Hold still — no rocking", "30-60 second holds to start", "Advance by alternating arm or leg reaches"],
    "yt_query": "bear plank exercise tutorial" },

  { "name": "Squat to Stand",
    "primary_muscles": ["Hamstrings", "Hip Flexors"], "secondary_muscles": ["Lower Back", "Calves"],
    "equipment": "bodyweight", "tags": ["mobility"],
    "purpose": "Dynamic warm-up drill combining a forward fold with a deep squat for full body mobilisation",
    "conditions": ["Tight hamstrings — bend knees more", "Great as first warm-up exercise"],
    "setup_cues": ["Stand feet hip-width", "Bend forward and grab toes or ankles"],
    "cues": ["Holding toes, drop hips into deep squat", "Chest up, look forward in squat", "Stand back up keeping grip on toes", "Feel hamstring stretch in the fold", "Repeat for reps as a flow"],
    "yt_query": "squat to stand mobility drill tutorial" },

  # ── BANDED (loop band) ────────────────────────────────────────────────────

  { "name": "Banded Good Morning",
    "primary_muscles": ["Hamstrings", "Glutes"], "secondary_muscles": ["Lower Back", "Core"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Hip hinge pattern with band resistance for posterior chain without barbell loading",
    "conditions": ["Lower back pain — use minimal resistance", "Great for learning the hinge pattern"],
    "setup_cues": ["Band looped over upper back and under feet", "Feet hip-width, band taut", "Soft knees, core braced"],
    "cues": ["Hinge forward at hips, not waist", "Chest drops toward floor", "Spine stays long", "Drive hips forward to stand", "Squeeze glutes at top"],
    "yt_query": "banded good morning exercise tutorial" },

  { "name": "Banded Squat",
    "primary_muscles": ["Quadriceps", "Glutes"], "secondary_muscles": ["Hamstrings", "Core"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Band adds accommodating resistance — heavier at lockout where muscles are strongest",
    "conditions": ["Knee valgus — band above knees helps cue correct tracking", "Good beginner strength tool"],
    "setup_cues": ["Band under feet, looped over shoulders", "Feet shoulder-width, toes slightly out", "Core braced, chest up"],
    "cues": ["Sit into squat, knees track toes", "Drive through heels to stand", "Feel increased tension at top", "Full depth if mobility allows", "Squeeze glutes at lockout"],
    "yt_query": "banded squat exercise tutorial" },

  { "name": "Banded Monster Walk",
    "primary_muscles": ["Glutes", "Hip Abductors"], "secondary_muscles": ["Quadriceps", "Core"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Lateral banded walk for glute med activation and hip stability",
    "conditions": ["Knee valgus during running or squatting — essential corrective", "Warm-up exercise"],
    "setup_cues": ["Band around ankles or just above knees", "Slight squat position", "Hands on hips", "Feet hip-width"],
    "cues": ["Step diagonally forward and to the side", "Maintain tension in band throughout", "Keep hips low in squat", "Drive knee out over toes", "10 steps each direction"],
    "yt_query": "banded monster walk glute activation tutorial" },

  { "name": "Banded Glute Bridge",
    "primary_muscles": ["Glutes"], "secondary_muscles": ["Hamstrings", "Core"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Adds hip abduction demand to glute bridge for glute med and max co-activation",
    "conditions": ["Knee pain — avoid band above knee", "Easy to progress by using stronger band"],
    "setup_cues": ["Band just above knees", "Lie on back, knees bent, feet flat", "Feet hip-width or closer"],
    "cues": ["Push knees out against band as you bridge", "Drive hips to ceiling", "Squeeze glutes hard at top", "Hold 2 seconds", "Lower slowly"],
    "yt_query": "banded glute bridge exercise tutorial" },

  { "name": "Banded Face Pull",
    "primary_muscles": ["Rear Deltoid", "Upper Back"], "secondary_muscles": ["Rotator Cuff", "Traps"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Band-based face pull for shoulder health, posture, and rotator cuff strength",
    "conditions": ["Essential for overhead athletes", "Do daily as prehab"],
    "setup_cues": ["Anchor band at face height", "Hold with both hands, palms down", "Step back to create tension", "Arms extended"],
    "cues": ["Pull band to face level", "External rotation — thumbs back, elbows high", "Squeeze rear delts and retract shoulder blades", "Hold briefly at end", "Control return"],
    "yt_query": "banded face pull tutorial" },

  { "name": "Banded Row",
    "primary_muscles": ["Upper Back", "Lats"], "secondary_muscles": ["Biceps", "Rear Deltoid"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Horizontal pulling with a band — accessible back exercise anywhere",
    "conditions": ["Lower back pain — use seated version", "Good travel-friendly option"],
    "setup_cues": ["Anchor band at waist height", "Hold both handles, arms extended", "Stand or sit, hinge slightly forward"],
    "cues": ["Row handles to hip/low chest", "Drive elbows back past torso", "Squeeze shoulder blades together", "Control return with tension", "Keep torso still"],
    "yt_query": "resistance band row back exercise tutorial" },

  { "name": "Banded Chest Press",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Triceps", "Shoulders"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Accommodating resistance chest press — higher tension at extension where pec is shortest",
    "conditions": ["Good travel substitute for bench press", "Shoulder pain — adjust angle"],
    "setup_cues": ["Band anchored behind at chest height", "Hold band, palms forward at chest", "Staggered stance for stability"],
    "cues": ["Press arms forward to full extension", "Slight inward arc at end", "Control return — band pulls back", "Keep elbows at 45 degrees", "Full extension every rep"],
    "yt_query": "banded chest press exercise tutorial" },

  { "name": "Banded Overhead Press",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Triceps", "Core", "Traps"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Band overhead press — constant tension through full range",
    "conditions": ["Shoulder impingement — check overhead range", "Good for learning pressing pattern"],
    "setup_cues": ["Stand on band, hold handles at shoulder height", "Palms facing forward", "Core braced, ribs down"],
    "cues": ["Press overhead to full extension", "Bring hands slightly together at top", "Lower under control", "Don't lean back to press", "Breathe out on press"],
    "yt_query": "banded overhead press tutorial" },

  { "name": "Banded Tricep Extension",
    "primary_muscles": ["Triceps"], "secondary_muscles": [],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Overhead or pushdown tricep extension with band for constant tension",
    "conditions": ["Elbow pain — keep range pain-free"],
    "setup_cues": ["Anchor band overhead or hold with both hands overhead", "Elbows pointing forward", "Upper arms vertical"],
    "cues": ["Extend forearms until arms are straight", "Keep upper arms still", "Squeeze triceps at full extension", "Control the return", "Full extension each rep"],
    "yt_query": "banded tricep extension tutorial" },

  { "name": "Banded Bicep Curl",
    "primary_muscles": ["Biceps"], "secondary_muscles": ["Forearms"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Constant tension bicep curl with a band — great for travel and warm-up",
    "conditions": ["Elbow tendinopathy — reduce range"],
    "setup_cues": ["Stand on middle of band, hold handles at sides", "Palms facing forward", "Elbows at ribs"],
    "cues": ["Curl hands to shoulders", "Keep elbows pinned at sides", "Squeeze bicep at top", "Lower slowly — full extension at bottom", "Don't swing torso"],
    "yt_query": "banded bicep curl tutorial" },

  { "name": "Banded Deadlift",
    "primary_muscles": ["Glutes", "Hamstrings"], "secondary_muscles": ["Lower Back", "Core", "Traps"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Hip hinge with accommodating band resistance — peak tension at lockout",
    "conditions": ["Good beginner deadlift progression before barbell", "Lower back pain — focus on glutes"],
    "setup_cues": ["Stand on middle of band, feet hip-width", "Hold band at thighs in hinge position", "Back flat, core braced"],
    "cues": ["Drive through heels to stand", "Hips and shoulders rise together", "Lock hips at top — squeeze glutes", "Hinge back to start", "Keep band close to body"],
    "yt_query": "banded deadlift exercise tutorial" },

  { "name": "Banded Hip Abduction",
    "primary_muscles": ["Glutes", "Hip Abductors"], "secondary_muscles": ["Core"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Side-lying or standing hip abduction against band resistance for glute med development",
    "conditions": ["IT band issues — monitor", "Knee pain — keep band above knee"],
    "setup_cues": ["Lie on side, band above knees or around ankles", "Bottom knee slightly bent for stability", "Top leg straight"],
    "cues": ["Lift top leg against band resistance", "Don't let hip rotate back", "Hold at top for 1 second", "Lower with control", "Keep toes pointing forward not up"],
    "yt_query": "banded hip abduction exercise tutorial" },

  { "name": "Banded Pull Through",
    "primary_muscles": ["Glutes", "Hamstrings"], "secondary_muscles": ["Lower Back", "Core"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Hip extension exercise with band resisting forward-to-back movement — glute finisher",
    "conditions": ["Good for learning hip hinge", "Lower back pain — emphasise glutes not back"],
    "setup_cues": ["Anchor band low behind you", "Hold band between legs, facing away from anchor", "Hinge forward at hips, band between legs"],
    "cues": ["Drive hips forward to standing", "Squeeze glutes hard at lockout", "Hinge forward to return", "Keep spine neutral throughout", "Pull comes from hips not lower back"],
    "yt_query": "banded pull through glute exercise tutorial" },

  { "name": "Banded Lat Pulldown",
    "primary_muscles": ["Lats"], "secondary_muscles": ["Biceps", "Upper Back"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Lat pulldown movement with band anchored overhead — back exercise anywhere",
    "conditions": ["Shoulder mobility limited — reduce range", "Good beginner pull option"],
    "setup_cues": ["Anchor band overhead", "Kneel or sit below anchor point", "Hold band handles overhead, arms extended"],
    "cues": ["Pull elbows down and back toward hips", "Squeeze lats at bottom", "Control arms back overhead", "Lean back slightly", "Think elbows to back pockets"],
    "yt_query": "banded lat pulldown tutorial" },

  { "name": "Banded Front Raise",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Core", "Traps"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Anterior deltoid isolation through forward elevation — constant band tension",
    "conditions": ["Shoulder impingement — limit to 90 degrees", "Rotator cuff rehab"],
    "setup_cues": ["Stand on band, hold handles at hip", "Palms facing down or inward", "Slight elbow bend"],
    "cues": ["Raise arms forward to shoulder height or above", "Keep arms straight or slightly bent", "Control the return — don't let band snap", "Keep torso from swinging", "Exhale on the raise"],
    "yt_query": "banded front raise shoulder exercise tutorial" },

  # ── RESISTANCE BAND WITH HANDLE ───────────────────────────────────────────

  { "name": "Band Chest Press",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Triceps", "Shoulders"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Horizontal push with handled resistance band — chest press pattern without equipment",
    "conditions": ["Adjust band length for appropriate resistance", "Good shoulder warm-up alternative"],
    "setup_cues": ["Anchor band at chest height behind you", "Step forward, handles at chest", "Staggered stance, core tight", "Palms facing down or inward"],
    "cues": ["Press handles straight ahead", "Extend fully at end", "Control return — resist the band", "Keep shoulder blades together", "Vary angle to hit different fibres"],
    "yt_query": "resistance band chest press tutorial" },

  { "name": "Band Bent Over Row",
    "primary_muscles": ["Upper Back", "Lats"], "secondary_muscles": ["Biceps", "Rear Deltoid"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Bent over row pattern with handled band — back strength without weights",
    "conditions": ["Lower back pain — brace strongly or use seated variation"],
    "setup_cues": ["Stand on band, hinge forward at hips", "Hold handles, arms hanging", "Flat back, slight knee bend"],
    "cues": ["Row handles to lower chest/hips", "Drive elbows back past torso", "Squeeze shoulder blades at top", "Lower fully to extend arms", "Keep torso still"],
    "yt_query": "resistance band bent over row tutorial" },

  { "name": "Band Lateral Raise",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Traps", "Core"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Lateral deltoid isolation with constant band tension through the arc",
    "conditions": ["Shoulder impingement — limit to 90 degrees", "Use light resistance"],
    "setup_cues": ["Stand on band or anchor at side", "Hold handle at hip, palm inward", "Slight elbow bend"],
    "cues": ["Raise arm out to the side to shoulder height", "Lead with elbow, not hand", "Control the return", "Keep torso from swinging", "Both arms simultaneously or alternating"],
    "yt_query": "resistance band lateral raise shoulder tutorial" },

  { "name": "Band Bicep Curl",
    "primary_muscles": ["Biceps"], "secondary_muscles": ["Forearms"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Bicep curl with handled bands for constant tension through full range",
    "conditions": ["Elbow pain — reduce range", "Great finisher or warm-up"],
    "setup_cues": ["Stand on band, handles at hips", "Palms facing forward", "Elbows pinned at sides"],
    "cues": ["Curl handles to shoulders", "Squeeze bicep at top", "Lower fully — feel the stretch", "Don't swing", "Supinate at top for peak contraction"],
    "yt_query": "resistance band bicep curl tutorial" },

  { "name": "Band Tricep Pushdown",
    "primary_muscles": ["Triceps"], "secondary_muscles": [],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Cable pushdown simulation with a handled band for tricep isolation",
    "conditions": ["Elbow pain — reduce weight and range"],
    "setup_cues": ["Anchor band overhead at a door or rack", "Hold handle(s), elbows at sides", "Lean slightly forward", "Upper arms vertical"],
    "cues": ["Push handles down to full extension", "Keep elbows pinned at sides", "Squeeze triceps at lockout", "Return slowly — resist the band", "Don't flare elbows"],
    "yt_query": "resistance band tricep pushdown tutorial" },

  { "name": "Band Front Raise",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Core"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Anterior delt raise with handled band — functional shoulder strength",
    "conditions": ["Impingement — stop at 90 degrees"],
    "setup_cues": ["Stand on band, handle in one or both hands", "Arm(s) at hip, palm down", "Slight elbow bend"],
    "cues": ["Raise arm forward to shoulder height or above", "Keep arm straight or lightly bent", "Slow and controlled return", "Core stays braced", "No torso swing"],
    "yt_query": "resistance band front raise shoulder tutorial" },

  { "name": "Band Overhead Press",
    "primary_muscles": ["Shoulders"], "secondary_muscles": ["Triceps", "Core"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Vertical press with handled resistance band for shoulder strength anywhere",
    "conditions": ["Shoulder mobility limited — reduce depth"],
    "setup_cues": ["Stand on band, handles at shoulder height", "Palms forward, elbows at 90 degrees", "Brace core, feet hip-width"],
    "cues": ["Press handles overhead to full extension", "Bring hands slightly together at top", "Lower to ear height", "Don't lean back", "Exhale on press"],
    "yt_query": "resistance band overhead press tutorial" },

  { "name": "Band Face Pull",
    "primary_muscles": ["Rear Deltoid", "Upper Back"], "secondary_muscles": ["Rotator Cuff"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Face pull using a handled resistance band for posture and shoulder health",
    "conditions": ["Do daily as prehab for overhead athletes and desk workers"],
    "setup_cues": ["Anchor band at face height", "Hold handles with overhand grip", "Step back, arms extended"],
    "cues": ["Pull to face level", "External rotate — thumbs back, elbows high", "Squeeze rear delts and upper back", "Hold 1 second", "Control the return"],
    "yt_query": "resistance band face pull tutorial" },

  { "name": "Band Pull Apart",
    "primary_muscles": ["Rear Deltoid", "Upper Back"], "secondary_muscles": ["Rotator Cuff", "Traps"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Horizontal band pull for rear deltoid and scapular retractor activation",
    "conditions": ["Daily shoulder prehab — high reps are ideal", "Easy to do anywhere"],
    "setup_cues": ["Hold band with both hands at shoulder width, arms extended", "Palms facing down", "Slight tension in band at start"],
    "cues": ["Pull band apart until it touches chest", "Squeeze shoulder blades together", "Hold briefly at full stretch", "Return with control", "Keep arms at shoulder height"],
    "yt_query": "resistance band pull apart tutorial" },

  { "name": "Band Woodchop",
    "primary_muscles": ["Core", "Obliques"], "secondary_muscles": ["Shoulders", "Glutes"],
    "equipment": "resistance band", "tags": ["strength-compound", "core"],
    "purpose": "Rotational core power exercise with band — sport-specific movement pattern",
    "conditions": ["Lower back pain — reduce rotation range", "Great for golf and rotational athletes"],
    "setup_cues": ["Anchor band high at one side", "Stand sideways to anchor", "Hold handle with both hands overhead and to anchor side"],
    "cues": ["Pull band diagonally down and across body", "Rotate hips and torso together", "Lead with hips before shoulders", "Return with control against band", "Both directions"],
    "yt_query": "resistance band woodchop rotational core tutorial" },

  { "name": "Band Upright Row",
    "primary_muscles": ["Traps", "Shoulders"], "secondary_muscles": ["Biceps", "Upper Back"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Upright row with band for trap and lateral delt development",
    "conditions": ["Shoulder impingement — avoid or limit range to 90 degrees"],
    "setup_cues": ["Stand on band, hold handles close together", "Palms facing body", "Arms at hip level"],
    "cues": ["Pull handles straight up along body to chin", "Lead with elbows — elbows above hands", "Pause at top", "Lower with control", "Keep handles close to body"],
    "yt_query": "resistance band upright row tutorial" },

  { "name": "Band Fly",
    "primary_muscles": ["Chest"], "secondary_muscles": ["Shoulders", "Biceps"],
    "equipment": "resistance band", "tags": ["strength-isolation"],
    "purpose": "Chest fly with handled band for constant tension through the stretch and squeeze",
    "conditions": ["Shoulder impingement at end range — reduce arc", "Lighter resistance than pressing"],
    "setup_cues": ["Anchor band behind at chest height", "Hold handles, arms out to sides, slight elbow bend", "Step forward for tension", "Chest up, scapulae pinched"],
    "cues": ["Bring hands together in front of chest in an arc", "Squeeze chest at crossover", "Return arms wide under control", "Keep slight elbow bend throughout", "Feel the stretch at end range"],
    "yt_query": "resistance band chest fly tutorial" },

  { "name": "Band Squat",
    "primary_muscles": ["Quadriceps", "Glutes"], "secondary_muscles": ["Hamstrings", "Core"],
    "equipment": "resistance band", "tags": ["strength-compound"],
    "purpose": "Handled band squat with accommodating resistance — strength or warm-up",
    "conditions": ["Good beginner squat tool", "Knee valgus — use band above knees for cueing"],
    "setup_cues": ["Stand on band, handles at shoulders", "Feet shoulder-width, toes out slightly", "Elbows forward, chest up"],
    "cues": ["Squat down, knees tracking toes", "Drive through heels to stand", "Squeeze glutes at top", "Maintain upright torso", "Band gets harder at lockout — push through"],
    "yt_query": "resistance band squat exercise tutorial" },
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def curl_get(path, service_key):
    result = subprocess.run(
        ["curl", "-s",
         "-H", f"apikey: {service_key}",
         "-H", f"Authorization: Bearer {service_key}",
         f"{SUPABASE_URL}{path}"],
        capture_output=True, text=True, timeout=15,
    )
    return json.loads(result.stdout)

def curl_post(path, data, service_key):
    result = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
         "-X", "POST",
         "-H", f"apikey: {service_key}",
         "-H", f"Authorization: Bearer {service_key}",
         "-H", "Content-Type: application/json",
         "-H", "Prefer: return=minimal",
         "-d", json.dumps(data),
         f"{SUPABASE_URL}{path}"],
        capture_output=True, text=True, timeout=15,
    )
    return result.stdout.strip()

def search_youtube(exercise_name, yt_query=None):
    queries = [
        yt_query or f"{exercise_name} exercise short tutorial",
        f"{exercise_name} exercise tutorial",
    ]
    for query in queries:
        try:
            result = subprocess.run(
                ["yt-dlp", f"ytsearch1:{query}",
                 "--print", "webpage_url",
                 "--skip-download", "--quiet"],
                capture_output=True, text=True, timeout=25,
            )
            url = result.stdout.strip()
            if url.startswith("https://"):
                return url
        except (subprocess.TimeoutExpired, Exception):
            continue
    return None

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python add-new-exercises.py <SERVICE_ROLE_KEY>")
        sys.exit(1)

    service_key = sys.argv[1]

    # Fetch existing names to avoid duplicates
    print("Fetching existing exercise names...")
    existing = curl_get("/rest/v1/pt_exercises?select=name", service_key)
    existing_names = {ex["name"].lower() for ex in existing}
    print(f"Found {len(existing_names)} existing exercises\n")

    to_add = [ex for ex in EXERCISES if ex["name"].lower() not in existing_names]
    skipped = len(EXERCISES) - len(to_add)
    print(f"{len(to_add)} new exercises to add ({skipped} already exist)\n")

    added = 0
    failed = []

    for i, ex in enumerate(to_add, 1):
        name = ex["name"]
        print(f"[{i}/{len(to_add)}] {name} ...", end=" ", flush=True)

        # Find video
        video_url = search_youtube(name, ex.get("yt_query"))
        if video_url:
            print(f"video ✓", end=" ", flush=True)
        else:
            print(f"no video", end=" ", flush=True)

        # Build record
        primary = ex.get("primary_muscles", [])
        secondary = ex.get("secondary_muscles", [])
        record = {
            "name": name,
            "primary_muscles": primary,
            "secondary_muscles": secondary,
            "muscles": list(dict.fromkeys(primary + secondary)),
            "equipment": ex.get("equipment", "bodyweight"),
            "tags": ex.get("tags", []),
            "purpose": ex.get("purpose", ""),
            "conditions": ex.get("conditions", []),
            "setup_cues": ex.get("setup_cues", []),
            "cues": ex.get("cues", []),
            "source": "ai",
            "progression_ids": [],
            "regression_ids": [],
            "video_url": video_url,
        }

        status = curl_post("/rest/v1/pt_exercises", record, service_key)
        if status in ("200", "201"):
            print("→ saved ✓")
            added += 1
        else:
            print(f"→ insert failed (status {status})")
            failed.append(name)

        time.sleep(0.3)

    print(f"\n{'='*60}")
    print(f"Done. Added: {added}/{len(to_add)}")
    if failed:
        print(f"\nFailed ({len(failed)}):")
        for f in failed:
            print(f"  - {f}")

if __name__ == "__main__":
    main()
