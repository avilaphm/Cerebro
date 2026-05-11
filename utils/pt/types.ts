export interface PTExercise {
  id: string;
  name: string;
  muscles: string[];
  purpose: string | null;
  equipment: string | null;
  video_url: string | null;
  cues: string[];
  tags: string[];
  source: 'manual' | 'spreadsheet' | 'ai';
}

export interface PTClient {
  id: string;
  name: string;
  email: string;
  status: 'invited' | 'active' | 'paused' | 'archived';
  goals: string | null;
  notes: string | null;
  user_id: string | null;
  sessions_remaining: number;
  document_url: string | null;
  password_created_at: string | null;
  created_at?: string;
}

export interface PTProgrammeExercise {
  id: string;
  exercise_id: string | null;
  name: string;
  sets: string;
  reps: string;
  rest: string;
  notes: string;
  video_url: string | null;
  cues: string[];
  superset_id?: string | null;
}

export interface PTProgrammeDay {
  id: string;
  title: string;
  focus: string;
  exercises: PTProgrammeExercise[];
}

export interface PTProgrammePhase {
  id: string;
  title: string;
  focus: string;
  weeks: string;
  progression: string;
  days: PTProgrammeDay[];
}

export interface PTProgramme {
  phases: PTProgrammePhase[];
}

export interface PTProgramTemplate {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  duration_weeks: number;
  phase_count: number;
  status: 'draft' | 'ready' | 'archived';
  programme: PTProgramme;
}

export interface PTProgramAssignment {
  id: string;
  client_id: string;
  template_id: string | null;
  name: string;
  goal: string | null;
  duration_weeks: number;
  phase_count: number;
  start_date: string | null;
  status: 'draft' | 'active' | 'completed' | 'paused' | 'archived';
  programme: PTProgramme;
  pt_clients?: Pick<PTClient, 'name' | 'email'> | null;
}

export interface PTSetLog {
  id: string;
  exercise_id: string | null;
  exercise_name: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  notes: string | null;
  created_at: string;
}

export interface PTMessage {
  id: string;
  client_id: string;
  sender: 'pt' | 'client';
  content: string;
  read_at: string | null;
  created_at: string;
}

export interface PTGroup {
  id: string;
  name: string;
  color: string;
  created_at: string;
}
