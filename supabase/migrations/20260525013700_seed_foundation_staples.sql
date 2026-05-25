insert into public.pt_exercises (
  name,
  muscles,
  primary_muscles,
  secondary_muscles,
  purpose,
  equipment,
  video_url,
  cues,
  setup_cues,
  tags,
  conditions,
  source
)
values
  ('Hip Flexor Cable Pull', array['hip flexors','core'], array['hip flexors'], array['core'], 'Foundation hip flexor strength and pelvic control.', 'cable machine', null, array['Stand tall','Control the cable path','Keep pelvis level','Pause at end range'], array['Set cable low','Use ankle strap','Hold stable support if needed'], array['foundation','hip flexor','cable','staple'], array[]::text[], 'manual'),
  ('Standing Hip Flexor KB Pull', array['hip flexors','core'], array['hip flexors'], array['core'], 'Foundation hip flexor strength with kettlebell control.', 'kettlebell', null, array['Stand tall','Lift with control','Do not lean back','Pause at the top'], array['Use light kettlebell','Hold support if needed','Keep stance foot rooted'], array['foundation','hip flexor','kettlebell','staple'], array[]::text[], 'manual'),
  ('Half Kneeling Adductor Slides Sideways', array['adductors','hips'], array['adductors'], array['hips','core'], 'Adductor mobility and frontal-plane hip control.', 'slider or towel', null, array['Keep ribs stacked','Slide slowly sideways','Stay tall through torso','Own the end range'], array['Half kneeling position','Use slider under moving knee or foot'], array['foundation','adductor','mobility','staple'], array[]::text[], 'manual'),
  ('Half Kneeling Adductor Slides Front', array['adductors','hips'], array['adductors'], array['hip flexors','core'], 'Adductor and front-splits mobility exposure with control.', 'slider or towel', null, array['Move slowly forward','Keep hips square','Breathe into the stretch','Pull back under control'], array['Half kneeling position','Use slider under moving knee or foot'], array['foundation','adductor','front splits','mobility','staple'], array[]::text[], 'manual'),
  ('Single Arm Cable Pull', array['lats','upper back','core'], array['lats','upper back'], array['core','biceps'], 'Single-arm pulling strength with trunk control.', 'cable machine', null, array['Reach long','Pull elbow to ribs','Keep ribs down','Control the return'], array['Set cable at chest height','Use single handle','Square hips to cable'], array['foundation','single arm','cable','pull','staple'], array[]::text[], 'manual'),
  ('DB Push', array['chest','shoulders','triceps'], array['chest','shoulders'], array['triceps','core'], 'Dumbbell pushing pattern for Foundation upper-body control.', 'dumbbells', null, array['Brace lightly','Press with control','Keep shoulder blade stable','Lower slowly'], array['Choose light dumbbells','Set shoulders before pressing'], array['foundation','dumbbell','push','staple'], array[]::text[], 'manual'),
  ('QL Extension on Back Extension Machine', array['quadratus lumborum','obliques','spinal erectors'], array['quadratus lumborum'], array['obliques','spinal erectors'], 'Controlled lateral trunk extension for QL strength.', 'back extension machine', null, array['Move slowly','Keep hips fixed','Do not rotate','Pause at the top'], array['Set up sideways on back extension machine','Start with bodyweight'], array['foundation','ql','back extension','staple'], array[]::text[], 'manual'),
  ('Knee Extension', array['quadriceps'], array['quadriceps'], array[]::text[], 'Quadriceps isolation for controlled knee extension strength.', 'knee extension machine', null, array['Lift smoothly','Pause at the top','Lower under control','Keep hips down'], array['Set pad above ankles','Line knee with machine pivot'], array['foundation','machine','quads','staple'], array[]::text[], 'manual'),
  ('Hamstring Curl', array['hamstrings'], array['hamstrings'], array['calves'], 'Hamstring isolation for posterior chain strength.', 'hamstring curl machine', null, array['Curl smoothly','Pause in the squeeze','Lower slowly','Keep hips heavy'], array['Set pad above heels','Line knees with machine pivot'], array['foundation','machine','hamstrings','staple'], array[]::text[], 'manual'),
  ('Single Leg DB RDL', array['hamstrings','glutes','core'], array['hamstrings','glutes'], array['core','adductors'], 'Single-leg hinge pattern for Foundation balance and posterior chain control.', 'dumbbells', null, array['Reach hips back','Keep pelvis square','Soft knee','Control the return'], array['Hold one or two dumbbells','Start light','Use support if needed'], array['foundation','single leg','dumbbell','hinge','staple'], array[]::text[], 'manual'),
  ('Seated Shoulder Press', array['shoulders','triceps'], array['shoulders'], array['triceps','upper back'], 'Supported pressing pattern for shoulder strength and control.', 'dumbbells or machine', null, array['Sit tall','Press without shrugging','Lower slowly','Keep ribs down'], array['Use bench with back support','Start light'], array['foundation','shoulder press','dumbbell','machine','staple'], array[]::text[], 'manual')
on conflict (name) do update set
  muscles = excluded.muscles,
  primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  purpose = excluded.purpose,
  equipment = excluded.equipment,
  cues = excluded.cues,
  setup_cues = excluded.setup_cues,
  tags = excluded.tags,
  updated_at = now();
