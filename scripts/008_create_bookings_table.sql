-- Create bookings table for the New Booking flow
-- This is a minimal table to support the booking modal MVP

-- Create bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes INT NULL,
  notes TEXT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'confirmed', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access bookings in workspaces they are members of

-- SELECT: Users can read bookings in their workspaces
CREATE POLICY "Users can read bookings in their workspaces" ON bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bookings.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- INSERT: Users can create bookings in their workspaces
CREATE POLICY "Users can create bookings in their workspaces" ON bookings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bookings.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- UPDATE: Users can update bookings in their workspaces
CREATE POLICY "Users can update bookings in their workspaces" ON bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bookings.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- DELETE: Users can delete bookings in their workspaces
CREATE POLICY "Users can delete bookings in their workspaces" ON bookings
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bookings.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_bookings_workspace_id ON bookings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_bookings_artist_id ON bookings(artist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
