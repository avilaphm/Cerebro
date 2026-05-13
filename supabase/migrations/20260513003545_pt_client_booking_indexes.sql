-- Advisor follow-up for PT booking foreign keys.

create index if not exists pt_booking_appointments_completed_by_idx
  on public.pt_booking_appointments (completed_by);

create index if not exists pt_booking_appointments_created_by_idx
  on public.pt_booking_appointments (created_by);

create index if not exists pt_session_ledger_created_by_idx
  on public.pt_session_ledger (created_by);

create index if not exists pt_booking_cancellation_requests_appointment_idx
  on public.pt_booking_cancellation_requests (appointment_id);

create index if not exists pt_booking_cancellation_requests_client_idx
  on public.pt_booking_cancellation_requests (client_id);

create index if not exists pt_booking_cancellation_requests_reviewed_by_idx
  on public.pt_booking_cancellation_requests (reviewed_by);

create index if not exists pt_notification_log_appointment_idx
  on public.pt_notification_log (appointment_id);
