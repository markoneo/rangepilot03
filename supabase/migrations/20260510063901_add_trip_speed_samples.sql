/*
  # Add speed samples to user_trips

  1. Changes
    - Adds nullable `speed_samples` jsonb column to `user_trips` holding a
      downsampled array of {t, s} points (seconds since trip start, speed
      in km/h). Used to render a speed curve on the trip summary screen.

  2. Safety
    - Column is nullable; historical rows without samples remain valid and
      will simply not show the curve.
    - Idempotent via IF NOT EXISTS check.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_trips' AND column_name = 'speed_samples'
  ) THEN
    ALTER TABLE user_trips ADD COLUMN speed_samples jsonb;
  END IF;
END $$;
