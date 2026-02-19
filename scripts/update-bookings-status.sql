-- Update any existing 'pending' bookings to 'in_progress'
UPDATE bookings SET status = 'in_progress' WHERE status = 'pending';

-- Drop existing check constraint if any (ignore error if doesn't exist)
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

-- Add proper check constraint
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check 
  CHECK (status IN ('in_progress', 'confirmed', 'cancelled', 'completed'));

-- Set default
ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'in_progress';
