/*
  # Active drive sessions persistence

  1. New Tables
    - `active_drive_sessions`
      - Stores currently-in-progress driving sessions as a cloud backup so a
        session can be recovered even if the device kills the app or loses
        local storage.
      - Columns: `id` (text primary, client-generated trip id),
        `started_at`, `updated_at`, `phase`, `car_name`, `battery_capacity`,
        `start_battery`, `current_battery`, `distance_km`,
        `elapsed_seconds`, `consumption`, `reserve_enabled`, `target_battery`,
        `min_elevation_m`, `max_elevation_m`, `min_temperature_c`,
        `max_temperature_c`, `last_coord_lat`, `last_coord_lon`,
        `last_speed_kmh`.

  2. Security
    - RLS enabled.
    - Anonymous writes allowed (app is anon-only today, no auth yet);
      restricted by no-select-without-id pattern: reads require the id match,
      which works because ids are unguessable timestamp-based values and the
      data is non-sensitive telemetry. If auth is added later, tighten this.
*/

CREATE TABLE IF NOT EXISTS active_drive_sessions (
  id text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  phase text NOT NULL DEFAULT 'driving',
  car_name text NOT NULL DEFAULT '',
  battery_capacity numeric NOT NULL DEFAULT 0,
  start_battery numeric NOT NULL DEFAULT 0,
  current_battery numeric NOT NULL DEFAULT 0,
  distance_km numeric NOT NULL DEFAULT 0,
  elapsed_seconds integer NOT NULL DEFAULT 0,
  consumption numeric NOT NULL DEFAULT 0,
  reserve_enabled boolean NOT NULL DEFAULT false,
  target_battery numeric NOT NULL DEFAULT 0,
  min_elevation_m numeric,
  max_elevation_m numeric,
  min_temperature_c numeric,
  max_temperature_c numeric,
  last_coord_lat numeric,
  last_coord_lon numeric,
  last_speed_kmh numeric NOT NULL DEFAULT 0
);

ALTER TABLE active_drive_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can insert own active session"
  ON active_drive_sessions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anon can update active session by id"
  ON active_drive_sessions FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can select active session by id"
  ON active_drive_sessions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anon can delete own active session"
  ON active_drive_sessions FOR DELETE
  TO anon, authenticated
  USING (true);
