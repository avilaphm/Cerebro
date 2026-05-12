export type BookingLocationType = 'video' | 'phone' | 'in_person';
export type BookingAppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type BookingAppointmentSource = 'manual' | 'public' | 'lead_link' | 'import';

export interface BookingSettings {
  id: string;
  created_at: string;
  updated_at?: string;
  owner_user_id: string | null;
  public_slug: string | null;
  timezone: string;
  call_duration_minutes: number;
  buffer_minutes: number;
  booking_horizon_days: number;
  minimum_notice_hours: number;
  location_type: BookingLocationType;
  location_details: string | null;
  confirmation_message: string | null;
}

export interface BookingAvailabilityWindow {
  id: string;
  created_at: string;
  updated_at?: string;
  settings_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  label: string | null;
}

export interface BookingAppointment {
  id: string;
  created_at: string;
  updated_at?: string;
  settings_id: string | null;
  lead_id: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: BookingAppointmentStatus;
  source: BookingAppointmentSource;
  invitee_name: string;
  invitee_email: string;
  invitee_phone: string | null;
  business_name: string | null;
  notes: string | null;
  cancel_reason: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  unique_token: string | null;
  leads?: {
    id: string;
    name: string | null;
    email: string | null;
    industry: string | null;
    website: string | null;
  } | null;
}

export interface BookingLeadOption {
  id: string;
  name: string | null;
  email: string | null;
  industry: string | null;
}
