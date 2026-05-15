-- Add 'no_show' entry type to session ledger
-- Sessions are only deducted on complete or no_show (not on booking/cancellation)

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'pt_session_ledger'
    AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%entry_type%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.pt_session_ledger DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.pt_session_ledger
  ADD CONSTRAINT pt_session_ledger_entry_type_check
  CHECK (entry_type IN (
    'pack_added',
    'booking_hold',
    'hold_released',
    'session_completed',
    'manual_adjustment',
    'no_show'
  ));
