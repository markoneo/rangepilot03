/*
  # Trip GPS Gaps Logging

  1. New Tables
    - `trip_gps_gaps`
      - `id` (uuid, primary key)
      - `device_id` (text) - stable device identifier, since the app has no auth
      - `trip_id` (text) - client-generated trip id
      - `started_at` (timestamptz) - when GPS was lost
      - `ended_at` (timestamptz, nullable) - when GPS was recovered
      - `last_coord_lat` / `last_coord_lon` (double precision) - last good fix before outage
      - `first_recovered_lat` / `first_recovered_lon` (double precision, nullable) - first fix after recovery
      - `last_speed_kmh` (double precision) - speed at the moment of outage for dead reckoning
      - `bridged_km` (double precision) - km estimated via dead reckoning
      - `straight_line_km` (double precision, nullable) - haversine delta after recovery
      - `road_api_km` (double precision, nullable) - along-road distance from external API
      - `final_km_used` (double precision, nullable) - km actually added to the trip
      - `source` (text) - one of 'dead_reckoning' | 'haversine' | 'road_api'
      - `created_at` (timestamptz, default now)

  2. Security
    - Enable RLS on `trip_gps_gaps`
    - Allow anon INSERTs only when device_id is set (telemetry, no reads for anon)
    - No SELECT/UPDATE/DELETE policies for anon — only service role can read

  3. Notes
    - Indexed on (device_id, started_at DESC) for efficient per-device lookups.
*/

CREATE TABLE IF NOT EXISTS trip_gps_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL DEFAULT '',
  trip_id text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  last_coord_lat double precision NOT NULL DEFAULT 0,
  last_coord_lon double precision NOT NULL DEFAULT 0,
  first_recovered_lat double precision,
  first_recovered_lon double precision,
  last_speed_kmh double precision NOT NULL DEFAULT 0,
  bridged_km double precision NOT NULL DEFAULT 0,
  straight_line_km double precision,
  road_api_km double precision,
  final_km_used double precision,
  source text NOT NULL DEFAULT 'dead_reckoning',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_gps_gaps_device_started_idx
  ON trip_gps_gaps (device_id, started_at DESC);

ALTER TABLE trip_gps_gaps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trip_gps_gaps' AND policyname = 'Anon can insert telemetry with device id'
  ) THEN
    CREATE POLICY "Anon can insert telemetry with device id"
      ON trip_gps_gaps FOR INSERT
      TO anon
      WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);
  END IF;
END $$;
