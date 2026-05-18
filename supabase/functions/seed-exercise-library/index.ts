import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// 400 exercises grouped by category
const EXERCISE_LIST: { name: string; category: string }[] = [
  // Strength - Compound (60)
  { name: 'Back Squat', category: 'strength-compound' },
  { name: 'Front Squat', category: 'strength-compound' },
  { name: 'Goblet Squat', category: 'strength-compound' },
  { name: 'Box Squat', category: 'strength-compound' },
  { name: 'Pause Squat', category: 'strength-compound' },
  { name: 'Bulgarian Split Squat', category: 'strength-compound' },
  { name: 'Hack Squat', category: 'strength-compound' },
  { name: 'Zercher Squat', category: 'strength-compound' },
  { name: 'Conventional Deadlift', category: 'strength-compound' },
  { name: 'Romanian Deadlift', category: 'strength-compound' },
  { name: 'Sumo Deadlift', category: 'strength-compound' },
  { name: 'Stiff Leg Deadlift', category: 'strength-compound' },
  { name: 'Single Leg Romanian Deadlift', category: 'strength-compound' },
  { name: 'Trap Bar Deadlift', category: 'strength-compound' },
  { name: 'Barbell Hip Thrust', category: 'strength-compound' },
  { name: 'Dumbbell Hip Thrust', category: 'strength-compound' },
  { name: 'Barbell Bench Press', category: 'strength-compound' },
  { name: 'Incline Barbell Bench Press', category: 'strength-compound' },
  { name: 'Decline Barbell Bench Press', category: 'strength-compound' },
  { name: 'Dumbbell Bench Press', category: 'strength-compound' },
  { name: 'Incline Dumbbell Press', category: 'strength-compound' },
  { name: 'Overhead Press', category: 'strength-compound' },
  { name: 'Push Press', category: 'strength-compound' },
  { name: 'Arnold Press', category: 'strength-compound' },
  { name: 'Barbell Row', category: 'strength-compound' },
  { name: 'Pendlay Row', category: 'strength-compound' },
  { name: 'Dumbbell Row', category: 'strength-compound' },
  { name: 'Cable Row', category: 'strength-compound' },
  { name: 'Chest Supported Row', category: 'strength-compound' },
  { name: 'Pull Up', category: 'strength-compound' },
  { name: 'Chin Up', category: 'strength-compound' },
  { name: 'Lat Pulldown', category: 'strength-compound' },
  { name: 'Wide Grip Lat Pulldown', category: 'strength-compound' },
  { name: 'Dip', category: 'strength-compound' },
  { name: 'Ring Dip', category: 'strength-compound' },
  { name: 'Push Up', category: 'strength-compound' },
  { name: 'Elevated Push Up', category: 'strength-compound' },
  { name: 'Diamond Push Up', category: 'strength-compound' },
  { name: 'Close Grip Bench Press', category: 'strength-compound' },
  { name: 'Power Clean', category: 'strength-compound' },
  { name: 'Hang Clean', category: 'strength-compound' },
  { name: 'Kettlebell Swing', category: 'strength-compound' },
  { name: 'Farmer Carry', category: 'strength-compound' },
  { name: 'Suitcase Carry', category: 'strength-compound' },
  { name: 'Rack Pull', category: 'strength-compound' },
  { name: 'Lunge', category: 'strength-compound' },
  { name: 'Reverse Lunge', category: 'strength-compound' },
  { name: 'Walking Lunge', category: 'strength-compound' },
  { name: 'Step Up', category: 'strength-compound' },
  { name: 'Lateral Step Up', category: 'strength-compound' },
  { name: 'Split Squat', category: 'strength-compound' },
  { name: 'Pistol Squat', category: 'strength-compound' },
  { name: 'Good Morning', category: 'strength-compound' },
  { name: 'Glute Bridge', category: 'strength-compound' },
  { name: 'Single Leg Glute Bridge', category: 'strength-compound' },
  { name: 'Nordic Hamstring Curl', category: 'strength-compound' },
  { name: 'Cable Pull Through', category: 'strength-compound' },
  { name: 'Sumo Squat', category: 'strength-compound' },
  { name: 'Paused Romanian Deadlift', category: 'strength-compound' },
  { name: 'Trap Bar Farmers Carry', category: 'strength-compound' },

  // Strength - Isolation (80)
  { name: 'Barbell Curl', category: 'strength-isolation' },
  { name: 'Dumbbell Curl', category: 'strength-isolation' },
  { name: 'Hammer Curl', category: 'strength-isolation' },
  { name: 'Incline Dumbbell Curl', category: 'strength-isolation' },
  { name: 'Preacher Curl', category: 'strength-isolation' },
  { name: 'Cable Curl', category: 'strength-isolation' },
  { name: 'Concentration Curl', category: 'strength-isolation' },
  { name: 'Zottman Curl', category: 'strength-isolation' },
  { name: 'Reverse Curl', category: 'strength-isolation' },
  { name: 'Tricep Pushdown', category: 'strength-isolation' },
  { name: 'Rope Pushdown', category: 'strength-isolation' },
  { name: 'Overhead Tricep Extension', category: 'strength-isolation' },
  { name: 'Skull Crusher', category: 'strength-isolation' },
  { name: 'Tricep Kickback', category: 'strength-isolation' },
  { name: 'Cable Tricep Extension', category: 'strength-isolation' },
  { name: 'Lateral Raise', category: 'strength-isolation' },
  { name: 'Cable Lateral Raise', category: 'strength-isolation' },
  { name: 'Front Raise', category: 'strength-isolation' },
  { name: 'Bent Over Lateral Raise', category: 'strength-isolation' },
  { name: 'Cable Front Raise', category: 'strength-isolation' },
  { name: 'Face Pull', category: 'strength-isolation' },
  { name: 'Rear Delt Fly', category: 'strength-isolation' },
  { name: 'Machine Fly', category: 'strength-isolation' },
  { name: 'Dumbbell Fly', category: 'strength-isolation' },
  { name: 'Cable Fly', category: 'strength-isolation' },
  { name: 'Pec Dec', category: 'strength-isolation' },
  { name: 'Leg Extension', category: 'strength-isolation' },
  { name: 'Leg Curl', category: 'strength-isolation' },
  { name: 'Seated Leg Curl', category: 'strength-isolation' },
  { name: 'Lying Leg Curl', category: 'strength-isolation' },
  { name: 'Leg Press', category: 'strength-isolation' },
  { name: 'Calf Raise', category: 'strength-isolation' },
  { name: 'Seated Calf Raise', category: 'strength-isolation' },
  { name: 'Donkey Calf Raise', category: 'strength-isolation' },
  { name: 'Hip Abduction Machine', category: 'strength-isolation' },
  { name: 'Hip Adduction Machine', category: 'strength-isolation' },
  { name: 'Cable Hip Abduction', category: 'strength-isolation' },
  { name: 'Cable Hip Extension', category: 'strength-isolation' },
  { name: 'Cable Glute Kickback', category: 'strength-isolation' },
  { name: 'Banded Glute Kickback', category: 'strength-isolation' },
  { name: 'Banded Clamshell', category: 'strength-isolation' },
  { name: 'Banded Lateral Walk', category: 'strength-isolation' },
  { name: 'Wrist Curl', category: 'strength-isolation' },
  { name: 'Reverse Wrist Curl', category: 'strength-isolation' },
  { name: 'Shrug', category: 'strength-isolation' },
  { name: 'Dumbbell Shrug', category: 'strength-isolation' },
  { name: 'Upright Row', category: 'strength-isolation' },
  { name: 'Cable Upright Row', category: 'strength-isolation' },
  { name: 'Chest Dip', category: 'strength-isolation' },
  { name: 'Seated Dumbbell Press', category: 'strength-isolation' },
  { name: 'Machine Shoulder Press', category: 'strength-isolation' },
  { name: 'Machine Chest Press', category: 'strength-isolation' },
  { name: 'Machine Row', category: 'strength-isolation' },
  { name: 'Pullover', category: 'strength-isolation' },
  { name: 'Cable Pullover', category: 'strength-isolation' },
  { name: 'Dumbbell Pullover', category: 'strength-isolation' },
  { name: 'External Rotation', category: 'strength-isolation' },
  { name: 'Internal Rotation', category: 'strength-isolation' },
  { name: 'Banded Pull Apart', category: 'strength-isolation' },
  { name: 'Low Cable Row', category: 'strength-isolation' },
  { name: 'High Cable Row', category: 'strength-isolation' },
  { name: 'Incline Curl', category: 'strength-isolation' },
  { name: 'Spider Curl', category: 'strength-isolation' },
  { name: 'Cable Hammer Curl', category: 'strength-isolation' },
  { name: 'Seated Dumbbell Curl', category: 'strength-isolation' },
  { name: 'Single Leg Press', category: 'strength-isolation' },
  { name: 'Wall Sit', category: 'strength-isolation' },
  { name: 'Terminal Knee Extension', category: 'strength-isolation' },
  { name: 'VMO Squat', category: 'strength-isolation' },
  { name: 'Nordic Curl', category: 'strength-isolation' },
  { name: 'Reverse Hyper', category: 'strength-isolation' },
  { name: 'Back Extension', category: 'strength-isolation' },
  { name: 'Prone Hip Extension', category: 'strength-isolation' },
  { name: 'Hip Thrust Machine', category: 'strength-isolation' },
  { name: 'Banded Hip Thrust', category: 'strength-isolation' },
  { name: 'Frog Pump', category: 'strength-isolation' },
  { name: 'Dumbbell Lateral Raise', category: 'strength-isolation' },
  { name: 'Wide Grip Upright Row', category: 'strength-isolation' },

  // Core (50)
  { name: 'Plank', category: 'core' },
  { name: 'Side Plank', category: 'core' },
  { name: 'Plank with Knee Tap', category: 'core' },
  { name: 'Plank with Shoulder Tap', category: 'core' },
  { name: 'Plank on Knees', category: 'core' },
  { name: 'RKC Plank', category: 'core' },
  { name: 'Dead Bug', category: 'core' },
  { name: 'Bird Dog', category: 'core' },
  { name: 'Hollow Body Hold', category: 'core' },
  { name: 'Hollow Body Rock', category: 'core' },
  { name: 'L-Sit Hold', category: 'core' },
  { name: 'Ab Wheel Rollout', category: 'core' },
  { name: 'Cable Crunch', category: 'core' },
  { name: 'Crunch', category: 'core' },
  { name: 'Bicycle Crunch', category: 'core' },
  { name: 'Reverse Crunch', category: 'core' },
  { name: 'Leg Raise', category: 'core' },
  { name: 'Hanging Leg Raise', category: 'core' },
  { name: 'Hanging Knee Raise', category: 'core' },
  { name: 'V-Up', category: 'core' },
  { name: 'Toe Touch', category: 'core' },
  { name: 'Mountain Climber', category: 'core' },
  { name: 'Russian Twist', category: 'core' },
  { name: 'Pallof Press', category: 'core' },
  { name: 'Cable Woodchop', category: 'core' },
  { name: 'Cable Chop', category: 'core' },
  { name: 'Landmine Rotation', category: 'core' },
  { name: 'Suitcase Deadlift', category: 'core' },
  { name: 'Windmill', category: 'core' },
  { name: 'Turkish Get Up', category: 'core' },
  { name: 'Dragon Flag', category: 'core' },
  { name: 'Stir the Pot', category: 'core' },
  { name: 'Ab Crunch Machine', category: 'core' },
  { name: 'Decline Sit Up', category: 'core' },
  { name: 'Stability Ball Crunch', category: 'core' },
  { name: 'Stability Ball Pike', category: 'core' },
  { name: 'TRX Fallout', category: 'core' },
  { name: 'Plank Up Down', category: 'core' },
  { name: 'Copenhagen Plank', category: 'core' },
  { name: 'Long Lever Plank', category: 'core' },
  { name: 'Suitcase Carry Core', category: 'core' },
  { name: 'Press Pallof', category: 'core' },
  { name: 'Anti-Rotation Press', category: 'core' },
  { name: 'Seated Cable Rotation', category: 'core' },
  { name: 'Standing Oblique Crunch', category: 'core' },
  { name: 'Waiter Carry', category: 'core' },
  { name: 'Overhead Carry', category: 'core' },
  { name: 'Renegade Row', category: 'core' },
  { name: 'Banded Deadbug', category: 'core' },
  { name: 'Swiss Ball Rollout', category: 'core' },

  // Mobility / Flexibility (60)
  { name: 'Hip Flexor Stretch', category: 'mobility' },
  { name: 'Pigeon Pose', category: 'mobility' },
  { name: 'Figure Four Stretch', category: 'mobility' },
  { name: 'Hip 90-90 Stretch', category: 'mobility' },
  { name: 'Deep Squat Hold', category: 'mobility' },
  { name: 'Cossack Squat', category: 'mobility' },
  { name: 'World Greatest Stretch', category: 'mobility' },
  { name: 'Thoracic Rotation', category: 'mobility' },
  { name: 'Thoracic Extension on Foam Roller', category: 'mobility' },
  { name: 'Cat Cow', category: 'mobility' },
  { name: 'Childs Pose', category: 'mobility' },
  { name: 'Thread the Needle', category: 'mobility' },
  { name: 'Doorway Pec Stretch', category: 'mobility' },
  { name: 'Chest Opener on Foam Roller', category: 'mobility' },
  { name: 'Lat Stretch', category: 'mobility' },
  { name: 'Shoulder Cross Body Stretch', category: 'mobility' },
  { name: 'Sleeper Stretch', category: 'mobility' },
  { name: 'Overhead Shoulder Stretch', category: 'mobility' },
  { name: 'Neck Side Stretch', category: 'mobility' },
  { name: 'Levator Scapulae Stretch', category: 'mobility' },
  { name: 'Standing Hamstring Stretch', category: 'mobility' },
  { name: 'Lying Hamstring Stretch', category: 'mobility' },
  { name: 'Seated Hamstring Stretch', category: 'mobility' },
  { name: 'Standing Quad Stretch', category: 'mobility' },
  { name: 'Lying Quad Stretch', category: 'mobility' },
  { name: 'IT Band Stretch', category: 'mobility' },
  { name: 'Calf Stretch Wall', category: 'mobility' },
  { name: 'Soleus Stretch', category: 'mobility' },
  { name: 'Ankle Circles', category: 'mobility' },
  { name: 'Ankle Dorsiflexion Drill', category: 'mobility' },
  { name: 'Hip Circle', category: 'mobility' },
  { name: 'Hip Hinge Drill', category: 'mobility' },
  { name: 'Hip CARs', category: 'mobility' },
  { name: 'Shoulder CARs', category: 'mobility' },
  { name: 'Thoracic CARs', category: 'mobility' },
  { name: 'Half Kneeling Hip Flexor Stretch', category: 'mobility' },
  { name: 'Half Kneeling Thoracic Rotation', category: 'mobility' },
  { name: 'Lying Glute Stretch', category: 'mobility' },
  { name: 'Seated Piriformis Stretch', category: 'mobility' },
  { name: 'Adductor Stretch', category: 'mobility' },
  { name: 'Sumo Squat Hold', category: 'mobility' },
  { name: 'Wall Hip Flexor Stretch', category: 'mobility' },
  { name: 'Standing Side Stretch', category: 'mobility' },
  { name: 'Thoracic Side Bend', category: 'mobility' },
  { name: 'Prone Press Up', category: 'mobility' },
  { name: 'Prone Hip Rotation', category: 'mobility' },
  { name: 'Banded Hip Distraction', category: 'mobility' },
  { name: 'Foam Roll Quads', category: 'mobility' },
  { name: 'Foam Roll IT Band', category: 'mobility' },
  { name: 'Foam Roll Thoracic Spine', category: 'mobility' },
  { name: 'Foam Roll Lats', category: 'mobility' },
  { name: 'Foam Roll Glutes', category: 'mobility' },
  { name: 'Foam Roll Calves', category: 'mobility' },
  { name: 'Wrist Extension Stretch', category: 'mobility' },
  { name: 'Wrist Flexion Stretch', category: 'mobility' },
  { name: 'Forearm Stretch', category: 'mobility' },
  { name: 'Quadruped Rock Back', category: 'mobility' },
  { name: 'Supine Hip Rotation', category: 'mobility' },
  { name: 'Low Back Flexion Stretch', category: 'mobility' },
  { name: 'Nerve Floss Sciatic', category: 'mobility' },

  // Cardio / Conditioning (40)
  { name: 'Box Jump', category: 'cardio' },
  { name: 'Broad Jump', category: 'cardio' },
  { name: 'Lateral Box Jump', category: 'cardio' },
  { name: 'Squat Jump', category: 'cardio' },
  { name: 'Tuck Jump', category: 'cardio' },
  { name: 'Jump Lunge', category: 'cardio' },
  { name: 'Burpee', category: 'cardio' },
  { name: 'Burpee Box Jump', category: 'cardio' },
  { name: 'Battle Rope Waves', category: 'cardio' },
  { name: 'Battle Rope Slams', category: 'cardio' },
  { name: 'Skipping', category: 'cardio' },
  { name: 'Double Under', category: 'cardio' },
  { name: 'Sled Push', category: 'cardio' },
  { name: 'Sled Pull', category: 'cardio' },
  { name: 'Prowler Push', category: 'cardio' },
  { name: 'Rowing Machine', category: 'cardio' },
  { name: 'Assault Bike', category: 'cardio' },
  { name: 'Ski Erg', category: 'cardio' },
  { name: 'Stationary Bike', category: 'cardio' },
  { name: 'Treadmill Run', category: 'cardio' },
  { name: 'Sprint', category: 'cardio' },
  { name: 'Stair Climb', category: 'cardio' },
  { name: 'Lateral Shuffle', category: 'cardio' },
  { name: 'Agility Ladder Drill', category: 'cardio' },
  { name: 'High Knees', category: 'cardio' },
  { name: 'Butt Kicks', category: 'cardio' },
  { name: 'Jumping Jack', category: 'cardio' },
  { name: 'Kettlebell Clean', category: 'cardio' },
  { name: 'Kettlebell Snatch', category: 'cardio' },
  { name: 'Dumbbell Snatch', category: 'cardio' },
  { name: 'Thruster', category: 'cardio' },
  { name: 'Wall Ball', category: 'cardio' },
  { name: 'Med Ball Slam', category: 'cardio' },
  { name: 'Med Ball Rotational Throw', category: 'cardio' },
  { name: 'Bear Crawl', category: 'cardio' },
  { name: 'Crawling', category: 'cardio' },
  { name: 'Lateral Bound', category: 'cardio' },
  { name: 'Depth Jump', category: 'cardio' },
  { name: 'Single Leg Hop', category: 'cardio' },
  { name: 'Shuttle Run', category: 'cardio' },

  // Golf-Specific Mobility (40)
  { name: 'Golf Rotation Drill', category: 'golf' },
  { name: 'Hip Separation Drill', category: 'golf' },
  { name: 'Address Posture Hold', category: 'golf' },
  { name: 'Thoracic Rotation Golf', category: 'golf' },
  { name: 'X-Factor Stretch', category: 'golf' },
  { name: 'Lead Hip Internal Rotation', category: 'golf' },
  { name: 'Trail Hip External Rotation', category: 'golf' },
  { name: 'Shoulder Turn Drill', category: 'golf' },
  { name: 'Reverse Spine Angle Fix', category: 'golf' },
  { name: 'Hip Hinge Golf Setup', category: 'golf' },
  { name: 'Club Behind Spine Rotation', category: 'golf' },
  { name: 'Step Through Rotation', category: 'golf' },
  { name: 'Medicine Ball Golf Swing', category: 'golf' },
  { name: 'Golf Backswing Mobility Drill', category: 'golf' },
  { name: 'Follow Through Drill', category: 'golf' },
  { name: 'Lateral Sway Correction', category: 'golf' },
  { name: 'Pelvis Tilt Control', category: 'golf' },
  { name: 'Glute Activation for Golf', category: 'golf' },
  { name: 'Single Leg Balance Golf', category: 'golf' },
  { name: 'Weight Transfer Drill', category: 'golf' },
  { name: 'Seated Hip Internal Rotation', category: 'golf' },
  { name: 'Seated Hip External Rotation', category: 'golf' },
  { name: 'Standing Hip Rotation', category: 'golf' },
  { name: 'Wall Assisted Rotation', category: 'golf' },
  { name: 'Neck Rotation Drill', category: 'golf' },
  { name: 'Wrist Hinge Drill', category: 'golf' },
  { name: 'Forearm Rotation Drill', category: 'golf' },
  { name: 'Golf Core Rotation', category: 'golf' },
  { name: 'Side Lying Thoracic Rotation', category: 'golf' },
  { name: 'Open Book Stretch', category: 'golf' },
  { name: 'Lat Stretch for Golf', category: 'golf' },
  { name: 'Hip Flexor Golf Stretch', category: 'golf' },
  { name: 'Glute Stretch Golf', category: 'golf' },
  { name: 'Ankle Mobility Golf', category: 'golf' },
  { name: 'Rotation with Dowel', category: 'golf' },
  { name: 'Chair Rotation Drill', category: 'golf' },
  { name: 'Half Kneeling Rotation', category: 'golf' },
  { name: 'Kneeling Hip Flexor Golf', category: 'golf' },
  { name: 'Golf Posture Wall Drill', category: 'golf' },
  { name: 'Balance Board Stance', category: 'golf' },

  // Running & Walking (30)
  { name: 'A-Skip', category: 'running' },
  { name: 'B-Skip', category: 'running' },
  { name: 'High Knee March', category: 'running' },
  { name: 'Ankling Drill', category: 'running' },
  { name: 'Bounding', category: 'running' },
  { name: 'Running Form Drill', category: 'running' },
  { name: 'Arm Swing Drill', category: 'running' },
  { name: 'Cadence Drill', category: 'running' },
  { name: 'Stride Drill', category: 'running' },
  { name: 'Hill Sprint', category: 'running' },
  { name: 'Tempo Run', category: 'running' },
  { name: 'Fartlek', category: 'running' },
  { name: 'Easy Run', category: 'running' },
  { name: 'Walk', category: 'running' },
  { name: 'Brisk Walk', category: 'running' },
  { name: 'Single Leg Calf Raise Running', category: 'running' },
  { name: 'Hip Flexor March', category: 'running' },
  { name: 'Glute Activation March', category: 'running' },
  { name: 'Lateral Band Walk', category: 'running' },
  { name: 'Single Leg Balance', category: 'running' },
  { name: 'Single Leg Squat Running Prep', category: 'running' },
  { name: 'Strides', category: 'running' },
  { name: 'Acceleration Drill', category: 'running' },
  { name: 'Deceleration Drill', category: 'running' },
  { name: 'Incline Walk', category: 'running' },
  { name: 'Nordic Walking', category: 'running' },
  { name: 'Running Lunge', category: 'running' },
  { name: 'Foot Strike Drill', category: 'running' },
  { name: 'Posterior Chain March', category: 'running' },
  { name: 'Straight Leg Run', category: 'running' },

  // Pilates / Recovery (40)
  { name: 'Hundred', category: 'pilates' },
  { name: 'Roll Up', category: 'pilates' },
  { name: 'Single Leg Circle', category: 'pilates' },
  { name: 'Rolling Like a Ball', category: 'pilates' },
  { name: 'Single Leg Stretch', category: 'pilates' },
  { name: 'Double Leg Stretch', category: 'pilates' },
  { name: 'Scissors', category: 'pilates' },
  { name: 'Criss Cross', category: 'pilates' },
  { name: 'Spine Stretch Forward', category: 'pilates' },
  { name: 'Open Leg Rocker', category: 'pilates' },
  { name: 'Corkscrew', category: 'pilates' },
  { name: 'Saw', category: 'pilates' },
  { name: 'Swan Dive', category: 'pilates' },
  { name: 'Single Leg Kick', category: 'pilates' },
  { name: 'Double Leg Kick', category: 'pilates' },
  { name: 'Neck Pull', category: 'pilates' },
  { name: 'Side Kick', category: 'pilates' },
  { name: 'Teaser', category: 'pilates' },
  { name: 'Hip Circle Pilates', category: 'pilates' },
  { name: 'Swimming Pilates', category: 'pilates' },
  { name: 'Leg Pull Front', category: 'pilates' },
  { name: 'Leg Pull Back', category: 'pilates' },
  { name: 'Spine Twist', category: 'pilates' },
  { name: 'Seal', category: 'pilates' },
  { name: '90-90 Breathing', category: 'pilates' },
  { name: 'Diaphragmatic Breathing', category: 'pilates' },
  { name: 'Box Breathing', category: 'pilates' },
  { name: 'Foam Roll Upper Back', category: 'pilates' },
  { name: 'Foam Roll Lower Back', category: 'pilates' },
  { name: 'Supine Spinal Twist', category: 'pilates' },
  { name: 'Prone Cobra', category: 'pilates' },
  { name: 'Hip Flexor Activation', category: 'pilates' },
  { name: 'Glute Med Activation', category: 'pilates' },
  { name: 'TVA Activation', category: 'pilates' },
  { name: 'Pelvic Floor Exercise', category: 'pilates' },
  { name: 'Supine March', category: 'pilates' },
  { name: 'Wall Angel', category: 'pilates' },
  { name: 'Seated Breathing', category: 'pilates' },
  { name: 'Progressive Muscle Relaxation', category: 'pilates' },
  { name: 'Restorative Child Pose', category: 'pilates' },
];

