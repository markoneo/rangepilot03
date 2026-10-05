/*
  # Per-user data tables tied to Supabase Auth

  1. New Tables
    - `user_car_settings`
      - One row per user holding their car profile (`car_name`, `battery_capacity`).
      - `user_id` is the primary key and a foreign key to `auth.users`.
    - `user_trips`
      - Completed trip history, one row per trip, owned by a user.
      - Mirrors the local `TripRecord` type.

  2. Schema changes
    - Adds nullable `user_id` column to `active_drive_sessions` so active
      sessions belong to a user once login is enabled. Kept nullable so
      existing anonymous sessions (pre-auth) remain readable; new writes
      from the app will always set `user_id`.

  3. Security
    - RLS enabled on all three tables.
    - Policies restrict SELECT / INSERT / UPDATE / DELETE to rows where
      `user_id = auth.uid()`. Users can only see and change their own data.
    - `active_drive_sessions` policies are tightened: the previous permissive
      anon policies are replaced with strict owner-only policies.
*/

-- ── user_car_settings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_car_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  car_name text NOT NULL DEFAULT '',
  battery_capacity numeric NOT NULL DEFAULT 0,
  consumption numeric NOT NULL DEFAULT 18.5,
  battery_percentage numeric NOT NULL DEFAULT 80,
  preset text NOT NULL DEFAULT 'custom',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_car_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own car settings"
  ON user_car_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own car settings"
  ON user_car_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own car settings"
  ON user_car_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own car settings"
  ON user_car_settings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── user_trips ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_trips (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  distance_km numeric NOT NULL DEFAULT 0,
  duration_seconds integer NOT NULL DEFAULT 0,
  start_battery numeric NOT NULL DEFAULT 0,
  end_battery numeric NOT NULL DEFAULT 0,
  consumption numeric NOT NULL DEFAULT 0,
  real_consumption numeric,
  car_name text NOT NULL DEFAULT '',
  battery_capacity numeric NOT NULL DEFAULT 0,
  min_elevation_m numeric,
  max_elevation_m numeric,
  min_temperature_c numeric,
  max_temperature_c numeric,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_trips_user_id_started_at_idx
  ON user_trips (user_id, started_at DESC);

ALTER TABLE user_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own trips"
  ON user_trips FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trips"
  ON user_trips FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trips"
  ON user_trips FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own trips"
  ON user_trips FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── active_drive_sessions: add user ownership ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'active_drive_sessions' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE active_drive_sessions
      ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS active_drive_sessions_user_id_idx
  ON active_drive_sessions (user_id);

DROP POLICY IF EXISTS "Anon can insert own active session" ON active_drive_sessions;
DROP POLICY IF EXISTS "Anon can update active session by id" ON active_drive_sessions;
DROP POLICY IF EXISTS "Anon can select active session by id" ON active_drive_sessions;
DROP POLICY IF EXISTS "Anon can delete own active session" ON active_drive_sessions;

CREATE POLICY "Users can read own active session"
  ON active_drive_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own active session"
  ON active_drive_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own active session"
  ON active_drive_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own active session"
  ON active_drive_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
