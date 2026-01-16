-- Migration: Extend artists table with new fields from Figma design
-- This adds columns for: stage_name, surname, location, genres, fee, currency,
-- travel_fee, pricing_notes, social_links, overview, dj_equipment, sound_system,
-- allergies, special_diet, special_needs, documents

-- Add new columns to artists table
ALTER TABLE public.artists
ADD COLUMN IF NOT EXISTS stage_name text,
ADD COLUMN IF NOT EXISTS surname text,
ADD COLUMN IF NOT EXISTS location text,
ADD COLUMN IF NOT EXISTS genres text[] DEFAULT '{}'::text[],
ADD COLUMN IF NOT EXISTS fee numeric,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS travel_fee text,
ADD COLUMN IF NOT EXISTS pricing_notes text,
ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS overview text,
ADD COLUMN IF NOT EXISTS dj_equipment text,
ADD COLUMN IF NOT EXISTS sound_system text,
ADD COLUMN IF NOT EXISTS allergies text,
ADD COLUMN IF NOT EXISTS special_diet text,
ADD COLUMN IF NOT EXISTS special_needs text,
ADD COLUMN IF NOT EXISTS documents jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create or replace the updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS artists_updated_at ON public.artists;

CREATE TRIGGER artists_updated_at
  BEFORE UPDATE ON public.artists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON COLUMN public.artists.stage_name IS 'Artist stage/performance name';
COMMENT ON COLUMN public.artists.surname IS 'Artist real surname';
COMMENT ON COLUMN public.artists.location IS 'Artist base location (e.g. Rome, Italy)';
COMMENT ON COLUMN public.artists.genres IS 'Array of music genres';
COMMENT ON COLUMN public.artists.fee IS 'Base rate fee amount';
COMMENT ON COLUMN public.artists.currency IS 'Currency for fee (USD, EUR, etc)';
COMMENT ON COLUMN public.artists.travel_fee IS 'Travel fee option';
COMMENT ON COLUMN public.artists.pricing_notes IS 'Additional pricing notes';
COMMENT ON COLUMN public.artists.social_links IS 'JSON array of {type, url} social media links';
COMMENT ON COLUMN public.artists.overview IS 'Artist bio/overview text';
COMMENT ON COLUMN public.artists.dj_equipment IS 'DJ equipment provided by artist';
COMMENT ON COLUMN public.artists.sound_system IS 'Sound system requirements';
COMMENT ON COLUMN public.artists.allergies IS 'Artist allergies';
COMMENT ON COLUMN public.artists.special_diet IS 'Dietary requirements';
COMMENT ON COLUMN public.artists.special_needs IS 'Accessibility/special needs';
COMMENT ON COLUMN public.artists.documents IS 'JSON array of uploaded document metadata';