interface ExerciseMeta {
  name: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  conditions: string[];
  setup_cues: string[];
  equipment: string | null;
  tags: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const internalSecret = Deno.env.get('INTERNAL_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

  let body: { limit?: number } = {};
  try { body = await req.json(); } catch { /* ok */ }
  const limit = body.limit ?? 100;

  const adminClient = createClient(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Find exercises not yet in DB
  const { data: existing } = await adminClient
    .from('pt_exercises')
    .select('name');
  const existingNames = new Set((existing ?? []).map((e: { name: string }) => e.name.toLowerCase()));

  const allToSeed = EXERCISE_LIST.filter((e) => !existingNames.has(e.name.toLowerCase()));
  const toSeed = allToSeed.slice(0, limit);

  if (toSeed.length === 0) {
    return json({ seeded: 0, skipped: EXERCISE_LIST.length, remaining: 0, message: 'All exercises already exist' });
  }

  let seeded = 0;
  const errors: string[] = [];
  const BATCH = 15;

  for (let i = 0; i < toSeed.length; i += BATCH) {
    const batch = toSeed.slice(i, i + BATCH);
    const names = batch.map((e) => `${e.name} (${e.category})`).join('\n');

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `You are a certified personal trainer and physiotherapist. For each exercise listed below, return a JSON array with an object for each exercise.

Exercises:
${names}

Return ONLY a valid JSON array. Each object must have exactly these fields:
- "name": exact exercise name as given
- "primary_muscles": array of 1-2 main muscles worked (e.g. ["Glutes", "Hamstrings"])
- "secondary_muscles": array of 1-3 supporting muscles (e.g. ["Core", "Lower Back"])
- "conditions": array of 2-5 health conditions or goals this exercise helps (e.g. ["lower back pain", "weak core", "hip imbalance", "poor posture"])
- "setup_cues": array of exactly 5 setup instructions in this order: [feet position, torso position, core and bracing, how to initiate the movement, where to squeeze or feel the peak contraction]
- "equipment": single string or null (e.g. "barbell", "dumbbells", "cable machine", "bodyweight", null)
- "tags": array of 2-4 category tags (e.g. ["strength", "compound", "lower-body"])

Be medically accurate. For "conditions", think about what physical problems or goals this exercise addresses (e.g. weak glutes, knee pain, shoulder instability, tight hips, lower back weakness, poor balance).`
        }],
      });

      const raw = msg.content[0].type === 'text' ? msg.content[0].text : '';
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        errors.push(`Batch ${i}-${i + BATCH}: no JSON found`);
        continue;
      }

      const results: ExerciseMeta[] = JSON.parse(jsonMatch[0]);

      const rows = results.map((r) => ({
        name: r.name,
        primary_muscles: r.primary_muscles ?? [],
        secondary_muscles: r.secondary_muscles ?? [],
        conditions: r.conditions ?? [],
        setup_cues: r.setup_cues ?? [],
        equipment: r.equipment ?? null,
        tags: r.tags ?? [],
        muscles: [...(r.primary_muscles ?? []), ...(r.secondary_muscles ?? [])],
        cues: [],
        source: 'ai' as const,
      }));

      const { error: upsertError } = await adminClient
        .from('pt_exercises')
        .upsert(rows, { onConflict: 'name', ignoreDuplicates: false });

      if (upsertError) {
        errors.push(`Batch ${i}-${i + BATCH}: ${upsertError.message}`);
      } else {
        seeded += rows.length;
      }
    } catch (err) {
      errors.push(`Batch ${i}-${i + BATCH}: ${String(err)}`);
    }

    // Small pause between batches to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  return json({
    seeded,
    skipped: EXERCISE_LIST.length - allToSeed.length,
    remaining: allToSeed.length - toSeed.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});
