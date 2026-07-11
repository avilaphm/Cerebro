// The AI Training question set. Each section maps to a decision the programme
// generator makes, so the coach's answers can later be routed to the right step.
// `key` is stable and used as the row key in pt_ai_training_answers — do not rename
// once answers exist. `upload` (when present) is the hint for an optional document.

export interface TrainingQuestion {
  key: string;
  prompt: string;
  hint?: string;
  upload?: string;
}

export interface TrainingSection {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  title: string;
  blurb: string;
  questions: TrainingQuestion[];
}

export const SECTIONS: TrainingSection[] = [
  {
    id: 'A',
    title: 'Philosophy & lens',
    blurb: 'How you think — the stuff that colours every decision the AI makes.',
    questions: [
      {
        key: 'a_philosophy',
        prompt: "What's your training philosophy? What makes your programming *yours*?",
        hint: 'Talk like you would to a new coach shadowing you.',
      },
      {
        key: 'a_longevity',
        prompt:
          'How do fitness, longevity, root-cause thinking and the mind–body connection show up in how you program?',
      },
      {
        key: 'a_good_programme',
        prompt: 'What does a great programme look like to you? What are your non-negotiables?',
      },
    ],
  },
  {
    id: 'B',
    title: 'Assessment & root-cause',
    blurb: 'How you read a body — this feeds the movement analysis / mind map.',
    questions: [
      {
        key: 'b_screening',
        prompt: 'How do you screen a new client’s movement? What do you look at first?',
        upload: 'Upload any assessment sheets, screening protocols or checklists you use.',
      },
      {
        key: 'b_root_cause',
        prompt: 'How do you find the root-cause muscle behind a complaint, instead of chasing the symptom?',
      },
      {
        key: 'b_weak_tight',
        prompt:
          'How do you decide a muscle is WEAK vs TIGHT (protective tightness) — and what do you do differently for each?',
      },
      {
        key: 'b_red_flags',
        prompt: 'What are your red flags / contraindications — when do you avoid loading, regress, or refer out?',
      },
    ],
  },
  {
    id: 'C',
    title: 'Exercise selection',
    blurb: 'How you pick movements — this feeds exercise intelligence.',
    questions: [
      {
        key: 'c_philosophy',
        prompt: 'How do you choose exercises for a client? What do you prioritise?',
      },
      {
        key: 'c_treatment',
        prompt:
          'For a weak muscle vs a tight one, what kinds of exercises do you reach for — strengthen, full-ROM, mobility, flexibility, rehab?',
        upload: 'Upload any rehab / mobility / flexibility protocols you follow.',
      },
      {
        key: 'c_difficulty',
        prompt:
          'How do you think about exercise difficulty, and when is a client ready to progress (or when should they regress)?',
      },
      {
        key: 'c_preferred',
        prompt: 'Your go-to exercises, and the ones you avoid at all costs — and why.',
      },
      {
        key: 'c_staples',
        prompt: 'Which exercises are staples that run through a whole phase, and why?',
      },
    ],
  },
  {
    id: 'D',
    title: 'Periodization',
    blurb: 'How you build a block over time — this feeds the methodology plan.',
    questions: [
      {
        key: 'd_phases',
        prompt:
          'Walk through your phase progression (Foundation → testing → hypertrophy → strength → retest) and why that order.',
      },
      {
        key: 'd_meso',
        prompt: 'How do you set weeks, volume, intensity, RPE targets and deloads across a mesocycle?',
        upload: 'Upload any periodization templates or spreadsheets you use.',
      },
    ],
  },
  {
    id: 'E',
    title: 'Session design',
    blurb: 'How a single day is built — this feeds programme synthesis.',
    questions: [
      {
        key: 'e_structure',
        prompt: 'How do you structure a single session — warm-up, main work, MetCon, stretch? Any hard rules?',
      },
      {
        key: 'e_supersets',
        prompt: 'How do you use supersets, and what’s your logic for ordering exercises within a day?',
      },
      {
        key: 'e_conditioning',
        prompt: 'How do you program cardio / conditioning and mobility work?',
      },
    ],
  },
  {
    id: 'F',
    title: 'Condition & goal playbooks',
    blurb: 'Your specifics — the highest-value part. The AI leans on this instead of guessing.',
    questions: [
      {
        key: 'f_conditions',
        prompt:
          'For the conditions you see most (low back, knee, shoulder, pregnancy / postpartum, hypermobility…) — for each, your assessment cues and do / don’t exercises.',
        upload: 'Upload any condition-specific protocols.',
      },
      {
        key: 'f_goals',
        prompt:
          'For your main client goals (fat loss, strength, longevity, return-from-injury) — how does your approach change for each?',
      },
    ],
  },
];

export const ALL_QUESTIONS = SECTIONS.flatMap((s) =>
  s.questions.map((q) => ({ ...q, section: s.id })),
);

export const TOTAL_QUESTIONS = ALL_QUESTIONS.length;
