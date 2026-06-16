export type ParQAnswer = 'yes' | 'no';

export interface ParQQuestion {
  id: string;
  label: string;
  text: string;
}

export const PAR_Q_QUESTIONS: ParQQuestion[] = [
  {
    id: 'heart-condition',
    label: 'Heart Condition',
    text: 'Has your doctor ever said that you have a heart condition and that you should only do physical activity recommended by a doctor?',
  },
  {
    id: 'chest-pain-exercise',
    label: 'Chest Pain During Exercise',
    text: 'Do you feel chest pain when you do physical activity?',
  },
  {
    id: 'chest-pain-rest',
    label: 'Chest Pain At Rest',
    text: 'In the past month, have you had chest pain when you were not doing physical activity?',
  },
  {
    id: 'balance-dizziness',
    label: 'Loss of Balance / Dizziness',
    text: 'Do you lose your balance because of dizziness, or do you ever lose consciousness?',
  },
  {
    id: 'joint-bone',
    label: 'Joint / Bone Problems',
    text: 'Do you have a bone or joint problem (for example, back, knee, or hip) that could be made worse by a change in your physical activity?',
  },
  {
    id: 'blood-pressure-medication',
    label: 'Blood Pressure / Heart Medication',
    text: 'Is your doctor currently prescribing drugs (for example, water pills) for your blood pressure or heart condition?',
  },
  {
    id: 'other-medical',
    label: 'Other Medical Reasons',
    text: 'Do you know of any other reason why you should not do physical activity?',
  },
];

export const PAR_Q_CONSENT_TEXT =
  'By signing below, I confirm that I have been cleared by my healthcare provider to take part in physical activity and exercise. I confirm the information I have provided is true and accurate, and I take responsibility for my own health and wellbeing during training.';
