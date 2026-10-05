/*
  # Add min/max speed to user_trips and active_drive_sessions

  1. Changes
    - Adds nullable `min_speed_kmh` and `max_speed_kmh` columns to both
      `user_trips` (completed trips) and `active_drive_sessions` (in-progress)
      so we can display minimum and maximum observed speed on the trip
      summary screen.

  2. Safety
    - Columns are nullable with no backfill: historical rows remain untouched
      and will simply show as "no data" until a new trip generates them.
    - Uses IF NOT EXISTS guards so the migration is idempotent.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_trips' AND column_name = 'min_speed_kmh'
  ) THEN
    ALTER TABLE user_trips ADD COLUMN min_speed_kmh numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_trips' AND column_name = 'max_speed_kmh'
  ) THEN
    ALTER TABLE user_trips ADD COLUMN max_speed_kmh numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'active_drive_sessions' AND column_name = 'min_speed_kmh'
  ) THEN
    ALTER TABLE active_drive_sessions ADD COLUMN min_speed_kmh numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'active_drive_sessions' AND column_name = 'max_speed_kmh'
  ) THEN
    ALTER TABLE active_drive_sessions ADD COLUMN max_speed_kmh numeric;
  END IF;
END $$;
