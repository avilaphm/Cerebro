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
  {
    id: 'refer-physio',
    label: 'Refer to Physio',
    text: 'Does this client need to be referred to a physio before starting or continuing training?',
  },
];

export const PAR_Q_CONSENT_TEXT =
  'If you answered Yes to one or more questions, consult with your healthcare provider before engaging in physical activity. If you answered No to all questions, you are likely able to engage in physical activity but should still consult healthcare providers if you have concerns or experience discomfort. I understand that the PAR-Q is a self-assessment tool and does not replace medical advice. I affirm that the information provided is accurate, and I assume responsibility for my health and well-being.';
